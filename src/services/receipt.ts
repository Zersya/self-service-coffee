import { eq } from 'drizzle-orm';
import { db } from '../db';
import { mcpAuditLogs } from '../db/schema';
import {
  adjustStock,
  createProduct,
  listProducts,
  serializeProduct,
  slugifyProductName,
  ProductServiceError,
  type BeanRow,
} from './products';

export interface ReceiptItemInput {
  name: string;
  quantity: number;
  unit?: 'g' | 'gram' | 'grams' | 'kg' | 'piece' | 'pieces' | 'pcs';
  /** Selling price per 250g (gram) or per piece (piece). Required to create a product. Never a purchase cost. */
  sellingPricePer250g?: number;
  description?: string | null;
  imageUrl?: string | null;
}

export interface ReceiptPreviewItem {
  name: string;
  slug: string;
  quantity: number;
  unit: 'g' | 'piece';
  matchedProduct: ReturnType<typeof serializeProduct> | null;
  action: 'create' | 'restock' | 'blocked';
  stockBefore: number | null;
  stockAfter: number | null;
  sellingPricePer250g?: number;
  warnings: string[];
}

export function normalizeReceiptQuantity(
  quantity: number,
  unit: ReceiptItemInput['unit'],
): { quantity: number; unit: 'g' | 'piece' } {
  const u = (unit || 'g').toLowerCase();
  if (u === 'kg') return { quantity: quantity * 1000, unit: 'g' };
  if (u === 'piece' || u === 'pieces' || u === 'pcs') return { quantity, unit: 'piece' };
  return { quantity, unit: 'g' };
}

export function buildReceiptPreview(
  items: ReceiptItemInput[],
  products: BeanRow[],
): { items: ReceiptPreviewItem[]; canApply: boolean } {
  const preview: ReceiptPreviewItem[] = items.map((item) => {
    const warnings: string[] = [];
    const name = (item.name || '').trim();
    const slug = slugifyProductName(name);
    const normalized = normalizeReceiptQuantity(item.quantity, item.unit);
    if (!name) warnings.push('Item name is required');
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      warnings.push(`Quantity for "${name || 'item'}" must be greater than 0`);
    }
    const matched =
      products.find((p) => p.slug === slug) ||
      products.find((p) => p.name.toLowerCase() === name.toLowerCase()) ||
      null;

    if (matched) {
      const productUnit: 'g' | 'piece' = matched.unitType === 'piece' ? 'piece' : 'g';
      if (productUnit !== normalized.unit) {
        warnings.push(
          `"${matched.name}" is a ${productUnit === 'piece' ? 'piece' : 'gram'} product but receipt item is in ${normalized.unit}; fix the unit before applying`,
        );
      }
      const stockBefore =
        matched.stock === null || matched.stock === undefined
          ? null
          : parseFloat(matched.stock as unknown as string);
      const blocked = warnings.length > 0;
      const stockAfter = blocked
        ? null
        : stockBefore === null
          ? normalized.quantity
          : stockBefore + normalized.quantity;
      if (stockBefore === null && !blocked) {
        // Non-blocking note: unlimited stock becomes a set-to-quantity on apply.
        warnings.push(
          `"${matched.name}" has unlimited stock (null); applying will set stock to the receipt quantity`,
        );
      }
      return {
        name,
        slug: matched.slug,
        quantity: normalized.quantity,
        unit: normalized.unit,
        matchedProduct: serializeProduct(matched),
        action: blocked ? 'blocked' : 'restock',
        stockBefore,
        stockAfter,
        warnings,
      };
    }

    if (
      item.sellingPricePer250g === undefined ||
      !Number.isFinite(item.sellingPricePer250g) ||
      item.sellingPricePer250g <= 0
    ) {
      warnings.push(
        `New product "${name}" needs sellingPricePer250g (selling price per ${normalized.unit === 'piece' ? 'piece' : '250g'} in IDR, confirmed by admin); do not use the purchase cost from the receipt`,
      );
    }
    return {
      name,
      slug,
      quantity: normalized.quantity,
      unit: normalized.unit,
      matchedProduct: null,
      action: warnings.length > 0 ? 'blocked' : 'create',
      stockBefore: null,
      stockAfter: warnings.length > 0 ? null : normalized.quantity,
      sellingPricePer250g: item.sellingPricePer250g,
      warnings,
    };
  });
  return { items: preview, canApply: preview.length > 0 && preview.every((i) => i.action !== 'blocked') };
}

export async function previewReceiptItems(items: ReceiptItemInput[]) {
  const products = await listProducts(true);
  return buildReceiptPreview(items, products);
}

export async function findAuditByIdempotencyKey(key: string) {
  if (!db) return null;
  const rows = await db
    .select()
    .from(mcpAuditLogs)
    .where(eq(mcpAuditLogs.idempotencyKey, key))
    .limit(1);
  return rows[0] ?? null;
}

export async function applyReceiptItems(input: {
  items: ReceiptItemInput[];
  idempotencyKey: string;
  actorSub: string;
  clientId: string;
}) {
  if (!db) throw new ProductServiceError(503, 'Database not configured');
  const existing = await findAuditByIdempotencyKey(input.idempotencyKey);
  if (existing?.afterJson) {
    return { ...JSON.parse(existing.afterJson), replayed: true };
  }
  if (existing) {
    throw new ProductServiceError(
      409,
      `Receipt ${input.idempotencyKey} was already attempted but did not finish cleanly. Check product stock in Admin before retrying with a new idempotencyKey — reusing this key is blocked to prevent double stock.`,
    );
  }

  const preview = await previewReceiptItems(input.items);
  if (!preview.canApply) {
    const problems = preview.items.flatMap((i) => i.warnings);
    throw new ProductServiceError(
      400,
      `Receipt cannot be applied: ${problems.join('; ') || 'no items'}. Fix the items or selling prices and preview again`,
    );
  }

  // Claim the idempotency key before writing anything.
  await db.insert(mcpAuditLogs).values({
    actorSub: input.actorSub,
    clientId: input.clientId,
    toolName: 'kopi_apply_receipt_items',
    action: 'receipt.apply',
    targetType: 'receipt',
    beforeJson: JSON.stringify(preview),
    idempotencyKey: input.idempotencyKey,
    success: false,
    error: 'in_progress',
  });

  const results: any[] = [];
  for (let idx = 0; idx < input.items.length; idx++) {
    const raw = input.items[idx];
    const planned = preview.items[idx];
    if (planned.action === 'create') {
      const created = await createProduct({
        name: planned.name,
        slug: planned.slug,
        description: raw.description || null,
        imageUrl: raw.imageUrl || null,
        pricePer250g: raw.sellingPricePer250g,
        unitType: planned.unit === 'piece' ? 'piece' : 'gram',
        stock: planned.quantity,
      });
      results.push({ action: 'create', product: serializeProduct(created), stockBefore: null, stockAfter: planned.quantity });
    } else {
      const matchedId = planned.matchedProduct!.id;
      const before = planned.matchedProduct!;
      // Unlimited stock becomes a set; tracked stock is an atomic add.
      const adjusted = await adjustStock({
        productId: matchedId,
        mode: before.stock === null ? 'set' : 'add',
        amount: planned.quantity,
      });
      results.push({
        action: 'restock',
        product: serializeProduct(adjusted.product),
        stockBefore: adjusted.stockBefore,
        stockAfter: adjusted.stockAfter,
      });
    }
  }

  const payload = { items: results, canApply: true };
  await db
    .update(mcpAuditLogs)
    .set({ afterJson: JSON.stringify(payload), success: true, error: null })
    .where(eq(mcpAuditLogs.idempotencyKey, input.idempotencyKey));
  return { ...payload, replayed: false };
}

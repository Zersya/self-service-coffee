import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { beans } from '../db/schema';

export type BeanRow = typeof beans.$inferSelect;

export class ProductServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function requireDb() {
  if (!db) throw new ProductServiceError(503, 'Database not configured');
  return db;
}

export function slugifyProductName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface ProductInput {
  name?: string;
  slug?: string;
  description?: string | null;
  imageUrl?: string | null;
  pricePer250g?: number;
  unitType?: string;
  stock?: number | string | null;
  isActive?: boolean;
}

function parseStock(stock: ProductInput['stock']): string | null {
  if (stock === undefined || stock === null || stock === '') return null;
  const parsed = typeof stock === 'number' ? stock : parseFloat(stock);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new ProductServiceError(400, 'Stock must be a non-negative number');
  }
  return String(parsed);
}

function normalizeUnitType(unitType?: string): string {
  if (unitType === undefined) return 'gram';
  if (unitType !== 'gram' && unitType !== 'piece') {
    throw new ProductServiceError(400, "unitType must be 'gram' or 'piece'");
  }
  return unitType;
}

export async function listProducts(includeInactive = true): Promise<BeanRow[]> {
  const database = requireDb();
  if (includeInactive) {
    return database.select().from(beans).orderBy(desc(beans.createdAt));
  }
  return database
    .select()
    .from(beans)
    .where(eq(beans.isActive, true))
    .orderBy(desc(beans.createdAt));
}

export async function getProductById(id: number): Promise<BeanRow | null> {
  const database = requireDb();
  if (!Number.isInteger(id) || id <= 0) {
    throw new ProductServiceError(400, 'Invalid bean ID');
  }
  const rows = await database.select().from(beans).where(eq(beans.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getProductBySlug(slug: string): Promise<BeanRow | null> {
  const database = requireDb();
  const rows = await database.select().from(beans).where(eq(beans.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function resolveProduct(input: {
  productId?: number;
  slug?: string;
}): Promise<BeanRow> {
  let product: BeanRow | null = null;
  if (input.productId !== undefined) product = await getProductById(input.productId);
  else if (input.slug) product = await getProductBySlug(input.slug);
  else throw new ProductServiceError(400, 'productId or slug is required');
  if (!product) throw new ProductServiceError(404, 'Bean not found');
  return product;
}

export async function createProduct(input: ProductInput): Promise<BeanRow> {
  const database = requireDb();
  const name = input.name?.trim();
  const slug = (input.slug?.trim() || (name ? slugifyProductName(name) : '')).trim();
  if (!name || !slug) {
    throw new ProductServiceError(400, 'Name and slug are required');
  }
  if (
    input.pricePer250g !== undefined &&
    (!Number.isFinite(input.pricePer250g) || input.pricePer250g <= 0)
  ) {
    throw new ProductServiceError(400, 'pricePer250g must be a positive number');
  }
  try {
    const result = await database
      .insert(beans)
      .values({
        name,
        slug,
        description: input.description || null,
        imageUrl: input.imageUrl || null,
        pricePer250g: input.pricePer250g || 100000,
        unitType: normalizeUnitType(input.unitType),
        stock: parseStock(input.stock),
      })
      .returning();
    return result[0];
  } catch (e: any) {
    if (e instanceof ProductServiceError) throw e;
    if (e?.code === '23505') {
      throw new ProductServiceError(400, 'A bean with this slug already exists');
    }
    throw e;
  }
}

export async function updateProduct(id: number, input: ProductInput): Promise<BeanRow> {
  const database = requireDb();
  if (!Number.isInteger(id) || id <= 0) {
    throw new ProductServiceError(400, 'Invalid bean ID');
  }
  const updateData: Partial<typeof beans.$inferInsert> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.slug !== undefined) updateData.slug = input.slug;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.imageUrl !== undefined) updateData.imageUrl = input.imageUrl;
  if (input.pricePer250g !== undefined) {
    if (!Number.isFinite(input.pricePer250g) || input.pricePer250g <= 0) {
      throw new ProductServiceError(400, 'pricePer250g must be a positive number');
    }
    updateData.pricePer250g = input.pricePer250g;
  }
  if (input.unitType !== undefined) updateData.unitType = normalizeUnitType(input.unitType);
  if (input.isActive !== undefined) updateData.isActive = input.isActive;
  if (input.stock !== undefined) updateData.stock = parseStock(input.stock);

  const result = await database
    .update(beans)
    .set(updateData)
    .where(eq(beans.id, id))
    .returning();
  if (result.length === 0) throw new ProductServiceError(404, 'Bean not found');
  return result[0];
}

export async function setProductActive(id: number, isActive: boolean): Promise<BeanRow> {
  return updateProduct(id, { isActive });
}

export async function deactivateProduct(id: number): Promise<BeanRow> {
  return setProductActive(id, false);
}

export interface StockAdjustmentResult {
  product: BeanRow;
  stockBefore: number | null;
  stockAfter: number | null;
  mode: 'add' | 'set';
  amount: number;
}

export async function adjustStock(input: {
  productId?: number;
  slug?: string;
  mode: 'add' | 'set';
  amount: number;
}): Promise<StockAdjustmentResult> {
  const database = requireDb();
  if (!Number.isFinite(input.amount)) {
    throw new ProductServiceError(400, 'amount must be a number');
  }
  if (input.mode === 'add' && input.amount === 0) {
    throw new ProductServiceError(400, 'amount must not be 0 for add');
  }
  if (input.mode === 'set' && input.amount < 0) {
    throw new ProductServiceError(400, 'amount must be non-negative for set');
  }
  const current = await resolveProduct(input);
  const stockBefore =
    current.stock === null || current.stock === undefined
      ? null
      : parseFloat(current.stock as unknown as string);

  if (input.mode === 'add' && stockBefore === null) {
    throw new ProductServiceError(
      400,
      `Product "${current.name}" has unlimited stock (stock is null); use mode "set" instead of "add"`,
    );
  }
  const stockAfter = input.mode === 'add' ? (stockBefore as number) + input.amount : input.amount;
  if (stockAfter < 0) {
    throw new ProductServiceError(
      400,
      `Stock cannot go below 0 for ${current.name} (current ${stockBefore}, change ${input.amount})`,
    );
  }

  // Atomic update so concurrent order deductions cannot be overwritten.
  const updated =
    input.mode === 'add'
      ? await database.execute(
          sql`UPDATE beans SET stock = stock + ${input.amount} WHERE id = ${current.id} AND stock IS NOT NULL RETURNING *`,
        )
      : await database
          .update(beans)
          .set({ stock: String(input.amount) })
          .where(eq(beans.id, current.id))
          .returning();

  const row: any = Array.isArray(updated) ? updated[0] : (updated as any)?.[0];
  const product = (row ?? (await getProductById(current.id))) as BeanRow;
  if (!product) throw new ProductServiceError(404, 'Bean not found');
  const finalStock =
    product.stock === null || product.stock === undefined
      ? null
      : parseFloat(product.stock as unknown as string);
  return { product, stockBefore, stockAfter: finalStock, mode: input.mode, amount: input.amount };
}

export function serializeProduct(bean: BeanRow) {
  return {
    id: bean.id,
    name: bean.name,
    slug: bean.slug,
    description: bean.description,
    imageUrl: bean.imageUrl,
    pricePer250g: bean.pricePer250g,
    unitType: bean.unitType,
    stock:
      bean.stock === null || bean.stock === undefined
        ? null
        : parseFloat(bean.stock as unknown as string),
    isActive: bean.isActive,
    createdAt: bean.createdAt,
  };
}

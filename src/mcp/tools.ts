import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hasMcpScope, type McpAuthInfo } from './auth';
import {
  adjustStock,
  createProduct,
  getProductById,
  listProducts,
  resolveProduct,
  serializeProduct,
  setProductActive,
  updateProduct,
  ProductServiceError,
} from '../services/products';
import { getBalance, listOrderHistory, parseDateParam } from '../services/reports';
import { applyReceiptItems, previewReceiptItems, type ReceiptItemInput } from '../services/receipt';
import { writeAudit } from '../services/audit';
import { getAdminEmail } from './oauth/config';

const CHARACTER_LIMIT = 25000;
const ResponseFormat = z.enum(['json', 'markdown']);

function truncateText(text: string, limit = CHARACTER_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n... [truncated — response exceeded ${limit} characters]`;
}

function ok(output: unknown, responseFormat: 'json' | 'markdown', markdown?: string) {
  const text =
    responseFormat === 'markdown' && markdown ? truncateText(markdown) : truncateText(JSON.stringify(output, null, 2));
  return { content: [{ type: 'text' as const, text }], structuredContent: output as Record<string, unknown> };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

function scopeError(auth: McpAuthInfo, required: string) {
  return fail(
    new Error(
      `Missing scope ${required}. This token has: ${auth.scope || '(none)'}. Reconnect and approve ${required} access.`,
    ),
  );
}

const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export function registerKopiTools(server: McpServer, auth: McpAuthInfo): void {
  server.registerTool(
    'kopi_get_admin_info',
    {
      title: 'Get Admin Info',
      description: 'Get the authenticated Kopi Kita admin identity, MCP client, scopes, and token expiry. Never returns passwords or secrets.',
      inputSchema: { response_format: ResponseFormat.default('json').describe('Output format: json or markdown') },
      annotations: readAnnotations,
    },
    async ({ response_format }) => {
      if (!hasMcpScope(auth, 'kopi:read')) return scopeError(auth, 'kopi:read');
      const output = {
        email: getAdminEmail() || auth.sub,
        sub: auth.sub,
        role: 'admin',
        clientId: auth.clientId,
        scopes: auth.scope.split(/\s+/).filter(Boolean),
        tokenExpiresAt: auth.expiresAt ? new Date(auth.expiresAt * 1000).toISOString() : null,
      };
      return ok(output, response_format, `# Admin\n\n- Email: ${output.email}\n- Client: ${output.clientId}\n- Scopes: ${output.scopes.join(', ')}`);
    },
  );

  server.registerTool(
    'kopi_list_products',
    {
      title: 'List Products',
      description: 'List Kopi Kita products (beans table). Use includeInactive=false for the public catalog only.',
      inputSchema: {
        includeInactive: z.boolean().default(true).describe('Include inactive products'),
        response_format: ResponseFormat.default('json').describe('Output format: json or markdown'),
      },
      annotations: readAnnotations,
    },
    async ({ includeInactive, response_format }) => {
      if (!hasMcpScope(auth, 'kopi:read')) return scopeError(auth, 'kopi:read');
      try {
        const products = (await listProducts(includeInactive)).map(serializeProduct);
        const markdown = `# Products (${products.length})\n\n${products
          .map((p) => `- ${p.name} (${p.slug}) — Rp ${p.pricePer250g}/${p.unitType === 'piece' ? 'pcs' : '250g'} — stok: ${p.stock === null ? '∞' : p.stock}${p.isActive ? '' : ' — NONAKTIF'}`)
          .join('\n')}`;
        return ok({ products, count: products.length }, response_format, markdown);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'kopi_get_product',
    {
      title: 'Get Product',
      description: 'Get one product by numeric productId or slug.',
      inputSchema: {
        productId: z.number().int().positive().optional().describe('Product numeric ID'),
        slug: z.string().min(1).optional().describe('Product slug'),
        response_format: ResponseFormat.default('json').describe('Output format: json or markdown'),
      },
      annotations: readAnnotations,
    },
    async ({ productId, slug, response_format }) => {
      if (!hasMcpScope(auth, 'kopi:read')) return scopeError(auth, 'kopi:read');
      try {
        const product = await resolveProduct({ productId, slug });
        return ok({ product: serializeProduct(product) }, response_format);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'kopi_list_low_stock',
    {
      title: 'List Low Stock Products',
      description: 'List tracked-stock products at or below a threshold. Unlimited-stock (null) products are excluded.',
      inputSchema: {
        threshold: z.number().nonnegative().default(500).describe('Threshold in product unit (g or pcs)'),
        response_format: ResponseFormat.default('json').describe('Output format: json or markdown'),
      },
      annotations: readAnnotations,
    },
    async ({ threshold, response_format }) => {
      if (!hasMcpScope(auth, 'kopi:read')) return scopeError(auth, 'kopi:read');
      try {
        const all = (await listProducts(true)).map(serializeProduct);
        const products = all.filter((p) => p.stock !== null && p.stock <= threshold);
        return ok({ products, count: products.length, threshold }, response_format);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'kopi_get_balance',
    {
      title: 'Get Balance',
      description: 'Get Kopi Kita balance, income, fees, and per-product income. Optional ISO from/to dates scope income (available balance stays all-time).',
      inputSchema: {
        from: z.string().optional().describe('ISO start date, e.g. 2026-11-01'),
        to: z.string().optional().describe('ISO end date'),
        response_format: ResponseFormat.default('json').describe('Output format: json or markdown'),
      },
      annotations: readAnnotations,
    },
    async ({ from, to, response_format }) => {
      if (!hasMcpScope(auth, 'kopi:read')) return scopeError(auth, 'kopi:read');
      try {
        const balance = await getBalance({ from: parseDateParam(from), to: parseDateParam(to) });
        return ok(balance, response_format, `# Balance\n\nSaldo tersedia: Rp ${balance.balance}\nTotal pemasukan: Rp ${balance.totalIncome}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'kopi_list_orders',
    {
      title: 'List Orders',
      description: 'List recent orders, newest first. Optionally filter by status and ISO from/to dates.',
      inputSchema: {
        limit: z.number().int().positive().max(500).default(50).describe('Max rows (1-500)'),
        status: z.string().optional().describe('e.g. settlement, pending, capture'),
        from: z.string().optional().describe('ISO start date'),
        to: z.string().optional().describe('ISO end date'),
        response_format: ResponseFormat.default('json').describe('Output format: json or markdown'),
      },
      annotations: readAnnotations,
    },
    async ({ limit, status, from, to, response_format }) => {
      if (!hasMcpScope(auth, 'kopi:read')) return scopeError(auth, 'kopi:read');
      try {
        const orders = await listOrderHistory({ limit, status, from: parseDateParam(from), to: parseDateParam(to) });
        return ok({ orders, count: orders.length }, response_format);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'kopi_create_product',
    {
      title: 'Create Product',
      description: 'Create a product. Requires kopi:products:write. pricePer250g is the SELLING price in IDR per 250g (gram) or per piece (piece) — never a purchase cost.',
      inputSchema: {
        name: z.string().min(1).describe('Product name, e.g. "Gula Pasir 1kg"'),
        slug: z.string().min(1).optional().describe('URL slug; auto-generated from name when omitted'),
        description: z.string().nullable().optional().describe('Description'),
        imageUrl: z.string().nullable().optional().describe('Image URL (must already be hosted; MCP does not upload files)'),
        pricePer250g: z.number().positive().describe('Selling price IDR per 250g or per piece'),
        unitType: z.enum(['gram', 'piece']).default('gram').describe('gram or piece'),
        stock: z.number().nonnegative().nullable().optional().describe('Initial stock in g/pcs; null/omitted = unlimited'),
        response_format: ResponseFormat.default('json').describe('Output format: json or markdown'),
      },
      annotations: writeAnnotations,
    },
    async (args) => {
      if (!hasMcpScope(auth, 'kopi:products:write')) return scopeError(auth, 'kopi:products:write');
      try {
        const product = await createProduct(args);
        await writeAudit({
          actorSub: auth.sub, clientId: auth.clientId, toolName: 'kopi_create_product',
          action: 'product.create', targetType: 'product', targetId: product.id, targetSlug: product.slug,
          after: serializeProduct(product),
        });
        return ok({ product: serializeProduct(product) }, args.response_format);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'kopi_update_product',
    {
      title: 'Update Product',
      description: 'Update product fields by ID. Requires kopi:products:write. Use kopi_adjust_stock for stock changes so they are audited as stock events. Never set pricePer250g from a purchase receipt cost.',
      inputSchema: {
        productId: z.number().int().positive().describe('Product numeric ID'),
        name: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        imageUrl: z.string().nullable().optional(),
        pricePer250g: z.number().positive().optional().describe('Selling price IDR per 250g or per piece'),
        unitType: z.enum(['gram', 'piece']).optional(),
        isActive: z.boolean().optional(),
        response_format: ResponseFormat.default('json').describe('Output format: json or markdown'),
      },
      annotations: writeAnnotations,
    },
    async ({ productId, response_format, ...fields }) => {
      if (!hasMcpScope(auth, 'kopi:products:write')) return scopeError(auth, 'kopi:products:write');
      try {
        const before = await getProductById(productId);
        if (!before) throw new ProductServiceError(404, 'Bean not found');
        const product = await updateProduct(productId, fields);
        await writeAudit({
          actorSub: auth.sub, clientId: auth.clientId, toolName: 'kopi_update_product',
          action: 'product.update', targetType: 'product', targetId: product.id, targetSlug: product.slug,
          before: serializeProduct(before), after: serializeProduct(product),
        });
        return ok({ product: serializeProduct(product) }, response_format);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'kopi_set_product_active',
    {
      title: 'Activate or Deactivate Product',
      description: 'Set product active flag (deactivation is the soft-delete used by the Admin UI). Requires kopi:products:write.',
      inputSchema: {
        productId: z.number().int().positive().describe('Product numeric ID'),
        isActive: z.boolean().describe('true = active, false = deactivated'),
        response_format: ResponseFormat.default('json').describe('Output format: json or markdown'),
      },
      annotations: { ...writeAnnotations, destructiveHint: true, idempotentHint: true },
    },
    async ({ productId, isActive, response_format }) => {
      if (!hasMcpScope(auth, 'kopi:products:write')) return scopeError(auth, 'kopi:products:write');
      try {
        const before = await getProductById(productId);
        if (!before) throw new ProductServiceError(404, 'Bean not found');
        const product = await setProductActive(productId, isActive);
        await writeAudit({
          actorSub: auth.sub, clientId: auth.clientId, toolName: 'kopi_set_product_active',
          action: isActive ? 'product.activate' : 'product.deactivate', targetType: 'product',
          targetId: product.id, targetSlug: product.slug,
          before: serializeProduct(before), after: serializeProduct(product),
        });
        return ok({ product: serializeProduct(product) }, response_format);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'kopi_adjust_stock',
    {
      title: 'Adjust Stock',
      description: 'Add to or set product stock. Requires kopi:stock:write. amount is in the product unit unless unit=kg for gram products. mode=add is atomic and fails on unlimited stock; reason is stored in the audit log.',
      inputSchema: {
        productId: z.number().int().positive().optional().describe('Product numeric ID'),
        slug: z.string().min(1).optional().describe('Product slug (alternative to productId)'),
        mode: z.enum(['add', 'set']).describe('add = increase/decrease by amount, set = replace stock'),
        amount: z.number().describe('Amount; may be negative with add, never below zero result'),
        unit: z.enum(['g', 'kg', 'piece']).optional().describe('Input unit; kg is converted to g'),
        reason: z.string().min(1).describe('Reason, e.g. "restock from receipt 2026-11-09"'),
        response_format: ResponseFormat.default('json').describe('Output format: json or markdown'),
      },
      annotations: writeAnnotations,
    },
    async ({ productId, slug, mode, amount, unit, reason, response_format }) => {
      if (!hasMcpScope(auth, 'kopi:stock:write')) return scopeError(auth, 'kopi:stock:write');
      try {
        const current = await resolveProduct({ productId, slug });
        let normalized = amount;
        if (unit === 'kg') {
          if (current.unitType === 'piece') throw new ProductServiceError(400, 'unit kg cannot be used for a piece product');
          normalized = amount * 1000;
        }
        if (unit === 'piece' && current.unitType !== 'piece') {
          throw new ProductServiceError(400, `"${current.name}" is a gram product; use g or kg`);
        }
        const result = await adjustStock({ productId: current.id, mode, amount: normalized });
        await writeAudit({
          actorSub: auth.sub, clientId: auth.clientId, toolName: 'kopi_adjust_stock',
          action: `stock.${mode}`, targetType: 'product', targetId: current.id, targetSlug: current.slug,
          before: { stock: result.stockBefore, reason }, after: { stock: result.stockAfter, reason },
        });
        return ok(
          { product: serializeProduct(result.product), stockBefore: result.stockBefore, stockAfter: result.stockAfter, mode, amount: normalized },
          response_format,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerReceiptTools(server, auth);
}

const ReceiptItemSchema = z.object({
  name: z.string().min(1).describe('Name exactly as read from the receipt'),
  quantity: z.number().positive().describe('Quantity purchased'),
  unit: z.enum(['g', 'gram', 'grams', 'kg', 'piece', 'pieces', 'pcs']).default('g').describe('Unit on the receipt'),
  sellingPricePer250g: z
    .number()
    .positive()
    .optional()
    .describe('Only for NEW products: admin-confirmed SELLING price IDR per 250g/piece. Never the purchase cost from the receipt.'),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
});

function registerReceiptTools(server: McpServer, auth: McpAuthInfo): void {
  server.registerTool(
    'kopi_preview_receipt_items',
    {
      title: 'Preview Receipt Items (No Writes)',
      description:
        'Preview how receipt line items (already read from the photo by the agent) map to products. Read-only: shows create vs restock, stock before/after, and blocking warnings. Always call this, show the result to the admin, and wait for explicit confirmation before kopi_apply_receipt_items.',
      inputSchema: {
        items: z.array(ReceiptItemSchema).min(1).describe('Line items extracted from the receipt photo'),
        response_format: ResponseFormat.default('json').describe('Output format: json or markdown'),
      },
      annotations: readAnnotations,
    },
    async ({ items, response_format }) => {
      if (!hasMcpScope(auth, 'kopi:read')) return scopeError(auth, 'kopi:read');
      try {
        const preview = await previewReceiptItems(items as ReceiptItemInput[]);
        const markdown = [
          `# Receipt preview — ${preview.canApply ? 'ready to apply' : 'BLOCKED'}`,
          '',
          ...preview.items.map(
            (i) =>
              `- ${i.name}: ${i.action} ${i.quantity}${i.unit === 'piece' ? 'pcs' : 'g'} (stok ${i.stockBefore ?? '—'} → ${i.stockAfter ?? '—'})${i.warnings.length ? ` ⚠ ${i.warnings.join('; ')}` : ''}`,
          ),
        ].join('\n');
        return ok(preview, response_format, markdown);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'kopi_apply_receipt_items',
    {
      title: 'Apply Receipt Items (Writes)',
      description:
        'Apply previously previewed receipt items: creates new products (admin-confirmed selling price required) and restocks existing ones. Requires kopi:products:write AND kopi:stock:write, confirm=true after the admin approved the preview in chat, and a stable idempotencyKey per receipt so retries never double-add stock.',
      inputSchema: {
        items: z.array(ReceiptItemSchema).min(1).describe('Same items that were previewed and confirmed'),
        confirm: z.boolean().describe('Must be true, only after the admin explicitly approved the preview'),
        idempotencyKey: z.string().min(8).describe('Stable unique key per receipt, e.g. receipt-2026-11-09-toko-a-001'),
        response_format: ResponseFormat.default('json').describe('Output format: json or markdown'),
      },
      annotations: writeAnnotations,
    },
    async ({ items, confirm, idempotencyKey, response_format }) => {
      if (!hasMcpScope(auth, 'kopi:products:write')) return scopeError(auth, 'kopi:products:write');
      if (!hasMcpScope(auth, 'kopi:stock:write')) return scopeError(auth, 'kopi:stock:write');
      if (!confirm) {
        return fail(new Error('confirm must be true. Show kopi_preview_receipt_items output to the admin and ask for explicit approval first.'));
      }
      try {
        const result = await applyReceiptItems({
          items: items as ReceiptItemInput[],
          idempotencyKey,
          actorSub: auth.sub,
          clientId: auth.clientId,
        });
        return ok(result, response_format);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerPrompt(
    'kopi_input_receipt',
    {
      title: 'Input Receipt to Products and Stock',
      description: 'Guide the agent to turn a receipt photo into confirmed product and stock writes.',
      argsSchema: {
        note: z.string().optional().describe('Optional note, e.g. supplier or receipt date'),
      },
    },
    async ({ note }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'Turn the receipt photo I attached into Kopi Kita products and stock:',
              '1. Read every line item from the photo: name, quantity, and unit (convert kg to the receipt unit field, keep the raw reading visible to me).',
              '2. Call kopi_list_products to see the current catalog.',
              '3. Call kopi_preview_receipt_items with the extracted items. For new products, ask me for the selling price (per 250g or per pcs) — never use the purchase cost on the receipt as the selling price.',
              '4. Show me the preview table (create vs restock, stock before → after, warnings) and STOP. Wait for my explicit "ya/apply" confirmation.',
              '5. Only then call kopi_apply_receipt_items with confirm=true and a stable idempotencyKey for this receipt. Reuse the same key on any retry.',
              '6. Report the result with stock before/after for each product.',
              note ? `Note: ${note}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        },
      ],
    }),
  );
}

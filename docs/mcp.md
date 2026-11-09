# Kopi Kita MCP (Admin, OAuth)

Remote MCP server on the existing app — same domain and port, no extra service.

- MCP endpoint: `POST/GET/DELETE https://<your-domain>/mcp`
- OAuth authorize: `https://<your-domain>/oauth/authorize`
- OAuth token: `https://<your-domain>/oauth/token`
- Discovery: `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`

An AI agent signs in **as the admin**: the OAuth consent screen first requires the
existing `ADMIN_EMAIL` / `ADMIN_PASSWORD` login, then an explicit Allow. Tokens last
1 hour (no refresh tokens — reconnect to get a new one).

Scopes: `kopi:read` (products, stock, balance, orders, admin info),
`kopi:products:write` (create/update/activate products), `kopi:stock:write`
(adjust stock, apply receipts). There are **no** disbursement/money-out tools.

## 1. Server setup

Set in Coolify (or `.env`), then redeploy:

```env
ADMIN_EMAIL=admin@kopi-kita.com
ADMIN_PASSWORD=<your admin password>
APP_URL=https://<your-domain>
MCP_OAUTH_ISSUER=https://<your-domain>
MCP_OAUTH_CLIENT_ID=<long random>
MCP_OAUTH_CLIENT_SECRET=<long random>
MCP_OAUTH_SIGNING_SECRET=<long random>
MCP_OAUTH_TOKEN_EXPIRY=3600
# DCR is always on and every client redirect URI is accepted automatically.
```

Run the DB migration once (`npm run db:push`) — it adds `mcp_oauth_clients` and
`mcp_audit_logs`. Every MCP write is recorded in `mcp_audit_logs`.

Generate secrets with your password manager or:

```bash
openssl rand -hex 32
```

`MCP_OAUTH_ISSUER` must exactly match the public HTTPS origin or discovery,
audience checks, and redirects break. MCP stays disabled (503) until the client
ID, client secret, and signing secret are all set.

## 2. Connect a client

### Gemini Spark

Settings → Connected Apps → Custom apps for Spark:

- MCP URL: `https://<your-domain>/mcp`
- Client ID / Client Secret: the `MCP_OAUTH_CLIENT_ID/SECRET` values
- Connect and approve the admin consent page in the browser. Every redirect URI
  is accepted automatically — nothing to configure.

### Cursor / Claude (OAuth)

Add a remote MCP server with URL `https://<your-domain>/mcp` and start the OAuth
flow from the client. Dynamic Client Registration is on by default, CIMD and
public PKCE clients work too, and every redirect URI is accepted automatically.
If your client asks for a client ID/secret, use the static `MCP_OAUTH_*` values.

### MCP Inspector (local check)

```bash
npx @modelcontextprotocol/inspector
```

Open the UI, choose Streamable HTTP, enter `https://<your-domain>/mcp`, and run
the OAuth flow — or for a quick read-only check set `MCP_STATIC_TOKEN` on the
server and paste it as a Bearer token (static token = `kopi:read` only).

## 3. Tools

| Tool | Scope | What it does |
|---|---|---|
| `kopi_get_admin_info` | read | Admin email, client, scopes, token expiry |
| `kopi_list_products` | read | Product list (incl. inactive by default) |
| `kopi_get_product` | read | One product by ID or slug |
| `kopi_list_low_stock` | read | Tracked stock at/below threshold |
| `kopi_get_balance` | read | Balance, income, fees, per-product income |
| `kopi_list_orders` | read | Recent orders, optional status/date filter |
| `kopi_create_product` | products:write | New product (selling price required) |
| `kopi_update_product` | products:write | Update name/price/unit/active etc. |
| `kopi_set_product_active` | products:write | Activate / deactivate (soft delete) |
| `kopi_adjust_stock` | stock:write | `add`/`set` stock, kg aware, reason required |
| `kopi_preview_receipt_items` | read | Receipt → create/restock plan, no writes |
| `kopi_apply_receipt_items` | products+stock:write | Apply a confirmed receipt, idempotent |

Prompt: `kopi_input_receipt` guides the agent through the receipt flow.

## 4. Receipt photo flow

The agent (not this server) reads the photo — no image is uploaded or stored here.

1. You attach a receipt photo in chat and ask to input it.
2. Agent extracts line items, calls `kopi_list_products`, then
   `kopi_preview_receipt_items` and shows you the plan: create vs restock,
   stock before → after, warnings.
3. New products need a **selling price you confirm** (`pricePer250g` per 250g or
   per pcs). The purchase cost on the receipt is never used as the selling price.
4. You reply to approve. Only then the agent calls `kopi_apply_receipt_items`
   with `confirm=true` and a stable `idempotencyKey` for that receipt — retries
   with the same key never double-add stock.

## 5. Troubleshooting

- `401` on `/mcp`: token missing/expired, or issued for a different issuer —
  reconnect and check `MCP_OAUTH_ISSUER` matches the URL you opened.
- `redirect_uri ... is not supported`: the client sent a plain-http (non-loopback)
  redirect. Use a client with an https or loopback redirect — all of those are
  accepted automatically.
- Consent page loops to login: cookies are blocked, or `ADMIN_*` env is unset.
- `503 MCP authentication is not configured`: OAuth env incomplete.
- Rollback: clear the `MCP_OAUTH_*` variables and redeploy. Existing web admin,
  catalog, payments, and stock deduction are unaffected.

## 6. Known limits (v1)

- Single admin identity; audit rows distinguish MCP clients, not people.
- Auth codes, sessions, and MCP sessions are in-memory (single instance,
  lost on restart). Do not scale to multiple replicas yet.

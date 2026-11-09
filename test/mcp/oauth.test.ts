import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test, before } from 'node:test';

before(() => {
  process.env.MCP_OAUTH_ISSUER = 'https://kopi.example.com';
  process.env.MCP_OAUTH_CLIENT_ID = 'test-client';
  process.env.MCP_OAUTH_CLIENT_SECRET = 'test-secret';
  process.env.MCP_OAUTH_SIGNING_SECRET = 'test-signing-secret-for-unit-tests-only';
  process.env.MCP_OAUTH_REDIRECT_URIS = 'https://client.example.com/callback,http://localhost:9999/callback';
  process.env.ADMIN_EMAIL = 'admin@kopi-kita.com';
  process.env.ADMIN_PASSWORD = 'test-admin-password';
  // Keep unit tests off the real database (DCR client lookup is DB-backed).
  process.env.DATABASE_URL = '';
});

test('PKCE S256 accepts valid verifier and rejects wrong one', async () => {
  const { verifyPkceS256 } = await import('../../src/mcp/oauth/pkce');
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(verifyPkceS256(verifier, challenge), true);
  assert.equal(verifyPkceS256('wrong-verifier', challenge), false);
  assert.equal(verifyPkceS256(undefined, challenge), false);
});

test('redirect URIs: https and loopback pass, cleartext http elsewhere fails', async () => {
  const { isRedirectUriAllowed } = await import('../../src/mcp/oauth/clients');
  assert.equal(await isRedirectUriAllowed('test-client', 'https://client.example.com/callback'), true);
  assert.equal(await isRedirectUriAllowed('test-client', 'http://localhost:9999/callback'), true);
  // Loopback redirects on random ports (Cursor/Claude desktop) need no pre-configuration.
  assert.equal(await isRedirectUriAllowed('any-client', 'http://127.0.0.1:54321/oauth/callback'), true);
  assert.equal(await isRedirectUriAllowed('any-client', 'http://localhost:1234/callback'), true);
  assert.equal(await isRedirectUriAllowed('test-client', 'http://evil.example.com/callback'), false);
});

test('access token verifies with aud/iss and rejects tampering', async () => {
  const { issueMcpAccessToken, verifyMcpAccessToken } = await import('../../src/mcp/oauth/tokens');
  const { accessToken } = issueMcpAccessToken({
    sub: 'admin@kopi-kita.com',
    clientId: 'test-client',
    scope: 'kopi:read kopi:stock:write',
  });
  const payload = verifyMcpAccessToken(accessToken);
  assert.equal(payload?.sub, 'admin@kopi-kita.com');
  assert.equal(payload?.aud, 'https://kopi.example.com/mcp');
  assert.equal(verifyMcpAccessToken(`${accessToken}x`), null);
  assert.equal(verifyMcpAccessToken('not-a-jwt'), null);
});

test('every client redirect URI is supported automatically (https + loopback http)', async () => {
  const { isRedirectUriAllowed } = await import('../../src/mcp/oauth/clients');
  // Fixed web callbacks from arbitrary clients, no pre-configuration:
  assert.equal(await isRedirectUriAllowed('claude-client', 'https://claude.ai/api/mcp/auth_callback'), true);
  assert.equal(await isRedirectUriAllowed('chatgpt-client', 'https://chatgpt.com/connector_platform_oauth_redirect'), true);
  assert.equal(await isRedirectUriAllowed('brand-new-client', 'https://new-tool.example.com/oauth/done'), true);
  // Plain http outside loopback is still rejected (would leak the code in cleartext):
  assert.equal(await isRedirectUriAllowed('brand-new-client', 'http://new-tool.example.com/oauth/done'), false);
  assert.equal(await isRedirectUriAllowed('brand-new-client', 'not a url'), false);
});

test('unknown public clients can exchange a code; the static client still needs its secret', async () => {
  const { validateClientCredentials } = await import('../../src/mcp/oauth/clients');
  assert.equal(await validateClientCredentials('brand-new-public-client', undefined), true);
  assert.equal(await validateClientCredentials('test-client', undefined), false);
  assert.equal(await validateClientCredentials('test-client', 'wrong-secret'), false);
  assert.equal(await validateClientCredentials('test-client', 'test-secret'), true);
});

test('DCR is always on when OAuth is on (no env opt-out)', async () => {
  const { isDcrEnabled } = await import('../../src/mcp/oauth/config');
  delete process.env.MCP_OAUTH_DCR_ENABLED;
  assert.equal(isDcrEnabled(), true);
  process.env.MCP_OAUTH_DCR_ENABLED = 'false';
  assert.equal(isDcrEnabled(), true);
});

test('admin credentials use the configured email/password', async () => {
  const { verifyAdminCredentials } = await import('../../src/mcp/oauth/admin-session');
  assert.equal(verifyAdminCredentials('admin@kopi-kita.com', 'test-admin-password'), true);
  assert.equal(verifyAdminCredentials('admin@kopi-kita.com', 'wrong'), false);
  assert.equal(verifyAdminCredentials('other@example.com', 'test-admin-password'), false);
});

test('scope normalization drops unknown scopes and defaults to read', async () => {
  const { normalizeScope, hasScope } = await import('../../src/mcp/oauth/config');
  assert.equal(normalizeScope('kopi:read kopi:stock:write admin:all'), 'kopi:read kopi:stock:write');
  assert.equal(normalizeScope(''), 'kopi:read');
  assert.equal(normalizeScope(undefined), 'kopi:read');
  assert.equal(hasScope('kopi:read', 'kopi:stock:write'), false);
  assert.equal(hasScope('kopi:read kopi:stock:write', 'kopi:stock:write'), true);
});

test('slugify matches the Admin UI slug rules', async () => {
  const { slugifyProductName } = await import('../../src/services/products');
  assert.equal(slugifyProductName('Gula Pasir 1kg!'), 'gula-pasir-1kg');
  assert.equal(slugifyProductName('  Kopi   Tubruk '), 'kopi-tubruk');
});

test('receipt preview: restock, kg conversion, create blocked without selling price', async () => {
  const { buildReceiptPreview } = await import('../../src/services/receipt');
  const products: any[] = [
    {
      id: 1, name: 'Gula Pasir', slug: 'gula-pasir', description: null, imageUrl: null,
      pricePer250g: 18000, unitType: 'gram', stock: '2000', isActive: true, createdAt: new Date(),
    },
  ];
  const preview = buildReceiptPreview(
    [
      { name: 'Gula Pasir', quantity: 1, unit: 'kg' },
      { name: 'Susu UHT', quantity: 12, unit: 'pcs' },
    ],
    products,
  );
  assert.equal(preview.items[0].action, 'restock');
  assert.equal(preview.items[0].quantity, 1000);
  assert.equal(preview.items[0].stockAfter, 3000);
  assert.equal(preview.items[1].action, 'blocked');
  assert.equal(preview.canApply, false);

  const withPrice = buildReceiptPreview(
    [{ name: 'Susu UHT', quantity: 12, unit: 'pcs', sellingPricePer250g: 6500 }],
    products,
  );
  assert.equal(withPrice.items[0].action, 'create');
  assert.equal(withPrice.canApply, true);
});

test('receipt preview: unit mismatch is blocked', async () => {
  const { buildReceiptPreview } = await import('../../src/services/receipt');
  const products: any[] = [
    {
      id: 2, name: 'Telur', slug: 'telur', description: null, imageUrl: null,
      pricePer250g: 2500, unitType: 'piece', stock: '30', isActive: true, createdAt: new Date(),
    },
  ];
  const preview = buildReceiptPreview([{ name: 'Telur', quantity: 500, unit: 'g' }], products);
  assert.equal(preview.items[0].action, 'blocked');
  assert.equal(preview.canApply, false);
});

import { randomBytes } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { db } from '../../db';
import { mcpOauthClients } from '../../db/schema';
import {
  getAuthorizationEndpoint,
  getMcpOAuthIssuer,
  getMcpResourceUrl,
  getRegistrationEndpoint,
  getTokenEndpoint,
  isDcrEnabled,
  isMcpOAuthEnabled,
  MCP_SCOPES,
  normalizeScope,
} from './config';
import { createAuthorizationCode, consumeAuthorizationCode } from './codes';
import { verifyPkceS256 } from './pkce';
import { issueMcpAccessToken } from './tokens';
import {
  hashClientSecret,
  isRedirectUriAllowed,
  timingSafeStringEqual,
  validateClientCredentials,
} from './clients';
import {
  adminSessionCookieHeader,
  createAdminSession,
  createPendingAuthorization,
  deletePendingAuthorization,
  getAdminSession,
  getPendingAuthorization,
  isLoginRateLimited,
  recordFailedLogin,
  verifyAdminCredentials,
  type PendingAuthorization,
} from './admin-session';

function oauthError(res: Response, status: number, error: string, description?: string): void {
  res.status(status).json({ error, error_description: description });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildRedirectUrl(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — Kopi Kita</title>
<style>
  body { font-family: system-ui, sans-serif; background: #4a2e1b; color: #3b2313; margin: 0; min-height: 100vh; display: grid; place-items: center; }
  .card { width: min(440px, 92vw); background: #fff8eb; border-radius: 20px; padding: 28px; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
  h1 { margin: 0 0 8px; font-size: 1.3rem; } p { color: #825e43; line-height: 1.5; }
  label { display: block; font-size: .8rem; font-weight: 700; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: .04em; }
  input { width: 100%; box-sizing: border-box; padding: 11px 12px; border: 2px solid #e6d5b8; border-radius: 10px; background: #f7ede1; }
  .scope { background: #f7ede1; border-radius: 10px; padding: 12px 14px; font-family: ui-monospace, monospace; font-size: .88rem; word-break: break-all; }
  .actions { display: flex; gap: 12px; margin-top: 20px; }
  button { flex: 1; border-radius: 10px; padding: 12px 14px; font-weight: 700; border: none; cursor: pointer; }
  .approve { background: #e68a2e; color: #fff; } .deny { background: transparent; color: #825e43; border: 1px solid #e6d5b8; }
  .error { background: #fce8e6; color: #d93025; padding: 10px 12px; border-radius: 10px; font-size: .9rem; }
</style></head><body><div class="card">${body}</div></body></html>`;
}

function renderLoginPage(pendingId: string, error?: string): string {
  return pageShell(
    'Masuk Admin',
    `<h1>Masuk Admin Kopi Kita</h1>
     <p>Masuk untuk mengizinkan aplikasi AI mengakses MCP Kopi Kita.</p>
     ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
     <form method="POST" action="/oauth/login">
       <input type="hidden" name="pending" value="${escapeHtml(pendingId)}" />
       <label for="email">Email</label>
       <input id="email" name="email" type="email" required autocomplete="username" />
       <label for="password">Password</label>
       <input id="password" name="password" type="password" required autocomplete="current-password" />
       <div class="actions"><button class="approve" type="submit">Masuk</button></div>
     </form>`,
  );
}

function renderConsentPage(pendingAuth: PendingAuthorization): string {
  return pageShell(
    'Izinkan Akses MCP',
    `<h1>Izinkan akses MCP?</h1>
     <p>Aplikasi <strong>${escapeHtml(pendingAuth.clientId)}</strong> meminta akses ke MCP Kopi Kita atas nama admin.</p>
     <div class="scope">scope: ${escapeHtml(pendingAuth.scope)}</div>
     <p>kopi:read = lihat produk/stok/saldo/riwayat. kopi:products:write = buat/ubah produk. kopi:stock:write = ubah stok. Tidak ada akses pencairan dana.</p>
     <form method="POST" action="/oauth/consent">
       <input type="hidden" name="pending" value="${escapeHtml(pendingAuth.id)}" />
       <input type="hidden" name="csrf" value="${escapeHtml(pendingAuth.csrfToken)}" />
       <div class="actions">
         <button class="deny" type="submit" name="decision" value="deny">Tolak</button>
         <button class="approve" type="submit" name="decision" value="approve">Izinkan</button>
       </div>
     </form>`,
  );
}

async function handleAuthorize(req: Request, res: Response): Promise<void> {
  const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : undefined;
  const redirectUri = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : undefined;
  const responseType = typeof req.query.response_type === 'string' ? req.query.response_type : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const scope = normalizeScope(typeof req.query.scope === 'string' ? req.query.scope : 'kopi:read');
  const codeChallenge = typeof req.query.code_challenge === 'string' ? req.query.code_challenge : undefined;
  const codeChallengeMethod =
    typeof req.query.code_challenge_method === 'string' ? req.query.code_challenge_method : undefined;

  if (!clientId || !redirectUri || responseType !== 'code') {
    oauthError(res, 400, 'invalid_request', 'client_id, redirect_uri, and response_type=code are required.');
    return;
  }
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    oauthError(res, 400, 'invalid_request', 'PKCE with code_challenge_method=S256 is required.');
    return;
  }
  if (!(await isRedirectUriAllowed(clientId, redirectUri))) {
    oauthError(res, 400, 'invalid_request', 'redirect_uri is not allowed for this client.');
    return;
  }

  const pendingAuth = createPendingAuthorization({ clientId, redirectUri, scope, state, codeChallenge });
  if (!getAdminSession(req)) {
    res.redirect(`/oauth/login?pending=${encodeURIComponent(pendingAuth.id)}`);
    return;
  }
  res.redirect(`/oauth/consent?pending=${encodeURIComponent(pendingAuth.id)}`);
}

function handleLoginGet(req: Request, res: Response): void {
  const pendingAuth = getPendingAuthorization(typeof req.query.pending === 'string' ? req.query.pending : undefined);
  if (!pendingAuth) {
    oauthError(res, 400, 'invalid_request', 'Authorization request is missing or expired. Start again from your MCP client.');
    return;
  }
  if (getAdminSession(req)) {
    res.redirect(`/oauth/consent?pending=${encodeURIComponent(pendingAuth.id)}`);
    return;
  }
  res.status(200).type('html').send(renderLoginPage(pendingAuth.id));
}

function handleLoginPost(req: Request, res: Response): void {
  const body = (req.body || {}) as Record<string, unknown>;
  const pendingAuth = getPendingAuthorization(typeof body.pending === 'string' ? body.pending : undefined);
  if (!pendingAuth) {
    oauthError(res, 400, 'invalid_request', 'Authorization request is missing or expired. Start again from your MCP client.');
    return;
  }
  const ip = req.ip || 'unknown';
  if (isLoginRateLimited(ip)) {
    res.status(429).type('html').send(renderLoginPage(pendingAuth.id, 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.'));
    return;
  }
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!verifyAdminCredentials(email, password)) {
    recordFailedLogin(ip);
    res.status(401).type('html').send(renderLoginPage(pendingAuth.id, 'Email atau password salah.'));
    return;
  }
  const sessionId = createAdminSession(email);
  res.setHeader('Set-Cookie', adminSessionCookieHeader(sessionId));
  res.redirect(`/oauth/consent?pending=${encodeURIComponent(pendingAuth.id)}`);
}

function handleConsentGet(req: Request, res: Response): void {
  const pendingAuth = getPendingAuthorization(typeof req.query.pending === 'string' ? req.query.pending : undefined);
  if (!pendingAuth) {
    oauthError(res, 400, 'invalid_request', 'Authorization request is missing or expired. Start again from your MCP client.');
    return;
  }
  if (!getAdminSession(req)) {
    res.redirect(`/oauth/login?pending=${encodeURIComponent(pendingAuth.id)}`);
    return;
  }
  res.status(200).type('html').send(renderConsentPage(pendingAuth));
}

function handleConsentPost(req: Request, res: Response): void {
  const session = getAdminSession(req);
  if (!session) {
    oauthError(res, 401, 'login_required', 'Admin login is required.');
    return;
  }
  const body = (req.body || {}) as Record<string, unknown>;
  const pendingAuth = getPendingAuthorization(typeof body.pending === 'string' ? body.pending : undefined);
  if (!pendingAuth) {
    oauthError(res, 400, 'invalid_request', 'Authorization request is missing or expired. Start again from your MCP client.');
    return;
  }
  if (!timingSafeStringEqual(typeof body.csrf === 'string' ? body.csrf : undefined, pendingAuth.csrfToken)) {
    oauthError(res, 403, 'invalid_request', 'Invalid CSRF token.');
    return;
  }
  deletePendingAuthorization(pendingAuth.id);
  if (body.decision !== 'approve') {
    res.redirect(
      buildRedirectUrl(pendingAuth.redirectUri, {
        error: 'access_denied',
        error_description: 'Admin denied the authorization request',
        ...(pendingAuth.state ? { state: pendingAuth.state } : {}),
      }),
    );
    return;
  }
  const code = createAuthorizationCode({
    clientId: pendingAuth.clientId,
    redirectUri: pendingAuth.redirectUri,
    codeChallenge: pendingAuth.codeChallenge,
    scope: pendingAuth.scope,
    sub: session.email,
  });
  res.redirect(
    buildRedirectUrl(pendingAuth.redirectUri, {
      code,
      ...(pendingAuth.state ? { state: pendingAuth.state } : {}),
    }),
  );
}

function parseClientCredentials(req: Request): { clientId?: string; clientSecret?: string } {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const separatorIndex = decoded.indexOf(':');
      if (separatorIndex >= 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, separatorIndex)),
          clientSecret: decodeURIComponent(decoded.slice(separatorIndex + 1)),
        };
      }
    } catch {
      return {};
    }
  }
  const body = (req.body || {}) as Record<string, unknown>;
  return {
    clientId: typeof body.client_id === 'string' ? body.client_id : undefined,
    clientSecret: typeof body.client_secret === 'string' ? body.client_secret : undefined,
  };
}

async function handleToken(req: Request, res: Response): Promise<void> {
  const grantType = typeof req.body?.grant_type === 'string' ? req.body.grant_type : undefined;
  if (grantType !== 'authorization_code') {
    oauthError(res, 400, 'unsupported_grant_type', 'Only authorization_code is supported. Reconnect to get a new token.');
    return;
  }
  const code = typeof req.body?.code === 'string' ? req.body.code : undefined;
  const redirectUri = typeof req.body?.redirect_uri === 'string' ? req.body.redirect_uri : undefined;
  const codeVerifier = typeof req.body?.code_verifier === 'string' ? req.body.code_verifier : undefined;
  const { clientId: headerClientId, clientSecret } = parseClientCredentials(req);
  const clientId = typeof req.body?.client_id === 'string' ? req.body.client_id : headerClientId;

  if (!code || !redirectUri || !clientId) {
    oauthError(res, 400, 'invalid_request', 'code, redirect_uri, and client_id are required.');
    return;
  }
  if (!(await validateClientCredentials(clientId, clientSecret))) {
    oauthError(res, 401, 'invalid_client', 'Client authentication failed.');
    return;
  }
  const record = consumeAuthorizationCode(code);
  if (!record) {
    oauthError(res, 400, 'invalid_grant', 'Authorization code is invalid, expired, or already used. Start the authorization flow again.');
    return;
  }
  if (record.clientId !== clientId || record.redirectUri !== redirectUri) {
    oauthError(res, 400, 'invalid_grant', 'Authorization code does not match the client or redirect_uri.');
    return;
  }
  if (!verifyPkceS256(codeVerifier, record.codeChallenge)) {
    oauthError(res, 400, 'invalid_grant', 'PKCE verification failed.');
    return;
  }
  const { accessToken, expiresIn } = issueMcpAccessToken({
    sub: record.sub,
    clientId,
    scope: record.scope,
  });
  res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn, scope: record.scope });
}

async function handleRegister(req: Request, res: Response): Promise<void> {
  if (!isDcrEnabled()) {
    oauthError(res, 404, 'not_found', 'Dynamic client registration is disabled.');
    return;
  }
  if (!db) {
    oauthError(res, 503, 'server_error', 'Database not configured.');
    return;
  }
  const body = (req.body || {}) as Record<string, unknown>;
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === 'string')
    : [];
  if (redirectUris.length === 0) {
    oauthError(res, 400, 'invalid_redirect_uri', 'redirect_uris is required.');
    return;
  }
  for (const uri of redirectUris) {
    try {
      const parsed = new URL(uri);
      const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (parsed.protocol !== 'https:' && !(isLocalhost && parsed.protocol === 'http:')) throw new Error('scheme');
    } catch {
      oauthError(res, 400, 'invalid_redirect_uri', `redirect_uri must be https (or http on localhost): ${uri}`);
      return;
    }
  }
  const authMethod =
    typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'client_secret_post';
  if (!['client_secret_post', 'client_secret_basic', 'none'].includes(authMethod)) {
    oauthError(res, 400, 'invalid_client_metadata', 'Unsupported token_endpoint_auth_method.');
    return;
  }
  const clientId = `kopi-${randomBytes(16).toString('hex')}`;
  const clientSecret = authMethod === 'none' ? undefined : randomBytes(32).toString('base64url');
  const scope = normalizeScope(typeof body.scope === 'string' ? body.scope : 'kopi:read');
  await db.insert(mcpOauthClients).values({
    clientId,
    clientSecretHash: clientSecret ? hashClientSecret(clientSecret) : null,
    clientName: typeof body.client_name === 'string' ? body.client_name : null,
    redirectUris: JSON.stringify(redirectUris),
    tokenEndpointAuthMethod: authMethod,
    scope,
  });
  res.status(201).json({
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    client_name: typeof body.client_name === 'string' ? body.client_name : undefined,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: authMethod,
    scope,
  });
}

function handleAuthorizationServerMetadata(_req: Request, res: Response): void {
  res.json({
    issuer: getMcpOAuthIssuer(),
    authorization_endpoint: getAuthorizationEndpoint(),
    token_endpoint: getTokenEndpoint(),
    ...(isDcrEnabled() ? { registration_endpoint: getRegistrationEndpoint() } : {}),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    scopes_supported: [...MCP_SCOPES],
    client_id_metadata_document_supported: true,
  });
}

function handleProtectedResourceMetadata(_req: Request, res: Response): void {
  res.json({
    resource: getMcpResourceUrl(),
    authorization_servers: [getMcpOAuthIssuer()],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
  });
}

export function mountMcpOAuth(app: express.Application): void {
  if (!isMcpOAuthEnabled()) return;
  const urlencoded = express.urlencoded({ extended: false });
  app.get('/.well-known/oauth-authorization-server', handleAuthorizationServerMetadata);
  app.get('/.well-known/oauth-protected-resource', handleProtectedResourceMetadata);
  app.get('/.well-known/oauth-protected-resource/mcp', handleProtectedResourceMetadata);
  app.get('/oauth/authorize', (req, res) => void handleAuthorize(req, res));
  app.get('/oauth/login', handleLoginGet);
  app.post('/oauth/login', urlencoded, handleLoginPost);
  app.get('/oauth/consent', handleConsentGet);
  app.post('/oauth/consent', urlencoded, handleConsentPost);
  app.post('/oauth/token', urlencoded, (req, res) => void handleToken(req, res));
  app.post('/oauth/register', express.json(), (req, res) => void handleRegister(req, res));
  console.log(
    `MCP OAuth enabled (issuer: ${getMcpOAuthIssuer()}, authorize: /oauth/authorize, token: /oauth/token, DCR: ${isDcrEnabled()})`,
  );
}



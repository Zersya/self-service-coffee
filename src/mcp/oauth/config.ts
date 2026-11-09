function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export const MCP_SCOPES = ['kopi:read', 'kopi:products:write', 'kopi:stock:write'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export function normalizeScope(scope?: string | null): string {
  const requested = (scope || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = requested.filter((s) => (MCP_SCOPES as readonly string[]).includes(s));
  return (allowed.length ? [...new Set(allowed)] : ['kopi:read']).join(' ');
}

export function hasScope(scope: string | undefined, required: string): boolean {
  return (scope || '').split(/\s+/).includes(required);
}

export function getMcpOAuthIssuer(): string {
  const fromEnv = process.env.MCP_OAUTH_ISSUER?.trim() || process.env.APP_URL?.trim();
  if (fromEnv) return trimTrailingSlash(fromEnv);
  return 'http://localhost:3000';
}

export function getMcpResourceUrl(): string {
  return `${getMcpOAuthIssuer()}/mcp`;
}

export function getMcpOAuthClientId(): string | undefined {
  return process.env.MCP_OAUTH_CLIENT_ID?.trim() || undefined;
}

export function getMcpOAuthClientSecret(): string | undefined {
  return process.env.MCP_OAUTH_CLIENT_SECRET?.trim() || undefined;
}

export function getMcpOAuthSigningSecret(): string | undefined {
  return process.env.MCP_OAUTH_SIGNING_SECRET?.trim() || undefined;
}

/** OAuth is enabled only with a complete static client + signing secret. No fallback secret. */
export function isMcpOAuthEnabled(): boolean {
  return Boolean(getMcpOAuthClientId() && getMcpOAuthClientSecret() && getMcpOAuthSigningSecret());
}

/** DCR is always on when OAuth is on, so every client (incl. Gemini) self-registers automatically. */
export function isDcrEnabled(): boolean {
  return isMcpOAuthEnabled();
}

export function getStaticToken(): string | undefined {
  return process.env.MCP_STATIC_TOKEN?.trim() || undefined;
}

export function getMcpOAuthTokenExpirySeconds(): number {
  const parsed = Number.parseInt(process.env.MCP_OAUTH_TOKEN_EXPIRY || '3600', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3600;
}

export function getConfiguredRedirectUris(): string[] {
  const raw = process.env.MCP_OAUTH_REDIRECT_URIS?.trim();
  if (!raw) return [];
  return raw.split(',').map((uri) => uri.trim()).filter(Boolean);
}

export function getAuthorizationEndpoint(): string {
  return `${getMcpOAuthIssuer()}/oauth/authorize`;
}

export function getTokenEndpoint(): string {
  return `${getMcpOAuthIssuer()}/oauth/token`;
}

export function getRegistrationEndpoint(): string {
  return `${getMcpOAuthIssuer()}/oauth/register`;
}

export function getProtectedResourceMetadataUrl(): string {
  return `${getMcpOAuthIssuer()}/.well-known/oauth-protected-resource/mcp`;
}

export function getAdminEmail(): string | undefined {
  return process.env.ADMIN_EMAIL?.trim() || undefined;
}

export function getAdminPassword(): string | undefined {
  return process.env.ADMIN_PASSWORD || undefined;
}

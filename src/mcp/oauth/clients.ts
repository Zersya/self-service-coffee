import { createHash, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { mcpOauthClients } from '../../db/schema';
import {
  getConfiguredRedirectUris,
  getMcpOAuthClientId,
  getMcpOAuthClientSecret,
  isDcrEnabled,
} from './config';

export function timingSafeStringEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function hashClientSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function isUrlClientId(clientId: string): boolean {
  return /^https:\/\//i.test(clientId);
}

export function isGoogleHostedRedirectUri(redirectUri: string): boolean {
  try {
    const hostname = new URL(redirectUri).hostname.toLowerCase();
    return (
      hostname === 'google.com' ||
      hostname.endsWith('.google.com') ||
      hostname.endsWith('.googleapis.com') ||
      hostname.endsWith('.googleusercontent.com') ||
      hostname.endsWith('.gstatic.com')
    );
  } catch {
    return false;
  }
}

interface ClientIdMetadataDocument {
  client_id?: string;
  redirect_uris?: string[];
}

const cimdCache = new Map<string, { expiresAt: number; redirectUris: string[] }>();
const CIMD_CACHE_TTL_MS = 5 * 60 * 1000;
const CIMD_MAX_BYTES = 64 * 1024;

export async function fetchCimdRedirectUris(clientIdUrl: string): Promise<string[] | null> {
  if (!isUrlClientId(clientIdUrl)) return null;
  const cached = cimdCache.get(clientIdUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.redirectUris;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(clientIdUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'error',
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > CIMD_MAX_BYTES) return null;
    const document = JSON.parse(text) as ClientIdMetadataDocument;
    // CIMD: the document must claim exactly the URL used as client_id.
    if (document.client_id !== clientIdUrl) return null;
    const redirectUris = Array.isArray(document.redirect_uris)
      ? document.redirect_uris.filter((uri): uri is string => typeof uri === 'string')
      : [];
    cimdCache.set(clientIdUrl, { expiresAt: Date.now() + CIMD_CACHE_TTL_MS, redirectUris });
    return redirectUris;
  } catch {
    return null;
  }
}

export function validateStaticClientCredentials(
  clientId: string | undefined,
  clientSecret: string | undefined,
): boolean {
  const expectedClientId = getMcpOAuthClientId();
  const expectedClientSecret = getMcpOAuthClientSecret();
  if (!expectedClientId || !expectedClientSecret || !clientId) return false;
  return (
    timingSafeStringEqual(clientId, expectedClientId) &&
    timingSafeStringEqual(clientSecret, expectedClientSecret)
  );
}

export async function findDynamicClient(clientId: string) {
  if (!db || !isDcrEnabled()) return null;
  const rows = await db
    .select()
    .from(mcpOauthClients)
    .where(eq(mcpOauthClients.clientId, clientId))
    .limit(1);
  return rows[0] ?? null;
}

export async function validateDynamicClientCredentials(
  clientId: string,
  clientSecret: string | undefined,
): Promise<boolean> {
  const client = await findDynamicClient(clientId);
  if (!client) return false;
  if (!client.clientSecretHash) return !clientSecret; // public client (auth method none)
  if (!clientSecret) return false;
  return timingSafeStringEqual(hashClientSecret(clientSecret), client.clientSecretHash);
}

/** True when the client is known: static, CIMD URL, or DCR-registered. */
export async function validateClientCredentials(
  clientId: string,
  clientSecret: string | undefined,
): Promise<boolean> {
  if (validateStaticClientCredentials(clientId, clientSecret)) return true;
  if (isUrlClientId(clientId)) return true; // public CIMD client; PKCE is mandatory
  return validateDynamicClientCredentials(clientId, clientSecret);
}

export async function isRedirectUriAllowed(clientId: string, redirectUri: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }
  const isLocalhost =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !(isLocalhost && parsed.protocol === 'http:')) return false;

  // Native/desktop clients use loopback redirects on a random port (RFC 8252),
  // so they cannot be pre-configured. The admin login + consent still gates this.
  if (isLocalhost) return true;

  if (getConfiguredRedirectUris().includes(redirectUri)) return true;

  const staticClientId = getMcpOAuthClientId();
  if (staticClientId && clientId === staticClientId && isGoogleHostedRedirectUri(redirectUri)) {
    console.warn(`MCP OAuth: allowing Google-hosted redirect for static client: ${redirectUri}`);
    return true;
  }

  if (isUrlClientId(clientId)) {
    const cimdRedirects = await fetchCimdRedirectUris(clientId);
    if (cimdRedirects?.includes(redirectUri)) return true;
    // Gemini Spark may use cross-origin Google redirect URIs with CIMD client IDs.
    if (isGoogleHostedRedirectUri(redirectUri)) {
      console.warn(`MCP OAuth: allowing Google-hosted redirect for CIMD client: ${redirectUri}`);
      return true;
    }
    return false;
  }

  const dynamic = await findDynamicClient(clientId);
  if (dynamic) {
    try {
      const uris = JSON.parse(dynamic.redirectUris) as string[];
      return Array.isArray(uris) && uris.includes(redirectUri);
    } catch {
      return false;
    }
  }

  // Static client: only explicitly configured redirects (or Google exception above).
  if (staticClientId && clientId === staticClientId) return false;
  return false;
}

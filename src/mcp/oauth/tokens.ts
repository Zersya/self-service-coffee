import jwt from 'jsonwebtoken';
import {
  getMcpOAuthIssuer,
  getMcpOAuthSigningSecret,
  getMcpOAuthTokenExpirySeconds,
  getMcpResourceUrl,
} from './config';

export interface McpAccessTokenPayload {
  sub: string;
  aud: string;
  iss: string;
  scope: string;
  client_id: string;
  type: 'mcp_access';
  exp?: number;
  iat?: number;
}

export function issueMcpAccessToken(input: {
  sub: string;
  clientId: string;
  scope: string;
}): { accessToken: string; expiresIn: number } {
  const secret = getMcpOAuthSigningSecret();
  if (!secret) throw new Error('MCP_OAUTH_SIGNING_SECRET is not configured');
  const expiresIn = getMcpOAuthTokenExpirySeconds();
  // aud/iss/sub are set via sign options below (jsonwebtoken rejects duplicates).
  const payload = {
    scope: input.scope,
    client_id: input.clientId,
    type: 'mcp_access' as const,
  };
  const accessToken = jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn,
    issuer: getMcpOAuthIssuer(),
    audience: getMcpResourceUrl(),
    subject: input.sub,
  });
  return { accessToken, expiresIn };
}

export function verifyMcpAccessToken(token: string): McpAccessTokenPayload | null {
  const secret = getMcpOAuthSigningSecret();
  if (!secret) return null;
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      audience: getMcpResourceUrl(),
      issuer: getMcpOAuthIssuer(),
    }) as McpAccessTokenPayload;
    if (decoded.type !== 'mcp_access' || decoded.aud !== getMcpResourceUrl()) return null;
    return decoded;
  } catch {
    return null;
  }
}

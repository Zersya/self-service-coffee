import type { NextFunction, Request, Response } from 'express';
import {
  getProtectedResourceMetadataUrl,
  getStaticToken,
  isMcpOAuthEnabled,
  MCP_SCOPES,
} from './oauth/config';
import { verifyMcpAccessToken } from './oauth/tokens';
import { timingSafeStringEqual } from './oauth/clients';

export interface McpAuthInfo {
  sub: string;
  clientId: string;
  scope: string;
  expiresAt?: number;
}

export type McpRequest = Request & { mcpAuth?: McpAuthInfo };

export function hasMcpScope(auth: McpAuthInfo | undefined, required: string): boolean {
  return !!auth && auth.scope.split(/\s+/).includes(required);
}

function sendUnauthorized(res: Response, message: string): void {
  if (isMcpOAuthEnabled()) {
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${getProtectedResourceMetadataUrl()}", scope="${MCP_SCOPES.join(' ')}"`,
    );
  }
  res.status(401).json({ error: message });
}

export function isMcpEnabled(): boolean {
  return Boolean(getStaticToken() || isMcpOAuthEnabled());
}

export function mcpAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isMcpEnabled()) {
    res.status(503).json({ error: 'MCP authentication is not configured on the server.' });
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    sendUnauthorized(res, 'Unauthorized: Missing or invalid Authorization header. Use Bearer token from the OAuth flow.');
    return;
  }
  const token = authHeader.slice(7);

  const staticToken = getStaticToken();
  if (staticToken && timingSafeStringEqual(token, staticToken)) {
    (req as McpRequest).mcpAuth = { sub: 'local-static', clientId: 'static-local', scope: 'kopi:read' };
    next();
    return;
  }

  if (isMcpOAuthEnabled()) {
    const payload = verifyMcpAccessToken(token);
    if (payload) {
      (req as McpRequest).mcpAuth = {
        sub: payload.sub,
        clientId: payload.client_id,
        scope: payload.scope,
        expiresAt: payload.exp,
      };
      next();
      return;
    }
  }

  sendUnauthorized(res, 'Unauthorized: Invalid or expired access token. Reconnect and complete the OAuth flow again.');
}

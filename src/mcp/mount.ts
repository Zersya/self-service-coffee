import { randomUUID } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { isMcpEnabled, mcpAuth, type McpRequest } from './auth';
import { mountMcpOAuth } from './oauth/mount';
import { getMcpOAuthIssuer } from './oauth/config';
import { registerKopiTools } from './tools';

function createMcpServer(auth: McpRequest['mcpAuth']): McpServer {
  const server = new McpServer({ name: 'kopi-kita-mcp-server', version: '1.0.0' });
  registerKopiTools(server, auth!);
  return server;
}

function isOriginAllowed(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const issuer = new URL(getMcpOAuthIssuer());
    if (originUrl.origin === issuer.origin) return true;
    const host = req.headers.host;
    if (host && originUrl.host === host) return true;
    if (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Mount Kopi Kita MCP on the existing Express app at /mcp.
 * Stateful Streamable HTTP (POST + GET SSE + DELETE). Per-session server
 * captures the OAuth identity/scope verified at initialize time.
 */
export function mountMcp(app: express.Application): void {
  mountMcpOAuth(app);

  if (!isMcpEnabled()) {
    console.warn('MCP is disabled — set MCP_OAUTH_* (and optionally MCP_STATIC_TOKEN).');
    return;
  }

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  const guard = (req: Request, res: Response, next: express.NextFunction): void => {
    if (!isOriginAllowed(req)) {
      res.status(403).json({ error: 'Forbidden origin' });
      return;
    }
    mcpAuth(req, res, next);
  };

  const mcpPostHandler = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    try {
      let transport: StreamableHTTPServerTransport | undefined;
      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports[id] = transport!;
          },
        });
        transport.onclose = () => {
          const sid = transport?.sessionId;
          if (sid && transports[sid]) delete transports[sid];
        };
        const server = createMcpServer((req as McpRequest).mcpAuth);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        });
        return;
      }
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP POST error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  };

  const mcpSessionHandler = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(404).send('Invalid or missing session ID');
      return;
    }
    try {
      await transports[sessionId].handleRequest(req, res);
    } catch (error) {
      console.error('MCP session error:', error);
      if (!res.headersSent) res.status(500).send('Error handling MCP session request');
    }
  };

  app.post('/mcp', guard, mcpPostHandler);
  app.get('/mcp', guard, mcpSessionHandler);
  app.delete('/mcp', guard, mcpSessionHandler);

  console.log('Kopi Kita MCP endpoint enabled at /mcp (POST/GET/DELETE, OAuth Bearer or static read-only token)');
}

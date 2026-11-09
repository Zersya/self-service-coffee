import { db } from '../db';
import { mcpAuditLogs } from '../db/schema';

export async function writeAudit(input: {
  actorSub: string;
  clientId: string;
  toolName: string;
  action: string;
  targetType?: string;
  targetId?: number;
  targetSlug?: string;
  before?: unknown;
  after?: unknown;
  idempotencyKey?: string;
  success?: boolean;
  error?: string;
}): Promise<void> {
  if (!db) return;
  try {
    await db.insert(mcpAuditLogs).values({
      actorSub: input.actorSub,
      clientId: input.clientId,
      toolName: input.toolName,
      action: input.action,
      targetType: input.targetType || null,
      targetId: input.targetId ?? null,
      targetSlug: input.targetSlug || null,
      beforeJson: input.before === undefined ? null : JSON.stringify(input.before),
      afterJson: input.after === undefined ? null : JSON.stringify(input.after),
      idempotencyKey: input.idempotencyKey || null,
      success: input.success ?? true,
      error: input.error || null,
    });
  } catch (e) {
    // Audit failure must not mask the completed write; surface in logs.
    console.error('MCP audit write failed:', e);
  }
}

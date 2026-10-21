import { prisma } from '@/lib/db/prisma';

export interface AuditLogParams {
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Creates an append-only audit log entry.
 * Note: audit_logs table is protected by PostgreSQL triggers and REVOKE permissions (C1).
 */
export async function logAuditEvent(params: AuditLogParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId || null,
        userEmail: params.userEmail || null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId || null,
        changes: params.changes ? (params.changes as object) : undefined,
        metadata: params.metadata ? (params.metadata as object) : undefined,
      },
    });
  } catch (error) {
    // Audit logging failure should be logged with high severity
    console.error('[AuditLogError] Failed to record audit log:', error);
  }
}

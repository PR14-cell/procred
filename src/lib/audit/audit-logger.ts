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

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Creates an append-only audit log entry.
 * Note: audit_logs table is protected by PostgreSQL triggers and REVOKE permissions (C1).
 */
export async function logAuditEvent(params: AuditLogParams): Promise<void> {
  try {
    const isEntityUuid = params.entityId ? UUID_REGEX.test(params.entityId) : false;
    const validEntityId = isEntityUuid ? params.entityId : null;

    const isUserUuid = params.userId ? UUID_REGEX.test(params.userId) : false;
    const validUserId = isUserUuid ? params.userId : null;

    const metadata = {
      ...(params.metadata || {}),
      ...(!isEntityUuid && params.entityId ? { entityIdentifier: params.entityId } : {}),
      ...(!isUserUuid && params.userId ? { userIdentifier: params.userId } : {}),
    };

    try {
      await prisma.auditLog.create({
        data: {
          userId: validUserId,
          userEmail: params.userEmail || null,
          action: params.action,
          entityType: params.entityType,
          entityId: validEntityId,
          changes: params.changes ? (params.changes as object) : undefined,
          metadata: Object.keys(metadata).length > 0 ? (metadata as object) : undefined,
        },
      });
    } catch (createErr: any) {
      // If foreign key constraint on userId fails (e.g. system actor or test ID),
      // record with userId: null and preserve unlinkedUserId in metadata
      if (createErr?.code === 'P2003' && validUserId) {
        await prisma.auditLog.create({
          data: {
            userId: null,
            userEmail: params.userEmail || null,
            action: params.action,
            entityType: params.entityType,
            entityId: validEntityId,
            changes: params.changes ? (params.changes as object) : undefined,
            metadata: { ...metadata, unlinkedUserId: validUserId } as object,
          },
        });
      } else {
        throw createErr;
      }
    }
  } catch (error) {
    // Audit logging failure should be logged with high severity
    console.error('[AuditLogError] Failed to record audit log:', error);
  }
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { BackupService } from '@/lib/backup/backup-service';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { assertFreshTotp } from '@/lib/auth/totp-challenge';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

const restoreRequestSchema = z.object({
  confirmRestore: z.literal('RESTORE_CONFIRM', {
    errorMap: () => ({ message: 'Exact confirmation "RESTORE_CONFIRM" is required.' }),
  }),
  createRecoveryPoint: z.boolean().default(true),
});

// Explicitly reject GET requests to prevent any accidental or automated restoration
export const GET = () => {
  // Method not allowed: restore operations require POST with requireAuth
  return NextResponse.json(
    { error: 'GET method is prohibited for restore operations. Restores must be explicitly confirmed via POST.' },
    { status: 405 }
  );
};

// POST /api/v1/admin/backup/[id]/restore - Execute protected system restore
export const POST = withErrorHandler(
  async (req: Request, context?: RouteContext) => {
    // Only super_admin holds system:restore permission
    const session = await requireAuth(req, 'system:restore');
    const backupId = context?.params.id;

    if (!backupId) {
      throw ApiError.badRequest('Backup ID is required.');
    }

    const body = await req.json().catch(() => ({}));
    const validated = restoreRequestSchema.parse(body);

    // Require fresh TOTP verification for system restore
    await assertFreshTotp(req, session.userId, body);

    const manifest = await BackupService.getBackup(backupId);
    if (!manifest) {
      throw ApiError.notFound(`Backup '${backupId}' not found.`);
    }

    // 1. Audit preflight initiation
    await logAuditEvent({
      userId: session.userId,
      userEmail: session.email,
      action: 'restore_preflight_initiated',
      entityType: 'system_backup',
      metadata: { backupId },
    });

    // 2. Execute protected restore
    const result = await BackupService.restoreBackup(backupId, {
      confirmRestore: validated.confirmRestore,
      createRecoveryPoint: validated.createRecoveryPoint,
    });

    // 3. Audit restore completion
    await logAuditEvent({
      userId: session.userId,
      userEmail: session.email,
      action: 'restore_completed',
      entityType: 'system_backup',
      metadata: {
        backupId,
        restoredAt: result.restoredAt,
        recoveryPointId: result.recoveryPointId,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'System restore completed successfully.',
      restoredAt: result.restoredAt,
      backupId: result.backupId,
      recoveryPointId: result.recoveryPointId,
    });
  }
);

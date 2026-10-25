import { NextResponse } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { BackupService } from '@/lib/backup/backup-service';
import { logAuditEvent } from '@/lib/audit/audit-logger';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// POST /api/v1/admin/backup/[id]/verify - Verify backup integrity
export const POST = withErrorHandler(
  async (req: Request, context?: RouteContext) => {
    const session = await requireAuth(req, 'system:backup');
    const backupId = context?.params.id;

    if (!backupId) {
      throw ApiError.badRequest('Backup ID is required.');
    }

    const manifest = await BackupService.getBackup(backupId);
    if (!manifest) {
      throw ApiError.notFound(`Backup '${backupId}' not found.`);
    }

    const verification = await BackupService.verifyBackupIntegrity(backupId);

    await logAuditEvent({
      userId: session.userId,
      userEmail: session.email,
      action: 'backup_verified',
      entityType: 'system_backup',
      metadata: {
        backupId,
        isValid: verification.isValid,
        errors: verification.errors,
        details: verification.details,
      },
    });

    return NextResponse.json({
      backupId,
      isValid: verification.isValid,
      errors: verification.errors,
      details: verification.details,
    });
  }
);

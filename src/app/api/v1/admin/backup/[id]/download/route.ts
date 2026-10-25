import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { BackupService } from '@/lib/backup/backup-service';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { assertFreshTotp } from '@/lib/auth/totp-challenge';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// GET /api/v1/admin/backup/[id]/download - Secure download of backup archive
export const GET = withErrorHandler(
  async (req: Request, context?: RouteContext) => {
    const session = await requireAuth(req, 'system:backup');
    await assertFreshTotp(req, session.userId);

    const backupId = context?.params.id;

    if (!backupId) {
      throw ApiError.badRequest('Backup ID is required.');
    }

    const manifest = await BackupService.getBackup(backupId);
    if (!manifest) {
      throw ApiError.notFound(`Backup '${backupId}' not found.`);
    }

    const { buffer, fileName } = await BackupService.getBackupArchiveBuffer(backupId);

    await logAuditEvent({
      userId: session.userId,
      userEmail: session.email,
      action: 'backup_downloaded',
      entityType: 'system_backup',
      metadata: {
        backupId,
        fileName,
        sizeBytes: buffer.length,
      },
    });

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  }
);

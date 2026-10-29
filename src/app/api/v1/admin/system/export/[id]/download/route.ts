import { NextResponse } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { SystemAdminService } from '@/lib/system/system-admin-service';
import { logAuditEvent } from '@/lib/audit/audit-logger';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    id: string;
  };
}

// GET /api/v1/admin/system/export/[id]/download - Securely stream backup ZIP archive
export const GET = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'system:backup');
  const backupId = context?.params.id;

  if (!backupId || backupId.includes('..') || backupId.includes('/') || backupId.includes('\\')) {
    throw ApiError.badRequest('Invalid backup identifier.');
  }

  try {
    const { buffer, fileName } = await SystemAdminService.getBackupZipBuffer(backupId);

    await logAuditEvent({
      userId: session.userId,
      userEmail: session.email,
      action: 'system_backup_downloaded',
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
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('not found')) {
      throw ApiError.notFound(`Backup archive '${backupId}' does not exist.`);
    }
    throw err;
  }
});

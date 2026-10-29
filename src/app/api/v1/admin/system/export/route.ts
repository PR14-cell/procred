import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { SystemAdminService } from '@/lib/system/system-admin-service';
import { logAuditEvent } from '@/lib/audit/audit-logger';

export const dynamic = 'force-dynamic';

// GET /api/v1/admin/system/export - List all complete backup archives
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'system:backup');

  const backups = await SystemAdminService.listBackups();

  return NextResponse.json({
    success: true,
    backups,
    total: backups.length,
  });
});

// POST /api/v1/admin/system/export - Trigger a new complete ZIP backup export
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'system:backup');

  const result = await SystemAdminService.createCompleteZipExport();

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'system_backup_exported',
    entityType: 'system_backup',
    metadata: {
      backupId: result.backupId,
      formatVersion: result.manifest.formatVersion,
      databaseSizeBytes: result.manifest.database.sizeBytes,
      documentsCount: result.manifest.documents.count,
      documentsSizeBytes: result.manifest.documents.sizeBytes,
      tablesCount: result.manifest.database.tableCount,
    },
  });

  return NextResponse.json(
    {
      success: true,
      message: 'Complete application ZIP backup created successfully.',
      backup: result.manifest,
    },
    { status: 201 }
  );
});

import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { BackupService } from '@/lib/backup/backup-service';
import { logAuditEvent } from '@/lib/audit/audit-logger';

export const dynamic = 'force-dynamic';

// GET /api/v1/admin/backup - List all backups
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'system:backup');

  const backups = await BackupService.listBackups();

  return NextResponse.json({
    backups,
    total: backups.length,
  });
});

// POST /api/v1/admin/backup - Trigger a new coordinated backup
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'system:backup');

  const manifest = await BackupService.createCoordinatedBackup();

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'backup_created',
    entityType: 'system_backup',
    metadata: {
      backupId: manifest.id,
      scope: manifest.scope,
      databaseSizeBytes: manifest.database.sizeBytes,
      documentsCount: manifest.documents.count,
      documentsSizeBytes: manifest.documents.sizeBytes,
    },
  });

  return NextResponse.json({
    success: true,
    message: 'Coordinated backup created successfully.',
    backup: manifest,
  }, { status: 201 });
});

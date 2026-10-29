import { NextResponse } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { SystemAdminService } from '@/lib/system/system-admin-service';
import { logAuditEvent } from '@/lib/audit/audit-logger';

export const dynamic = 'force-dynamic';

// POST /api/v1/admin/system/restore/validate - Stage 1 (Validate) & Stage 2 (Preview)
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'system:restore');

  const contentType = req.headers.get('content-type') || '';
  let zipBuffer: Buffer;

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof Blob)) {
      throw ApiError.badRequest('A backup ZIP archive file is required in form field "file".');
    }

    const arrayBuffer = await file.arrayBuffer();
    zipBuffer = Buffer.from(arrayBuffer);
  } else {
    // JSON body with backupId or zipBase64
    const body = await req.json().catch(() => ({}));
    if (body.backupId) {
      const { buffer } = await SystemAdminService.getBackupZipBuffer(body.backupId);
      zipBuffer = buffer;
    } else if (body.zipBase64) {
      zipBuffer = Buffer.from(body.zipBase64, 'base64');
    } else {
      throw ApiError.badRequest('Either multipart form file or JSON "backupId" is required.');
    }
  }

  // 1. Validate ZIP structure, path traversal, bomb protection, manifest checksums
  const validation = await SystemAdminService.validateZipArchive(zipBuffer);
  if (!validation.isValid) {
    return NextResponse.json(
      {
        success: false,
        isValid: false,
        errors: validation.errors,
        warnings: validation.warnings,
      },
      { status: 400 }
    );
  }

  // 2. Stage 2: Preview Summary & Conflict Detection
  const preview = await SystemAdminService.previewZipBackup(zipBuffer);

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'system_restore_validated',
    entityType: 'system_restore',
    metadata: {
      backupId: preview.backupId,
      isValid: preview.isValid,
      providersCount: preview.counts.providers,
      organizationsCount: preview.counts.organizations,
      documentsCount: preview.counts.documents,
    },
  });

  return NextResponse.json({
    success: true,
    isValid: true,
    preview,
  });
});

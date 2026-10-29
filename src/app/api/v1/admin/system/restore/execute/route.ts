import { NextResponse } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { SystemAdminService } from '@/lib/system/system-admin-service';
import { logAuditEvent } from '@/lib/audit/audit-logger';

export const dynamic = 'force-dynamic';

// Explicitly reject GET requests
export const GET = (req?: Request) => {
  // Method not allowed: restore operations require POST with requireAuth
  return NextResponse.json(
    { error: 'Method Not Allowed. Restore operations must use POST.' },
    { status: 405 }
  );
};

// POST /api/v1/admin/system/restore/execute - Stage 3 & Stage 4 Execution
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'system:restore');

  const contentType = req.headers.get('content-type') || '';
  let zipBuffer: Buffer;
  let mode: 'full' | 'selective' = 'full';
  let confirmPhrase = '';
  let sudoPassword = '';
  let mfaCode = '';
  let entityTypes: string[] = ['providers', 'organizations', 'enrollments', 'documents'];
  let conflictResolution: 'skip_existing' | 'overwrite_existing' = 'skip_existing';
  let backupId = '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    const file = formData.get('file');
    mode = (formData.get('mode') as any) || 'full';
    confirmPhrase = (formData.get('confirmPhrase') as string) || '';
    sudoPassword = (formData.get('sudoPassword') as string) || '';
    mfaCode = (formData.get('mfaCode') as string) || '';
    const rawEntities = formData.get('entityTypes');
    if (rawEntities && typeof rawEntities === 'string') {
      try {
        entityTypes = JSON.parse(rawEntities);
      } catch {
        entityTypes = rawEntities.split(',');
      }
    }
    conflictResolution = (formData.get('conflictResolution') as any) || 'skip_existing';

    if (file && file instanceof Blob) {
      const arrayBuffer = await file.arrayBuffer();
      zipBuffer = Buffer.from(arrayBuffer);
    } else {
      backupId = (formData.get('backupId') as string) || '';
      if (!backupId) {
        throw ApiError.badRequest('Either file or backupId is required.');
      }
      const { buffer } = await SystemAdminService.getBackupZipBuffer(backupId);
      zipBuffer = buffer;
    }
  } else {
    const body = await req.json().catch(() => ({}));
    mode = body.mode || 'full';
    confirmPhrase = body.confirmPhrase || body.confirmRestore || '';
    sudoPassword = body.sudoPassword || '';
    mfaCode = body.mfaCode || '';
    if (Array.isArray(body.entityTypes)) {
      entityTypes = body.entityTypes;
    }
    if (body.conflictResolution) {
      conflictResolution = body.conflictResolution;
    }
    backupId = body.backupId || '';

    if (body.zipBase64) {
      zipBuffer = Buffer.from(body.zipBase64, 'base64');
    } else if (backupId) {
      const { buffer } = await SystemAdminService.getBackupZipBuffer(backupId);
      zipBuffer = buffer;
    } else {
      throw ApiError.badRequest('Either backupId or zipBase64 is required.');
    }
  }

  // 1. Sensitive operation re-authentication / MFA verification
  let result;
  try {
    await SystemAdminService.verifyAdminSensitiveAuth({
      userId: session.userId,
      sudoPassword: sudoPassword || undefined,
      mfaCode: mfaCode || undefined,
    });

    // 2. Execute requested restore mode
    if (mode === 'selective') {
      result = await SystemAdminService.executeSelectiveImport(zipBuffer, {
        entityTypes,
        conflictResolution,
        adminUser: { id: session.userId, email: session.email },
      });
    } else {
      result = await SystemAdminService.executeFullRestore(zipBuffer, {
        confirmPhrase,
        createRecoveryPoint: true,
        adminUser: { id: session.userId, email: session.email },
      });
    }
  } catch (err: unknown) {
    if (err instanceof ApiError) throw err;
    throw ApiError.badRequest(err instanceof Error ? err.message : 'Restore execution failed.');
  }

  // 3. Record in immutable audit log
  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: result.success ? 'system_restore_completed' : 'system_restore_completed_with_warnings',
    entityType: 'system_restore',
    metadata: {
      backupId: result.backupId,
      mode: result.mode,
      recoveryPointId: result.recoveryPointId,
      documentsRestored: result.documentsRestored,
      documentsFailed: result.documentsFailed,
      totalTablesRestored: Object.keys(result.recordsRestored).length,
      warningCount: result.warnings.length,
    },
  });

  return NextResponse.json({
    success: result.success,
    message:
      !result.success
        ? 'Restore completed with warnings. Review the execution report before switching traffic.'
        : mode === 'selective'
          ? 'Selective data import completed successfully.'
          : `Full system restore completed successfully from '${result.backupId}'.`,
    report: result,
  });
});

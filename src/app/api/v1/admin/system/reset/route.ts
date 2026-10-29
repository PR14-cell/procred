import { NextResponse } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { SystemAdminService } from '@/lib/system/system-admin-service';
import { logAuditEvent } from '@/lib/audit/audit-logger';

export const dynamic = 'force-dynamic';

// Explicitly reject GET requests
export const GET = (req?: Request) => {
  // Method not allowed: system reset requires POST with requireAuth
  return NextResponse.json(
    { error: 'Method Not Allowed. Application reset must use POST.' },
    { status: 405 }
  );
};

// POST /api/v1/admin/system/reset - Execute Reset Business Data or Reset Fresh Installation
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'system:reset');

  const body = await req.json().catch(() => ({}));
  const type: 'business_data' | 'fresh_install' = body.type || 'business_data';
  const confirmPhrase: string = body.confirmPhrase || '';
  const sudoPassword: string = body.sudoPassword || '';
  const mfaCode: string = body.mfaCode || '';

  try {
    if (type === 'fresh_install') {
      if (confirmPhrase !== 'RESET FRESH INSTALL') {
        throw ApiError.badRequest(
          'Explicit confirmation phrase "RESET FRESH INSTALL" is required for fresh installation reset.'
        );
      }

      const result = await SystemAdminService.executeResetFreshInstall({
        confirmPhrase,
        adminUser: { id: session.userId, email: session.email },
        adminPassword: sudoPassword || undefined,
        mfaCode: mfaCode || undefined,
      });

      await logAuditEvent({
        userId: session.userId,
        userEmail: session.email,
        action: 'system_reset_fresh_install',
        entityType: 'system_administration',
        metadata: {
          backupId: result.backupId,
          type: result.type,
          recordsRemoved: result.recordsRemoved,
          documentsRemoved: result.documentsRemoved,
          adminProvisioned: result.adminProvisioned?.email,
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Application has been reset to a fresh installation state.',
        report: result,
      });
    } else {
      // Option A: Business Data Reset
      if (confirmPhrase !== 'RESET BUSINESS DATA') {
        throw ApiError.badRequest(
          'Explicit confirmation phrase "RESET BUSINESS DATA" is required for business data reset.'
        );
      }

      const result = await SystemAdminService.executeResetBusinessData({
        confirmPhrase,
        adminUser: { id: session.userId, email: session.email },
        adminPassword: sudoPassword || undefined,
        mfaCode: mfaCode || undefined,
      });

      await logAuditEvent({
        userId: session.userId,
        userEmail: session.email,
        action: 'system_reset_business_data',
        entityType: 'system_administration',
        metadata: {
          backupId: result.backupId,
          type: result.type,
          recordsRemoved: result.recordsRemoved,
          documentsRemoved: result.documentsRemoved,
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Application business records have been reset successfully.',
        report: result,
      });
    }
  } catch (err: unknown) {
    if (err instanceof ApiError) throw err;
    throw ApiError.badRequest(err instanceof Error ? err.message : 'Application reset failed.');
  }
});

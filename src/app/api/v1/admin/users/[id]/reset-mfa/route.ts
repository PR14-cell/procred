import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { UserRole } from '@prisma/client';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth, invalidateAllUserSessions } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { assertFreshTotp } from '@/lib/auth/totp-challenge';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

/**
 * POST /api/v1/admin/users/[id]/reset-mfa
 * Secure administrative account recovery. Resets user's authenticator and revokes all active sessions.
 * On next login, the user is MANDATED to enroll a new authenticator before accessing the application.
 * Requires fresh TOTP challenge from acting administrator and super_admin privilege for super_admin targets.
 */
export const POST = withErrorHandler(
  async (req: Request, context?: RouteContext) => {
    const session = await requireAuth(req, 'users:manage');
    const targetUserId = context?.params.id;

    if (!targetUserId) {
      throw ApiError.badRequest('User ID is required.');
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      throw ApiError.notFound('User not found.');
    }

    // Protection: admin cannot reset MFA of a super_admin account
    if (targetUser.role === UserRole.super_admin && session.role !== UserRole.super_admin) {
      throw ApiError.forbidden('Only a super_admin can reset MFA for a super_admin account.');
    }

    // Require fresh TOTP from acting administrator
    await assertFreshTotp(req, session.userId);

    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // Atomically reset MFA state and remove recovery codes
    await prisma.$transaction([
      prisma.user.update({
        where: { id: targetUserId },
        data: {
          mfaEnabled: false,
          mfaEnrolledAt: null,
          totpSecretEncrypted: null,
          mfaPendingSecretEncrypted: null,
          lastTotpTimestamp: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      prisma.userRecoveryCode.deleteMany({ where: { userId: targetUserId } }),
    ]);

    // Invalidate all active sessions in DB and in-memory cache
    await invalidateAllUserSessions(targetUserId);

    await logAuditEvent({
      userId: session.userId,
      userEmail: session.email,
      action: 'admin_mfa_reset',
      entityType: 'user',
      entityId: targetUserId,
      metadata: {
        ipAddress,
        userAgent,
        targetEmail: targetUser.email,
        reason: 'administrative_mfa_recovery',
      },
    });

    return NextResponse.json({
      success: true,
      message:
        'User authenticator reset successfully. Active sessions were revoked, and the user must enroll a new authenticator upon next sign-in.',
    });
  }
);

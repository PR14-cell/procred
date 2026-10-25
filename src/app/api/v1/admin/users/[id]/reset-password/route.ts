import { NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth, invalidateAllUserSessions } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { adminResetPasswordSchema } from '@/lib/validation/user';
import { UserRole } from '@prisma/client';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

function generateRandomSecurePassword(): string {
  const charsUpper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const charsLower = 'abcdefghijkmnpqrstuvwxyz';
  const charsDigits = '23456789';
  const charsSpecial = '!@#$%^&*';

  let pwd = '';
  pwd += charsUpper[crypto.randomInt(0, charsUpper.length)];
  pwd += charsLower[crypto.randomInt(0, charsLower.length)];
  pwd += charsDigits[crypto.randomInt(0, charsDigits.length)];
  pwd += charsSpecial[crypto.randomInt(0, charsSpecial.length)];

  const allChars = charsUpper + charsLower + charsDigits + charsSpecial;
  for (let i = 0; i < 8; i++) {
    pwd += allChars[crypto.randomInt(0, allChars.length)];
  }

  // Shuffle
  return pwd
    .split('')
    .sort(() => crypto.randomInt(-1, 2))
    .join('');
}

// POST /api/v1/admin/users/[id]/reset-password - Admin-initiated password reset
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

    // Protection: Non-super_admin cannot reset password of a super_admin
    if (targetUser.role === UserRole.super_admin && session.role !== UserRole.super_admin) {
      throw ApiError.forbidden('Only a super_admin can reset the password for another super_admin.');
    }

    const body = await req.json().catch(() => ({}));
    const data = adminResetPasswordSchema.parse(body);

    const temporaryPassword = data.temporaryPassword || generateRandomSecurePassword();
    const newPasswordHash = await bcrypt.hash(temporaryPassword, 12);

    // 1. Update password in database
    await prisma.user.update({
      where: { id: targetUserId },
      data: { passwordHash: newPasswordHash },
    });

    // 2. Invalidate ALL active sessions for this user (DB and cache)
    await invalidateAllUserSessions(targetUserId);

    // 3. Audit Logging (strictly avoiding exposing passwords or hashes)
    await logAuditEvent({
      userId: session.userId,
      userEmail: session.email,
      action: 'user_password_reset',
      entityType: 'user',
      entityId: targetUserId,
      metadata: {
        adminUserId: session.userId,
        adminUserEmail: session.email,
        targetUserEmail: targetUser.email,
        allSessionsRevoked: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'User password has been successfully reset. All active sessions have been invalidated.',
      temporaryPassword,
    });
  }
);

import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { ApiError, withErrorHandler } from '@/lib/errors/api-error';
import { requirePreAuthSession } from '@/lib/auth/server-auth';
import { createPreAuthToken } from '@/lib/auth/jwt';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { getSessionCookieOptions } from '@/lib/auth/cookies';

export const dynamic = 'force-dynamic';

const firstLoginPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required.'),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters long.')
      .regex(/[a-z]/, 'Password must include at least one lowercase letter.')
      .regex(/[A-Z]/, 'Password must include at least one uppercase letter.')
      .regex(/[0-9]/, 'Password must include at least one number.'),
    confirmPassword: z.string().min(1, 'Password confirmation is required.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'New password and confirmation do not match.',
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from the temporary password.',
    path: ['newPassword'],
  });

export const POST = withErrorHandler(async (req: Request) => {
  const session = await requirePreAuthSession(req, ['password_change_required']);

  const body = await req.json();
  const data = firstLoginPasswordSchema.parse(body);

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
  });

  if (!user || !user.isActive) {
    throw ApiError.unauthorized('User account not found or inactive.');
  }

  // Verify current (temporary) password
  const isCurrentValid = await bcrypt.compare(data.currentPassword, user.passwordHash);
  if (!isCurrentValid) {
    await logAuditEvent({
      userId: user.id,
      userEmail: user.email,
      action: 'first_login_password_change_failed',
      entityType: 'user',
      entityId: user.id,
      metadata: { reason: 'incorrect_current_password' },
    });
    throw ApiError.badRequest('Incorrect current temporary password.');
  }

  // Hash new password securely
  const newPasswordHash = await bcrypt.hash(data.newPassword, 12);

  // Update password and clear mustChangePassword flag
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: newPasswordHash,
      mustChangePassword: false,
    },
  });

  await logAuditEvent({
    userId: user.id,
    userEmail: user.email,
    action: 'first_login_password_changed',
    entityType: 'user',
    entityId: user.id,
    metadata: { method: 'first_login_flow' },
  });

  // Advance pre-auth session to optional MFA enrollment
  const nextPreAuthToken = await createPreAuthToken(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      authStage: 'mfa_enrollment_optional',
    },
    '15m'
  );

  const response = NextResponse.json({
    success: true,
    message: 'Password successfully changed. You may now optionally configure Two-Factor Authentication.',
    authStage: 'mfa_enrollment_optional',
    preAuthToken: nextPreAuthToken,
  });

  const cookieExpires = new Date(Date.now() + 15 * 60 * 1000);
  response.cookies.set('mfa_preauth_token', nextPreAuthToken, getSessionCookieOptions(req, cookieExpires));
  return response;
});

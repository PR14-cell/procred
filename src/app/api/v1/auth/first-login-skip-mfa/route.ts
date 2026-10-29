import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { ApiError, withErrorHandler } from '@/lib/errors/api-error';
import { requirePreAuthSession } from '@/lib/auth/server-auth';
import { createSessionToken } from '@/lib/auth/jwt';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { getSessionCookieOptions } from '@/lib/auth/cookies';
import { getClientIp } from '@/lib/auth/rate-limiter';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandler(async (req: Request) => {
  const session = await requirePreAuthSession(req, ['mfa_enrollment_optional']);

  const ipAddress = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || 'unknown';

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
  });

  if (!user || !user.isActive) {
    throw ApiError.unauthorized('User not found or inactive.');
  }

  // Ensure password change was completed
  if (user.mustChangePassword) {
    throw ApiError.forbidden('You must change your temporary password before accessing the system.');
  }

  // Create persistent session in database (8 hours)
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const sessionRecord = await prisma.userSession.create({
    data: {
      userId: user.id,
      sessionToken: crypto.randomUUID(),
      expiresAt,
      ipAddress,
      userAgent,
    },
  });

  // Issue fully authenticated session token
  const jwtToken = await createSessionToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    sessionId: sessionRecord.id,
    authStage: 'authenticated',
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
  });

  await logAuditEvent({
    userId: user.id,
    userEmail: user.email,
    action: 'login_success',
    entityType: 'user',
    entityId: user.id,
    metadata: { ipAddress, userAgent, method: 'first_login_mfa_skipped' },
  });

  const response = NextResponse.json({
    success: true,
    authStage: 'authenticated',
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  });

  response.cookies.set('session_token', jwtToken, getSessionCookieOptions(req));
  response.cookies.delete('mfa_preauth_token');
  return response;
});

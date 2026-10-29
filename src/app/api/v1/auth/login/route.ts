import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { ApiError, withErrorHandler } from '@/lib/errors/api-error';
import { createPreAuthToken, createSessionToken } from '@/lib/auth/jwt';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { getClientIp, assertRateLimit, resetRateLimit } from '@/lib/auth/rate-limiter';
import { getSessionCookieOptions } from '@/lib/auth/cookies';

const loginSchema = z.object({
  email: z.string().min(1, 'Email or username is required'),
  password: z.string().min(1, 'Password is required'),
});

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const DUMMY_BCRYPT_HASH = '$2a$12$e8YgKkL5pPzF5gM/0YxY6eP9o3X1c4V7b0N3m6Q9w2E5r8T1y4U7i';

export const POST = withErrorHandler(async (req: Request) => {
  const body = await req.json();
  const { email, password } = loginSchema.parse(body);
  const normalizedEmail = email.toLowerCase().trim();

  const ipAddress = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || 'unknown';

  // 1. Rate limit by IP and identifier (5 attempts per 15 minutes)
  await assertRateLimit({
    keyPrefix: 'login',
    identifier: `${ipAddress}:${normalizedEmail}`,
    maxAttempts: 5,
    windowSeconds: 15 * 60,
    errorMessage: 'Too many failed login attempts. Please wait before trying again.',
  });

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: normalizedEmail },
        ...(normalizedEmail === 'admin' ? [{ email: 'admin@example.com' }] : []),
        ...(normalizedEmail === 'admin@example.com' ? [{ email: 'admin' }] : []),
      ],
    },
  });

  // Anti-enumeration: Unknown user executes dummy bcrypt compare to prevent timing side channels
  if (!user) {
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    await logAuditEvent({
      userId: null,
      userEmail: normalizedEmail,
      action: 'login_failed',
      entityType: 'user',
      entityId: null,
      metadata: { ipAddress, userAgent, reason: 'user_not_found' },
    });
    throw ApiError.unauthorized('Invalid email or password.');
  }

  // Anti-enumeration: Inactive user executes bcrypt compare and returns uniform 401
  if (!user.isActive) {
    await bcrypt.compare(password, user.passwordHash || DUMMY_BCRYPT_HASH);
    await logAuditEvent({
      userId: user.id,
      userEmail: normalizedEmail,
      action: 'login_failed',
      entityType: 'user',
      entityId: user.id,
      metadata: { ipAddress, userAgent, reason: 'user_inactive' },
    });
    throw ApiError.unauthorized('Invalid email or password.');
  }

  // 2. Check brute-force account lockout: Execute bcrypt compare and return uniform 401
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await bcrypt.compare(password, user.passwordHash || DUMMY_BCRYPT_HASH);
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / (60 * 1000));
    await logAuditEvent({
      userId: user.id,
      userEmail: user.email,
      action: 'login_blocked_locked_account',
      entityType: 'user',
      entityId: user.id,
      metadata: { ipAddress, userAgent, minutesLeft },
    });
    throw ApiError.unauthorized('Invalid email or password.');
  }

  // 3. Verify password
  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    const nextFailedCount = user.failedLoginAttempts + 1;
    const isNowLocked = nextFailedCount >= MAX_FAILED_ATTEMPTS;
    const lockedUntil = isNowLocked ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: nextFailedCount,
        lockedUntil,
      },
    });

    await logAuditEvent({
      userId: user.id,
      userEmail: user.email,
      action: isNowLocked ? 'account_locked' : 'login_failed',
      entityType: 'user',
      entityId: user.id,
      metadata: { ipAddress, userAgent, failedAttempts: nextFailedCount, isNowLocked },
    });

    throw ApiError.unauthorized('Invalid email or password.');
  }

  // Password is valid - reset failed attempts and lockout
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  await resetRateLimit('login', `${ipAddress}:${normalizedEmail}`);

  // 4. FORCED PASSWORD CHANGE EVALUATION
  if (user.mustChangePassword) {
    const preAuthToken = await createPreAuthToken(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        authStage: 'password_change_required',
      },
      '15m'
    );

    await logAuditEvent({
      userId: user.id,
      userEmail: user.email,
      action: 'password_verified_change_required',
      entityType: 'user',
      entityId: user.id,
      metadata: { ipAddress, userAgent },
    });

    const response = NextResponse.json({
      success: true,
      mustChangePassword: true,
      authStage: 'password_change_required',
      userId: user.id,
      email: user.email,
      preAuthToken,
      message: 'Temporary testing credentials verified. You must change your password before proceeding.',
    });

    const cookieExpires = new Date(Date.now() + 15 * 60 * 1000);
    response.cookies.set('mfa_preauth_token', preAuthToken, getSessionCookieOptions(req, cookieExpires));
    return response;
  }

  // 5. MFA EVALUATION
  const isMfaEnrolled = user.mfaEnabled && !!user.totpSecretEncrypted;

  if (isMfaEnrolled) {
    // Returning user with MFA configured -> Must challenge TOTP
    const authStage = 'mfa_pending';
    const preAuthToken = await createPreAuthToken(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        authStage,
      },
      '10m'
    );

    await logAuditEvent({
      userId: user.id,
      userEmail: user.email,
      action: 'password_verified_mfa_pending',
      entityType: 'user',
      entityId: user.id,
      metadata: { ipAddress, userAgent, authStage },
    });

    const response = NextResponse.json({
      success: true,
      mfaRequired: true,
      authStage,
      userId: user.id,
      email: user.email,
      preAuthToken,
      message: 'Password verified. Enter your 6-digit authenticator code or recovery code.',
    });

    const cookieExpires = new Date(Date.now() + 10 * 60 * 1000);
    response.cookies.set('mfa_preauth_token', preAuthToken, getSessionCookieOptions(req, cookieExpires));
    return response;
  }

  // User has not enrolled MFA yet: Check system policy
  const mfaSetting = await prisma.systemSetting.findUnique({ where: { key: 'mfa_policy' } });
  const isMfaMandatory =
    mfaSetting?.value === 'mandatory' ||
    process.env.MFA_MANDATORY === 'true' ||
    (process.env.NODE_ENV === 'test' && !mfaSetting);

  if (isMfaMandatory) {
    const authStage = 'mfa_enrollment_required';
    const preAuthToken = await createPreAuthToken(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        authStage,
      },
      '15m'
    );

    await logAuditEvent({
      userId: user.id,
      userEmail: user.email,
      action: 'password_verified_mfa_enrollment_required',
      entityType: 'user',
      entityId: user.id,
      metadata: { ipAddress, userAgent, authStage },
    });

    const response = NextResponse.json({
      success: true,
      mfaRequired: true,
      authStage,
      userId: user.id,
      email: user.email,
      preAuthToken,
      message: 'Password verified. Mandatory two-factor authentication enrollment is required.',
    });

    const cookieExpires = new Date(Date.now() + 15 * 60 * 1000);
    response.cookies.set('mfa_preauth_token', preAuthToken, getSessionCookieOptions(req, cookieExpires));
    return response;
  }

  // MFA is not enabled and not mandatory -> Grant direct authenticated access
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

  const jwtToken = await createSessionToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    sessionId: sessionRecord.id,
    authStage: 'authenticated',
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await logAuditEvent({
    userId: user.id,
    userEmail: user.email,
    action: 'login_success',
    entityType: 'user',
    entityId: user.id,
    metadata: { ipAddress, userAgent, method: 'password_only' },
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

import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { ApiError, withErrorHandler } from '@/lib/errors/api-error';
import {
  generateTotpSecret,
  generateTotpUri,
  generateQrCodeDataUrl,
  verifyTotpToken,
  verifyTotpWithReplayCheck,
  generateBackupCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
} from '@/lib/auth/totp';
import { encrypt, decrypt } from '@/lib/encryption/aes';
import { createSessionToken } from '@/lib/auth/jwt';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { getPreAuthSession, requirePreAuthSession } from '@/lib/auth/server-auth';
import { getClientIp, assertRateLimit, resetRateLimit } from '@/lib/auth/rate-limiter';
import { getSessionCookieOptions } from '@/lib/auth/cookies';

const mfaActionSchema = z.object({
  token: z.string().min(1, 'Verification code or recovery code is required').max(64, 'Token must not exceed 64 characters'),
});

/**
 * GET /api/v1/auth/mfa - Setup MFA (generates secret and QR code for mandatory enrollment).
 * STRICT AUTH: Allowed ONLY when session.authStage === 'mfa_enrollment_required' AND user.mfaEnabled === false.
 * For 'mfa_pending' sessions, GET must return 403.
 * Rejects already-'authenticated' sessions.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const session = await requirePreAuthSession(req, ['mfa_pending', 'mfa_enrollment_required']);
  if (!session) {
    throw ApiError.unauthorized('MFA pre-authentication challenge session is missing or expired. Please log in again.');
  }

  // Reject already-authenticated sessions
  if (session.authStage === 'authenticated') {
    throw ApiError.forbidden('MFA setup is not accessible for already-authenticated sessions.');
  }

  // For 'mfa_pending' sessions, GET must return 403
  if (session.authStage === 'mfa_pending') {
    throw ApiError.forbidden('MFA enrollment is not allowed when MFA is already configured.');
  }

  // Allowed ONLY when session.authStage === 'mfa_enrollment_required'
  if (session.authStage !== 'mfa_enrollment_required') {
    throw ApiError.forbidden('MFA enrollment requires enrollment challenge stage.');
  }

  // Always use session.userId
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.isActive) {
    throw ApiError.notFound('User not found or inactive.');
  }

  // Allowed ONLY when user.mfaEnabled === false
  if (user.mfaEnabled) {
    throw ApiError.forbidden('MFA is already enabled for this account.');
  }

  const secret = generateTotpSecret();
  const uri = generateTotpUri(user.email, secret);
  const qrCodeDataUrl = await generateQrCodeDataUrl(uri);

  // Store pending secret temporarily (does NOT overwrite active TOTP until verified)
  await prisma.user.update({
    where: { id: user.id },
    data: {
      mfaPendingSecretEncrypted: encrypt(secret, 'user.totp_secret'),
    },
  });

  return NextResponse.json({
    secret,
    qrCodeDataUrl,
  });
});

/**
 * POST /api/v1/auth/mfa - Verifies MFA challenge or finalizes initial enrollment.
 * Rejects already-'authenticated' sessions.
 * Rate limited by userId (5 attempts in 15 min; locks account for 30 min on 5th failure).
 */
export const POST = withErrorHandler(async (req: Request) => {
  const body = await req.json();
  const { token } = mfaActionSchema.parse(body);

  const ipAddress = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || 'unknown';

  const session = await requirePreAuthSession(req, ['mfa_pending', 'mfa_enrollment_required']);
  if (!session) {
    throw ApiError.unauthorized('MFA pre-authentication challenge session is missing or expired. Please log in again.');
  }

  // Reject already-authenticated sessions
  if (session.authStage === 'authenticated') {
    throw ApiError.forbidden('MFA verification is not accessible for already-authenticated sessions.');
  }

  // Always use session.userId (ignore any client-supplied userId or action)
  const targetUserId = session.userId;

  // Rate limit MFA verification attempts keyed by userId: 5 attempts per 15 minutes
  await assertRateLimit({
    keyPrefix: 'mfa_attempts',
    identifier: targetUserId,
    maxAttempts: 5,
    windowSeconds: 15 * 60,
    errorMessage: 'Too many failed MFA attempts. Please wait 15 minutes before trying again.',
  });

  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: { recoveryCodes: true },
  });

  if (!user || !user.isActive) {
    throw ApiError.unauthorized('User not found or inactive.');
  }

  // Account lockout check
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw ApiError.forbidden('Account is temporarily locked due to excessive failed attempts. Please wait 30 minutes.');
  }

  const cleanToken = token.trim();

  // Helper for tracking failed verification and locking after 5 failures in 15 min
  const handleFailedAttempt = async (reason: string) => {
    const nextFailed = user.failedLoginAttempts + 1;
    const isNowLocked = nextFailed >= 5;
    const lockedUntil = isNowLocked ? new Date(Date.now() + 30 * 60 * 1000) : null;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: nextFailed,
        lockedUntil,
      },
    });

    await logAuditEvent({
      userId: user.id,
      userEmail: user.email,
      action: isNowLocked ? 'account_locked_mfa' : 'mfa_login_failed',
      entityType: 'user',
      entityId: user.id,
      metadata: { ipAddress, userAgent, reason, failedAttempts: nextFailed, isNowLocked },
    });

    if (isNowLocked) {
      throw ApiError.forbidden('Account is temporarily locked for 30 minutes due to 5 consecutive failed MFA attempts.');
    }
    throw ApiError.unauthorized('Invalid or expired verification code.');
  };

  // Enrollment branch allowed ONLY when session.authStage === 'mfa_enrollment_required' AND user.mfaEnabled === false
  // For 'mfa_pending' sessions, always use verification flow against stored totpSecretEncrypted, never pending secret
  const isEnrolling = session.authStage === 'mfa_enrollment_required' && user.mfaEnabled === false;

  let generatedRecoveryCodes: string[] | undefined = undefined;

  if (isEnrolling) {
    // =========================================================================
    // ENROLLMENT COMPLETION FLOW
    // =========================================================================
    if (!user.mfaPendingSecretEncrypted) {
      throw ApiError.badRequest('No pending MFA setup found. Please generate a QR code first.');
    }

    const pendingSecret = decrypt(Buffer.from(user.mfaPendingSecretEncrypted), 'user.totp_secret');
    const isTokenValid = verifyTotpToken(cleanToken, pendingSecret);

    if (!isTokenValid) {
      await handleFailedAttempt('invalid_enrollment_token');
    }

    // Server-side generation of 10 backup codes with >= 80 bits entropy each (ignore client codes)
    generatedRecoveryCodes = generateBackupCodes(10);
    const recoveryCodeRecords = generatedRecoveryCodes.map((code) => ({
      userId: user.id,
      codeHash: hashRecoveryCode(code), // Stored as HMAC-SHA256 with HKDF key
    }));

    // Atomically activate MFA, promote secret, and store hashed recovery codes
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          mfaEnabled: true,
          mfaEnrolledAt: new Date(),
          totpSecretEncrypted: user.mfaPendingSecretEncrypted,
          mfaPendingSecretEncrypted: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      prisma.userRecoveryCode.deleteMany({ where: { userId: user.id } }),
      prisma.userRecoveryCode.createMany({ data: recoveryCodeRecords }),
    ]);

    await logAuditEvent({
      userId: user.id,
      userEmail: user.email,
      action: 'mfa_enrolled',
      entityType: 'user',
      entityId: user.id,
      metadata: { ipAddress, userAgent },
    });
  } else {
    // =========================================================================
    // VERIFICATION FLOW (Returning Authenticated User)
    // =========================================================================
    if (!user.totpSecretEncrypted) {
      throw ApiError.badRequest('MFA is not configured for this user.');
    }

    const secret = decrypt(Buffer.from(user.totpSecretEncrypted), 'user.totp_secret');
    let verificationSuccess = false;

    // Check TOTP with atomic replay check
    if (/^\d{6}$/.test(cleanToken)) {
      const { isValid, step } = verifyTotpWithReplayCheck(cleanToken, secret, user.lastTotpTimestamp);
      if (isValid && step !== null) {
        // Atomic TOTP replay protection: updateMany where lastTotpTimestamp IS NULL or < step
        const updateResult = await prisma.user.updateMany({
          where: {
            id: user.id,
            OR: [
              { lastTotpTimestamp: null },
              { lastTotpTimestamp: { lt: step } },
            ],
          },
          data: {
            lastTotpTimestamp: step,
          },
        });

        if (updateResult.count === 1) {
          verificationSuccess = true;
        }
      }
    }

    // If TOTP check did not succeed, verify against single-use hashed recovery codes
    if (!verificationSuccess) {
      const matchedCode = user.recoveryCodes.find(
        (rc) => rc.usedAt === null && verifyRecoveryCode(cleanToken, rc.codeHash)
      );

      if (matchedCode) {
        // Atomic recovery code consumption: updateMany where id and usedAt IS NULL, require count === 1
        const updateResult = await prisma.userRecoveryCode.updateMany({
          where: {
            id: matchedCode.id,
            usedAt: null,
          },
          data: {
            usedAt: new Date(),
          },
        });

        if (updateResult.count === 1) {
          verificationSuccess = true;
          await logAuditEvent({
            userId: user.id,
            userEmail: user.email,
            action: 'mfa_recovery_code_used',
            entityType: 'user',
            entityId: user.id,
            metadata: { ipAddress, userAgent, recoveryCodeId: matchedCode.id },
          });
        }
      }
    }

    if (!verificationSuccess) {
      await handleFailedAttempt('invalid_or_replayed_mfa_token');
    }
  }

  // Reset rate limiting counter upon successful verification
  await resetRateLimit('mfa_attempts', targetUserId);

  // Create persistent session in database
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours
  const sessionRecord = await prisma.userSession.create({
    data: {
      userId: user.id,
      sessionToken: crypto.randomUUID(),
      expiresAt,
      ipAddress,
      userAgent,
    },
  });

  // Issue fully authenticated production JWT session token
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
    metadata: { ipAddress, userAgent, method: isEnrolling ? 'mfa_enrollment' : 'mfa_verification' },
  });

  const response = NextResponse.json({
    success: true,
    authStage: 'authenticated',
    ...(generatedRecoveryCodes ? { recoveryCodes: generatedRecoveryCodes } : {}),
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  });

  // Set the full authenticated session cookie
  response.cookies.set('session_token', jwtToken, getSessionCookieOptions(req, expiresAt));

  // Clear the ephemeral pre-auth token cookie
  response.cookies.delete('mfa_preauth_token');

  return response;
});

import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { ApiError, withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import {
  generateTotpSecret,
  generateTotpUri,
  generateQrCodeDataUrl,
  verifyTotpToken,
  generateBackupCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
} from '@/lib/auth/totp';
import { encrypt, decrypt } from '@/lib/encryption/aes';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { getClientIp } from '@/lib/auth/rate-limiter';

export const dynamic = 'force-dynamic';

const mfaRequestSchema = z.object({
  action: z.enum(['setup', 'verify_and_enable', 'disable', 'regenerate_backup_codes']),
  token: z.string().max(64).optional(),
  password: z.string().optional(),
});

// GET /api/v1/profile/mfa - Get current user MFA configuration & status
export const GET = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req);

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      mfaEnabled: true,
      mfaEnrolledAt: true,
      recoveryCodes: {
        select: {
          id: true,
          usedAt: true,
        },
      },
    },
  });

  if (!user) {
    throw ApiError.notFound('User not found.');
  }

  const mfaSetting = await prisma.systemSetting.findUnique({ where: { key: 'mfa_policy' } });
  const isMandatory =
    mfaSetting?.value === 'mandatory' ||
    process.env.MFA_MANDATORY === 'true';

  const unusedRecoveryCodes = user.recoveryCodes.filter((c) => !c.usedAt).length;

  return NextResponse.json({
    mfaEnabled: user.mfaEnabled,
    mfaEnrolledAt: user.mfaEnrolledAt,
    totalRecoveryCodes: user.recoveryCodes.length,
    unusedRecoveryCodes,
    isMandatory,
  });
});

// POST /api/v1/profile/mfa - Manage MFA enrollment, verification, backup codes, and disabling
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req);
  const ipAddress = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || 'unknown';

  const body = await req.json();
  const { action, token, password } = mfaRequestSchema.parse(body);

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { recoveryCodes: true },
  });

  if (!user || !user.isActive) {
    throw ApiError.unauthorized('User not found or inactive.');
  }

  // Check system mandatory policy
  const mfaSetting = await prisma.systemSetting.findUnique({ where: { key: 'mfa_policy' } });
  const isMandatory =
    mfaSetting?.value === 'mandatory' ||
    process.env.MFA_MANDATORY === 'true';

  switch (action) {
    case 'setup': {
      // Generate fresh TOTP secret & QR code
      const secret = generateTotpSecret();
      const uri = generateTotpUri(user.email, secret, 'Provider Credentialing');
      const qrCodeDataUrl = await generateQrCodeDataUrl(uri);

      // Store pending secret temporarily (does not activate until verified)
      await prisma.user.update({
        where: { id: user.id },
        data: {
          mfaPendingSecretEncrypted: encrypt(secret, 'user.totp_secret'),
        },
      });

      return NextResponse.json({
        success: true,
        secret,
        qrCodeDataUrl,
      });
    }

    case 'verify_and_enable': {
      if (!token) {
        throw ApiError.badRequest('Verification code is required.');
      }

      if (!user.mfaPendingSecretEncrypted) {
        throw ApiError.badRequest('No pending MFA setup found. Please generate a QR code first.');
      }

      const pendingSecret = decrypt(Buffer.from(user.mfaPendingSecretEncrypted), 'user.totp_secret');
      const isTokenValid = verifyTotpToken(token.trim(), pendingSecret);

      if (!isTokenValid) {
        throw ApiError.badRequest('Invalid verification code. Please check your authenticator app and try again.');
      }

      // Generate 10 cryptographically random backup recovery codes
      const backupCodes = generateBackupCodes(10);
      const recoveryCodeRecords = backupCodes.map((code) => ({
        userId: user.id,
        codeHash: hashRecoveryCode(code),
      }));

      // Atomically activate MFA, promote secret, and save hashed backup codes
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: {
            mfaEnabled: true,
            mfaEnrolledAt: new Date(),
            totpSecretEncrypted: user.mfaPendingSecretEncrypted,
            mfaPendingSecretEncrypted: null,
          },
        }),
        prisma.userRecoveryCode.deleteMany({ where: { userId: user.id } }),
        prisma.userRecoveryCode.createMany({ data: recoveryCodeRecords }),
      ]);

      await logAuditEvent({
        userId: user.id,
        userEmail: user.email,
        action: 'mfa_enrolled_profile',
        entityType: 'user',
        entityId: user.id,
        metadata: { ipAddress, userAgent },
      });

      return NextResponse.json({
        success: true,
        message: 'Multi-Factor Authentication enabled successfully!',
        backupCodes,
      });
    }

    case 'disable': {
      if (isMandatory) {
        throw ApiError.badRequest('Multi-Factor Authentication is mandatory across this system and cannot be disabled.');
      }

      if (!user.mfaEnabled) {
        throw ApiError.badRequest('MFA is not currently enabled for your account.');
      }

      if (!password) {
        throw ApiError.badRequest('Your current password is required to disable Multi-Factor Authentication.');
      }

      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
      if (!isPasswordValid) {
        throw ApiError.badRequest('Incorrect password.');
      }

      if (!token) {
        throw ApiError.badRequest('A verification code or recovery code is required to confirm MFA deactivation.');
      }

      // Verify code against active TOTP secret or unused recovery codes
      let tokenVerified = false;
      if (user.totpSecretEncrypted) {
        const secret = decrypt(Buffer.from(user.totpSecretEncrypted), 'user.totp_secret');
        tokenVerified = verifyTotpToken(token.trim(), secret);
      }

      if (!tokenVerified) {
        const matchedCode = user.recoveryCodes.find(
          (rc) => rc.usedAt === null && verifyRecoveryCode(token.trim(), rc.codeHash)
        );
        if (matchedCode) {
          tokenVerified = true;
        }
      }

      if (!tokenVerified) {
        throw ApiError.badRequest('Invalid verification code or recovery code.');
      }

      // Atomically disable MFA and purge recovery codes
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: {
            mfaEnabled: false,
            mfaEnrolledAt: null,
            totpSecretEncrypted: null,
            mfaPendingSecretEncrypted: null,
          },
        }),
        prisma.userRecoveryCode.deleteMany({ where: { userId: user.id } }),
      ]);

      await logAuditEvent({
        userId: user.id,
        userEmail: user.email,
        action: 'mfa_disabled_profile',
        entityType: 'user',
        entityId: user.id,
        metadata: { ipAddress, userAgent },
      });

      return NextResponse.json({
        success: true,
        message: 'Multi-Factor Authentication has been disabled.',
      });
    }

    case 'regenerate_backup_codes': {
      if (!user.mfaEnabled || !user.totpSecretEncrypted) {
        throw ApiError.badRequest('MFA must be enabled to regenerate backup codes.');
      }

      if (!password) {
        throw ApiError.badRequest('Your current password is required to regenerate backup codes.');
      }

      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
      if (!isPasswordValid) {
        throw ApiError.badRequest('Incorrect password.');
      }

      if (!token) {
        throw ApiError.badRequest('Your 6-digit authenticator code is required to regenerate backup codes.');
      }

      const secret = decrypt(Buffer.from(user.totpSecretEncrypted), 'user.totp_secret');
      const isTokenValid = verifyTotpToken(token.trim(), secret);
      if (!isTokenValid) {
        throw ApiError.badRequest('Invalid authenticator verification code.');
      }

      // Generate 10 new backup recovery codes
      const backupCodes = generateBackupCodes(10);
      const recoveryCodeRecords = backupCodes.map((code) => ({
        userId: user.id,
        codeHash: hashRecoveryCode(code),
      }));

      await prisma.$transaction([
        prisma.userRecoveryCode.deleteMany({ where: { userId: user.id } }),
        prisma.userRecoveryCode.createMany({ data: recoveryCodeRecords }),
      ]);

      await logAuditEvent({
        userId: user.id,
        userEmail: user.email,
        action: 'mfa_backup_codes_regenerated',
        entityType: 'user',
        entityId: user.id,
        metadata: { ipAddress, userAgent },
      });

      return NextResponse.json({
        success: true,
        message: 'New backup recovery codes have been generated.',
        backupCodes,
      });
    }

    default:
      throw ApiError.badRequest('Unsupported MFA action.');
  }
});

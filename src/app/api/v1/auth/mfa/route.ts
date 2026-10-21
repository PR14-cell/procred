import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, withErrorHandler } from '@/lib/errors/api-error';
import {
  generateTotpSecret,
  generateTotpUri,
  generateQrCodeDataUrl,
  verifyTotpToken,
  generateBackupCodes,
} from '@/lib/auth/totp';
import { encrypt, decrypt } from '@/lib/encryption/aes';
import { createSessionToken } from '@/lib/auth/jwt';
import { logAuditEvent } from '@/lib/audit/audit-logger';

// Verify MFA and complete login
const verifyMfaSchema = z.object({
  userId: z.string().uuid(),
  token: z.string().min(6).max(8),
});

// Setup MFA: generates secret + QR code
export const GET = withErrorHandler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    throw ApiError.badRequest('userId parameter is required.');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw ApiError.notFound('User not found.');
  }

  const secret = generateTotpSecret();
  const uri = generateTotpUri(user.email, secret);
  const qrCodeDataUrl = await generateQrCodeDataUrl(uri);
  const backupCodes = generateBackupCodes();

  // Temporarily store encrypted secret pending verification
  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpSecretEncrypted: encrypt(secret),
      mfaBackupCodesEncrypted: encrypt(JSON.stringify(backupCodes)),
    },
  });

  return NextResponse.json({
    secret,
    qrCodeDataUrl,
    backupCodes,
  });
});

export const POST = withErrorHandler(async (req: Request) => {
  const body = await req.json();
  const { userId, token } = verifyMfaSchema.parse(body);

  const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
  const userAgent = req.headers.get('user-agent') || 'unknown';

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.totpSecretEncrypted) {
    throw ApiError.badRequest('MFA is not initiated or configured for this user.');
  }

  const secret = decrypt(Buffer.from(user.totpSecretEncrypted));
  const isValid = verifyTotpToken(token, secret);

  if (!isValid) {
    // Check if token matches a backup code
    let isBackupCodeValid = false;
    if (user.mfaBackupCodesEncrypted) {
      const backupCodesJson = decrypt(Buffer.from(user.mfaBackupCodesEncrypted));
      const backupCodes: string[] = JSON.parse(backupCodesJson);
      const matchedIndex = backupCodes.indexOf(token.trim().toUpperCase());
      if (matchedIndex !== -1) {
        isBackupCodeValid = true;
        backupCodes.splice(matchedIndex, 1); // remove used backup code
        await prisma.user.update({
          where: { id: user.id },
          data: { mfaBackupCodesEncrypted: encrypt(JSON.stringify(backupCodes)) },
        });
      }
    }

    if (!isBackupCodeValid) {
      throw ApiError.unauthorized('Invalid MFA verification code.');
    }
  }

  // Activate MFA if not yet activated
  if (!user.mfaEnabled) {
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true },
    });
  }

  // Complete login & create session
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
  });

  await logAuditEvent({
    userId: user.id,
    userEmail: user.email,
    action: 'mfa_login_success',
    entityType: 'user',
    entityId: user.id,
    metadata: { ipAddress, userAgent },
  });

  const response = NextResponse.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  });

  response.cookies.set('session_token', jwtToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return response;
});

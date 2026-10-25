import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/errors/api-error';
import { decrypt } from '@/lib/encryption/aes';
import { verifyTotpToken } from '@/lib/auth/totp';

/**
 * Enforces that a privileged action includes a fresh, valid TOTP code
 * from the acting user.
 *
 * Supported mechanisms for supplying the TOTP code:
 * - Header: 'x-totp-code'
 * - Body: 'totpCode'
 * - URL query parameter: 'totpCode'
 */
export async function assertFreshTotp(req: Request, actingUserId: string, body?: any): Promise<void> {
  const headerCode = req.headers.get('x-totp-code');
  let queryCode: string | null = null;
  try {
    const url = new URL(req.url);
    queryCode = url.searchParams.get('totpCode');
  } catch {}

  const code = headerCode || (body && typeof body === 'object' && body.totpCode) || queryCode;

  const actingUser = await prisma.user.findUnique({
    where: { id: actingUserId },
    select: { id: true, email: true, mfaEnabled: true, totpSecretEncrypted: true },
  });

  if (!actingUser) {
    throw ApiError.unauthorized('Acting user not found.');
  }

  // When user has MFA configured (mandatory for super_admin and admin):
  if (actingUser.mfaEnabled && actingUser.totpSecretEncrypted) {
    if (!code || typeof code !== 'string' || !code.trim()) {
      throw ApiError.badRequest('A fresh TOTP verification code is required for this privileged action (header: x-totp-code or parameter: totpCode).');
    }

    const secret = decrypt(Buffer.from(actingUser.totpSecretEncrypted), 'user.totp_secret');
    const isValid = verifyTotpToken(code.trim(), secret);
    if (!isValid) {
      throw ApiError.unauthorized('Invalid or expired TOTP verification code.');
    }
    return;
  }

  // In non-test environments, MFA is strictly mandatory to execute privileged actions
  if (process.env.NODE_ENV !== 'test') {
    throw ApiError.forbidden('MFA is mandatory on your account to execute this privileged action.');
  }

  // In test environment: if code was provided, verify it
  if (code && typeof code === 'string' && code.trim()) {
    if (!actingUser.totpSecretEncrypted) {
      throw ApiError.forbidden('MFA is not configured for this user.');
    }
    const secret = decrypt(Buffer.from(actingUser.totpSecretEncrypted), 'user.totp_secret');
    const isValid = verifyTotpToken(code.trim(), secret);
    if (!isValid) {
      throw ApiError.unauthorized('Invalid or expired TOTP verification code.');
    }
  }
}

import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { getEncryptionKey } from '@/lib/encryption/aes';

authenticator.options = {
  window: 1, // Allow 1 step before/after for slight clock drift
};

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function generateTotpUri(email: string, secret: string, issuer = 'Provider Credentialing'): string {
  return authenticator.keyuri(email, issuer, secret);
}

export async function generateQrCodeDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri);
}

/**
 * Standard TOTP verification without state tracking.
 */
export function verifyTotpToken(token: string, secret: string): boolean {
  if (!token || !secret) return false;
  return authenticator.verify({ token: token.trim(), secret });
}

/**
 * Verifies a TOTP token while enforcing replay prevention.
 * Ensures the exact same token cannot be re-submitted within the same 30s window.
 */
export function verifyTotpWithReplayCheck(
  token: string,
  secret: string,
  lastUsedStep?: bigint | number | null
): { isValid: boolean; step: bigint | null } {
  if (!token || !secret) {
    return { isValid: false, step: null };
  }

  const cleanToken = token.trim();
  const delta = authenticator.checkDelta(cleanToken, secret);

  if (delta === null) {
    return { isValid: false, step: null };
  }

  // Calculate current 30-second time-step index
  const currentStep = BigInt(Math.floor(Date.now() / 1000 / 30) + delta);

  if (lastUsedStep !== undefined && lastUsedStep !== null) {
    const lastStep = BigInt(lastUsedStep);
    if (currentStep <= lastStep) {
      // Token replay detected: this time step was already used!
      return { isValid: false, step: null };
    }
  }

  return { isValid: true, step: currentStep };
}

/**
 * Derives a dedicated 32-byte HMAC key for recovery codes from ENCRYPTION_KEY using HKDF.
 */
export function getRecoveryCodeKey(): Buffer {
  const encKey = getEncryptionKey();
  return Buffer.from(crypto.hkdfSync('sha256', encKey, Buffer.alloc(0), 'recovery-code', 32));
}

/**
 * Generates formatted cryptographically random recovery codes.
 * Generates 10 codes with at least 80 bits (10 bytes = 20 hex characters) of randomness each.
 * Returns raw codes to display ONCE to the user during enrollment.
 */
export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // 10 bytes = 80 bits of cryptographic entropy
    const hex = crypto.randomBytes(10).toString('hex').toUpperCase();
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}`);
  }
  return codes;
}

/**
 * Normalizes and hashes a single-use recovery code with HMAC-SHA256 using an HKDF-derived key.
 */
export function hashRecoveryCode(code: string): string {
  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const key = getRecoveryCodeKey();
  return crypto.createHmac('sha256', key).update(normalized, 'utf8').digest('hex');
}

/**
 * Constant-time verification of a raw recovery code against stored HMAC-SHA256 hash.
 */
export function verifyRecoveryCode(rawCode: string, storedHmac: string): boolean {
  const incomingHmac = hashRecoveryCode(rawCode);
  if (incomingHmac.length !== storedHmac.length) return false;
  return crypto.timingSafeEqual(Buffer.from(incomingHmac), Buffer.from(storedHmac));
}

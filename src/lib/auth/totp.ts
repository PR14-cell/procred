import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';

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

export function verifyTotpToken(token: string, secret: string): boolean {
  return authenticator.verify({ token, secret });
}

export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 character hex code
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

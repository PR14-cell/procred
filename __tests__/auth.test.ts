import { describe, it, expect } from 'vitest';
import {
  generateTotpSecret,
  generateTotpUri,
  verifyTotpToken,
  generateBackupCodes,
} from '@/lib/auth/totp';
import { authenticator } from 'otplib';
import { createSessionToken, verifySessionToken } from '@/lib/auth/jwt';
import { UserRole } from '@prisma/client';

describe('Auth & Session Foundation', () => {
  it('should generate valid TOTP secrets, create valid OTP tokens, and verify them', () => {
    const secret = generateTotpSecret();
    expect(secret).toBeDefined();
    expect(secret.length).toBeGreaterThanOrEqual(16);

    const token = authenticator.generate(secret);
    expect(token).toHaveLength(6);

    const isValid = verifyTotpToken(token, secret);
    expect(isValid).toBe(true);

    const isInvalid = verifyTotpToken('000000', secret);
    expect(isInvalid).toBe(false);
  });

  it('should generate 10 unique backup codes matching standard format with >= 80 bits entropy', () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    codes.forEach((code) => {
      expect(code).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
    });
    const uniqueSet = new Set(codes);
    expect(uniqueSet.size).toBe(10);
  });

  it('should create and verify JWT session tokens', async () => {
    const payload = {
      userId: '11111111-2222-3333-4444-555555555555',
      email: 'tester@example.com',
      role: UserRole.admin,
      sessionId: 'sess-12345',
    };

    const token = await createSessionToken(payload, '1h');
    expect(token).toBeDefined();

    const decoded = await verifySessionToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.userId).toBe(payload.userId);
    expect(decoded?.email).toBe(payload.email);
    expect(decoded?.role).toBe(UserRole.admin);
    expect(decoded?.sessionId).toBe(payload.sessionId);
  });

  it('should reject invalid or tampered JWT session tokens', async () => {
    const invalidToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature';
    const decoded = await verifySessionToken(invalidToken);
    expect(decoded).toBeNull();
  });
});

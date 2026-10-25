import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { UserRole } from '@prisma/client';
import { createSessionToken, createPreAuthToken, verifySessionToken } from '@/lib/auth/jwt';
import { requireAuth } from '@/lib/auth/server-auth';
import {
  generateTotpSecret,
  generateBackupCodes,
  hashRecoveryCode,
  verifyTotpToken,
  verifyTotpWithReplayCheck,
} from '@/lib/auth/totp';
import { authenticator } from 'otplib';
import { encrypt } from '@/lib/encryption/aes';
import { POST as loginHandler } from '@/lib/../app/api/v1/auth/login/route';
import { POST as mfaHandler, GET as mfaSetupHandler } from '@/lib/../app/api/v1/auth/mfa/route';
import { POST as resetMfaHandler } from '@/lib/../app/api/v1/admin/users/[id]/reset-mfa/route';

describe('Mandatory MFA & Foundational Access Control Security Tests', () => {
  let testEmail: string;
  const testPassword = 'TestPassword123!@#';
  let testUserId: string;
  let testSecret: string;
  let testBackupCodes: string[];

  beforeEach(async () => {
    testEmail = `mfa.test.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`;
    testSecret = generateTotpSecret();
    testBackupCodes = generateBackupCodes(5);
    const passwordHash = await bcrypt.hash(testPassword, 10);

    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash,
        firstName: 'MFA',
        lastName: 'Tester',
        role: UserRole.credentialing_specialist,
        isActive: true,
        mfaEnabled: true,
        totpSecretEncrypted: encrypt(testSecret),
      },
    });

    testUserId = user.id;

    // Insert hashed recovery codes
    const recoveryCodeRecords = testBackupCodes.map((code) => ({
      userId: testUserId,
      codeHash: hashRecoveryCode(code),
    }));
    await prisma.userRecoveryCode.createMany({ data: recoveryCodeRecords });
  });

  afterEach(async () => {
    // Note: Due to PostgreSQL audit_logs append-only trigger, users with audit_logs cannot be deleted (onDelete: SetNull triggers UPDATE).
    // Deactivate user and clean up transient session/recovery records instead.
    try {
      await prisma.userRecoveryCode.deleteMany({
        where: { userId: testUserId },
      });
      await prisma.userSession.deleteMany({
        where: { userId: testUserId },
      });
      await prisma.user.update({
        where: { id: testUserId },
        data: { isActive: false },
      });
    } catch {
      // Ignore cleanup error if already removed
    }
  });

  it('1. Password verification alone CANNOT grant access to protected APIs or full session', async () => {
    const req = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });

    const res = await loginHandler(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.mfaRequired).toBe(true);
    expect(data.authStage).toBe('mfa_pending');

    // Verify session_token cookie is NOT set (only mfa_preauth_token is set)
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).not.toContain('session_token=');
    expect(setCookie).toContain('mfa_preauth_token=');

    // Verify that the pre-auth token has authStage === 'mfa_pending'
    const preAuthToken = data.preAuthToken;
    const verifiedPayload = await verifySessionToken(preAuthToken);
    expect(verifiedPayload).not.toBeNull();
    expect(verifiedPayload?.authStage).toBe('mfa_pending');

    // Attempting to call requireAuth with pre-auth token MUST be rejected
    const testApiReq = new Request('http://localhost:3000/api/v1/providers', {
      headers: { Authorization: `Bearer ${preAuthToken}` },
    });
    await expect(requireAuth(testApiReq, 'providers:read')).rejects.toThrow(
      'MFA verification is required before accessing protected resources.'
    );
  });

  it('2. Users without MFA enrolled are forced into mfa_enrollment_required stage', async () => {
    // Disable MFA on test user
    await prisma.user.update({
      where: { id: testUserId },
      data: { mfaEnabled: false, totpSecretEncrypted: null },
    });

    const req = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });

    const res = await loginHandler(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.mfaRequired).toBe(true);
    expect(data.authStage).toBe('mfa_enrollment_required');

    // Pre-auth token must have authStage === 'mfa_enrollment_required'
    const payload = await verifySessionToken(data.preAuthToken);
    expect(payload?.authStage).toBe('mfa_enrollment_required');

    // Protected API rejects enrollment-required pre-auth token
    const testApiReq = new Request('http://localhost:3000/api/v1/providers', {
      headers: { Authorization: `Bearer ${data.preAuthToken}` },
    });
    await expect(requireAuth(testApiReq)).rejects.toThrow(
      'MFA verification is required before accessing protected resources.'
    );
  });

  it('3. Rejects invalid TOTP token during MFA verification', async () => {
    const preAuthToken = await createPreAuthToken({
      userId: testUserId,
      email: testEmail,
      role: UserRole.credentialing_specialist,
      authStage: 'mfa_pending',
    });

    const req = new Request('http://localhost:3000/api/v1/auth/mfa', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${preAuthToken}`,
      },
      body: JSON.stringify({
        userId: testUserId,
        token: '000000', // Invalid 6-digit code
      }),
    });

    const res = await mfaHandler(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.message).toContain('Invalid or expired verification code');
  });

  it('4. Accepts valid TOTP token and grants full authenticated session', async () => {
    const preAuthToken = await createPreAuthToken({
      userId: testUserId,
      email: testEmail,
      role: UserRole.credentialing_specialist,
      authStage: 'mfa_pending',
    });

    const validTotp = authenticator.generate(testSecret);

    const req = new Request('http://localhost:3000/api/v1/auth/mfa', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${preAuthToken}`,
      },
      body: JSON.stringify({
        userId: testUserId,
        token: validTotp,
      }),
    });

    const res = await mfaHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.authStage).toBe('authenticated');

    // Full session_token cookie is now present!
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('session_token=');

    // Extract session token from cookie
    const tokenMatch = setCookie.match(/session_token=([^;]+)/);
    expect(tokenMatch).not.toBeNull();
    const sessionToken = tokenMatch![1];

    const sessionPayload = await verifySessionToken(sessionToken);
    expect(sessionPayload?.authStage).toBe('authenticated');
    expect(sessionPayload?.role).toBe(UserRole.credentialing_specialist);

    // Protected API now SUCCEEDS with full session token!
    const testApiReq = new Request('http://localhost:3000/api/v1/providers', {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const verifiedSession = await requireAuth(testApiReq, 'providers:read');
    expect(verifiedSession.userId).toBe(testUserId);
  });

  it('5. Enforces TOTP Replay Prevention within the validity window', async () => {
    const preAuthToken1 = await createPreAuthToken({
      userId: testUserId,
      email: testEmail,
      role: UserRole.credentialing_specialist,
      authStage: 'mfa_pending',
    });

    const validTotp = authenticator.generate(testSecret);

    // First submission: Success!
    const req1 = new Request('http://localhost:3000/api/v1/auth/mfa', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${preAuthToken1}`,
      },
      body: JSON.stringify({
        userId: testUserId,
        token: validTotp,
      }),
    });
    const res1 = await mfaHandler(req1);
    expect(res1.status).toBe(200);

    // Second submission with the EXACT SAME TOTP token: REJECTED!
    const preAuthToken2 = await createPreAuthToken({
      userId: testUserId,
      email: testEmail,
      role: UserRole.credentialing_specialist,
      authStage: 'mfa_pending',
    });

    const req2 = new Request('http://localhost:3000/api/v1/auth/mfa', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${preAuthToken2}`,
      },
      body: JSON.stringify({
        userId: testUserId,
        token: validTotp,
      }),
    });
    const res2 = await mfaHandler(req2);
    expect(res2.status).toBe(401);
    const data2 = await res2.json();
    expect(data2.message).toContain('Invalid or expired verification code');
  });

  it('6. Single-use hashed recovery code works once and is immediately invalidated', async () => {
    const rawRecoveryCode = testBackupCodes[0];

    const preAuthToken1 = await createPreAuthToken({
      userId: testUserId,
      email: testEmail,
      role: UserRole.credentialing_specialist,
      authStage: 'mfa_pending',
    });

    // 1. Submit recovery code: Success!
    const req1 = new Request('http://localhost:3000/api/v1/auth/mfa', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${preAuthToken1}`,
      },
      body: JSON.stringify({
        userId: testUserId,
        token: rawRecoveryCode,
      }),
    });
    const res1 = await mfaHandler(req1);
    expect(res1.status).toBe(200);

    // Verify in database that code was marked as used
    const codeRecord = await prisma.userRecoveryCode.findFirst({
      where: { userId: testUserId, codeHash: hashRecoveryCode(rawRecoveryCode) },
    });
    expect(codeRecord?.usedAt).not.toBeNull();

    // 2. Re-submitting the exact same recovery code MUST be rejected!
    const preAuthToken2 = await createPreAuthToken({
      userId: testUserId,
      email: testEmail,
      role: UserRole.credentialing_specialist,
      authStage: 'mfa_pending',
    });

    const req2 = new Request('http://localhost:3000/api/v1/auth/mfa', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${preAuthToken2}`,
      },
      body: JSON.stringify({
        userId: testUserId,
        token: rawRecoveryCode,
      }),
    });
    const res2 = await mfaHandler(req2);
    expect(res2.status).toBe(401);
  });

  it('7. Enforces brute-force account lockout after 5 consecutive failed login attempts (uniform 401)', async () => {
    for (let i = 1; i <= 5; i++) {
      const req = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '10.0.0.99',
        },
        body: JSON.stringify({ email: testEmail, password: 'WrongPassword!' }),
      });
      const res = await loginHandler(req);
      // All failed attempts (including 5th) return identical 401 for anti-enumeration
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.message).toBe('Invalid email or password.');
    }

    // Verify database record has lockedUntil set
    const userInDb = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(userInDb?.failedLoginAttempts).toBe(5);
    expect(userInDb?.lockedUntil).not.toBeNull();
    expect(userInDb!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Subsequent attempt with the CORRECT password returns identical 401 (anti-enumeration)
    const lockedReq = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '10.0.0.100',
      },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const lockedRes = await loginHandler(lockedReq);
    expect(lockedRes.status).toBe(401);
    const lockedData = await lockedRes.json();
    expect(lockedData.message).toBe('Invalid email or password.');
  });

  it('8. Administrative MFA reset revokes active sessions and forces mandatory re-enrollment', async () => {
    // Create an admin user for audit log FK integrity
    const adminUser = await prisma.user.create({
      data: {
        email: `admin.${Date.now()}@example.com`,
        passwordHash: await bcrypt.hash('AdminPassword123!', 10),
        firstName: 'Admin',
        lastName: 'Super',
        role: UserRole.super_admin,
        isActive: true,
        mfaEnabled: true,
      },
    });

    // Create an active session record for test user
    await prisma.userSession.create({
      data: {
        userId: testUserId,
        sessionToken: 'active-token-xyz',
        expiresAt: new Date(Date.now() + 3600000),
      },
    });

    const adminSessToken = crypto.randomUUID();
    await prisma.userSession.create({
      data: {
        userId: adminUser.id,
        sessionToken: adminSessToken,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });

    const adminSessionToken = await createSessionToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: UserRole.super_admin,
      sessionId: adminSessToken,
      authStage: 'authenticated',
    });

    // Call administrative reset endpoint
    const resetReq = new Request(
      `http://localhost:3000/api/v1/admin/users/${testUserId}/reset-mfa`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminSessionToken}` },
      }
    );
    const resetRes = await resetMfaHandler(resetReq, { params: { id: testUserId } });
    expect(resetRes.status).toBe(200);

    // Verify all active sessions were revoked
    const remainingSessions = await prisma.userSession.count({ where: { userId: testUserId } });
    expect(remainingSessions).toBe(0);

    // Verify recovery codes were purged
    const remainingRecoveryCodes = await prisma.userRecoveryCode.count({ where: { userId: testUserId } });
    expect(remainingRecoveryCodes).toBe(0);

    // User in DB has mfaEnabled = false and secret = null
    const user = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(user?.mfaEnabled).toBe(false);
    expect(user?.totpSecretEncrypted).toBeNull();

    // User logging in with valid password is now FORCED to enroll MFA
    const loginReq = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const loginRes = await loginHandler(loginReq);
    expect(loginRes.status).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.authStage).toBe('mfa_enrollment_required');
  });
});

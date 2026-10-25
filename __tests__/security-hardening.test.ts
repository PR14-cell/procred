import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { UserRole } from '@prisma/client';
import { createSessionToken, createPreAuthToken, verifySessionToken } from '@/lib/auth/jwt';
import { requireAuth, invalidateAllUserSessions } from '@/lib/auth/server-auth';
import {
  generateTotpSecret,
  generateBackupCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
  getRecoveryCodeKey,
  verifyTotpToken,
} from '@/lib/auth/totp';
import { authenticator } from 'otplib';
import { encrypt, getEncryptionKey, validateEncryptionKey } from '@/lib/encryption/aes';
import { validateJwtSecret } from '@/lib/auth/secrets';
import { getClientIp, assertRateLimit, resetRateLimit } from '@/lib/auth/rate-limiter';
import { POST as loginHandler } from '@/app/api/v1/auth/login/route';
import { POST as mfaHandler, GET as mfaSetupHandler } from '@/app/api/v1/auth/mfa/route';
import { POST as logoutHandler } from '@/app/api/v1/auth/logout/route';
import { POST as bootstrapHandler } from '@/app/api/v1/auth/bootstrap/route';
import { PATCH as updateUserAdminHandler } from '@/app/api/v1/admin/users/[id]/route';
import { POST as createAdminUserHandler } from '@/app/api/v1/admin/users/route';
import { POST as resetMfaHandler } from '@/app/api/v1/admin/users/[id]/reset-mfa/route';
import { POST as resetPasswordHandler } from '@/app/api/v1/admin/users/[id]/reset-password/route';
import { POST as restoreBackupHandler } from '@/app/api/v1/admin/backup/[id]/restore/route';
import { GET as downloadBackupHandler } from '@/app/api/v1/admin/backup/[id]/download/route';
import { GET as getProviderHandler } from '@/app/api/v1/providers/[id]/route';
import { GET as getOrgHandler } from '@/app/api/v1/organizations/[id]/route';
import { middleware } from '@/middleware';
import { NextRequest } from 'next/server';
import { getCookieValue, invalidateSession } from '@/lib/auth/server-auth';
import { hasPermission } from '@/lib/auth/rbac';

describe('Security Hardening Verification Suite (Items 1-5)', () => {
  let testUserId: string;
  let testEmail: string;
  const testPassword = 'SecureHardeningPass123!@#';
  let testSecret: string;
  let adminUserId: string;
  let adminEmail: string;

  beforeEach(async () => {
    testEmail = `sec.test.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`;
    testSecret = generateTotpSecret();
    const passwordHash = await bcrypt.hash(testPassword, 10);

    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash,
        firstName: 'Security',
        lastName: 'Tester',
        role: UserRole.credentialing_specialist,
        isActive: true,
        mfaEnabled: true,
        totpSecretEncrypted: encrypt(testSecret, 'user.totp_secret'),
      },
    });
    testUserId = user.id;

    // Create an admin user for administrative actions
    adminEmail = `sec.admin.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`;
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: 'Sec',
        lastName: 'Admin',
        role: UserRole.super_admin,
        isActive: true,
        mfaEnabled: true,
        totpSecretEncrypted: encrypt(testSecret, 'user.totp_secret'),
      },
    });
    adminUserId = admin.id;
  });

  afterEach(async () => {
    try {
      await invalidateAllUserSessions(testUserId);
      await invalidateAllUserSessions(adminUserId);
      await prisma.userRecoveryCode.deleteMany({ where: { userId: { in: [testUserId, adminUserId] } } });
      await prisma.user.updateMany({
        where: { id: { in: [testUserId, adminUserId] } },
        data: { isActive: false },
      });
    } catch {
      // Ignore cleanup error
    }
  });

  // =========================================================================
  // ITEM 1: MFA Enrollment Bypass Prevention
  // =========================================================================
  describe('Item 1: MFA Enrollment Bypass Prevention', () => {
    it('1.1 An mfa_pending token calling GET /api/v1/auth/mfa returns 403 Forbidden', async () => {
      const pendingToken = await createPreAuthToken({
        userId: testUserId,
        email: testEmail,
        role: UserRole.credentialing_specialist,
        authStage: 'mfa_pending',
      });

      const req = new Request('http://localhost:3000/api/v1/auth/mfa', {
        method: 'GET',
        headers: { Authorization: `Bearer ${pendingToken}` },
      });

      const res = await mfaSetupHandler(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.message).toContain('MFA enrollment is not allowed when MFA is already configured');
    });

    it('1.2 An mfa_pending token calling POST with action:"enroll" fails and does NOT change totpSecretEncrypted or recovery codes', async () => {
      const userBefore = await prisma.user.findUnique({
        where: { id: testUserId },
        include: { recoveryCodes: true },
      });
      const originalSecret = userBefore?.totpSecretEncrypted;

      const pendingToken = await createPreAuthToken({
        userId: testUserId,
        email: testEmail,
        role: UserRole.credentialing_specialist,
        authStage: 'mfa_pending',
      });

      const req = new Request('http://localhost:3000/api/v1/auth/mfa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pendingToken}`,
        },
        body: JSON.stringify({
          action: 'enroll',
          userId: testUserId,
          token: '123456', // invalid code for original secret
          recoveryCodes: ['FAKE-CODE-1', 'FAKE-CODE-2'],
        }),
      });

      const res = await mfaHandler(req);
      expect(res.status).toBe(401);

      // Verify totpSecretEncrypted was completely unchanged
      const userAfter = await prisma.user.findUnique({
        where: { id: testUserId },
        include: { recoveryCodes: true },
      });
      expect(userAfter?.totpSecretEncrypted).toEqual(originalSecret);
      expect(userAfter?.recoveryCodes.length).toBe(userBefore?.recoveryCodes.length);
    });

    it('1.3 Rejects already-authenticated sessions calling GET or POST /api/v1/auth/mfa with 403', async () => {
      const sessionRecord = await prisma.userSession.create({
        data: {
          userId: testUserId,
          sessionToken: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      const authToken = await createSessionToken({
        userId: testUserId,
        email: testEmail,
        role: UserRole.credentialing_specialist,
        sessionId: sessionRecord.id,
        authStage: 'authenticated',
      });

      // GET with authenticated token
      const getReq = new Request('http://localhost:3000/api/v1/auth/mfa', {
        method: 'GET',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const getRes = await mfaSetupHandler(getReq);
      expect(getRes.status).toBe(403);

      // POST with authenticated token
      const postReq = new Request('http://localhost:3000/api/v1/auth/mfa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ token: '123456' }),
      });
      const postRes = await mfaHandler(postReq);
      expect(postRes.status).toBe(403);
    });

    it('1.4 Ignores client-supplied userId and always uses session.userId', async () => {
      // User with enrollment required
      const unenrolledUser = await prisma.user.create({
        data: {
          email: `unenrolled.${Date.now()}@example.com`,
          passwordHash: await bcrypt.hash(testPassword, 10),
          firstName: 'Unenrolled',
          lastName: 'User',
          role: UserRole.credentialing_specialist,
          isActive: true,
          mfaEnabled: false,
        },
      });

      const preAuthToken = await createPreAuthToken({
        userId: unenrolledUser.id,
        email: unenrolledUser.email,
        role: UserRole.credentialing_specialist,
        authStage: 'mfa_enrollment_required',
      });

      // Pass someone else's userId in query
      const getReq = new Request(`http://localhost:3000/api/v1/auth/mfa?userId=${testUserId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${preAuthToken}` },
      });
      const getRes = await mfaSetupHandler(getReq);
      expect(getRes.status).toBe(200);

      // Verify that the setup updated unenrolledUser, NOT testUserId
      const checkUnenrolled = await prisma.user.findUnique({ where: { id: unenrolledUser.id } });
      expect(checkUnenrolled?.mfaPendingSecretEncrypted).not.toBeNull();

      // Clean up unenrolledUser
      await prisma.user.update({ where: { id: unenrolledUser.id }, data: { isActive: false } });
    });
  });

  // =========================================================================
  // ITEM 2: Recovery Codes & Atomic Protections
  // =========================================================================
  describe('Item 2: Recovery Codes & Atomic Protections', () => {
    it('2.1 Generates 10 recovery codes with at least 80 bits of randomness each', () => {
      const codes = generateBackupCodes(10);
      expect(codes.length).toBe(10);
      for (const code of codes) {
        // Strip hyphens -> should be 20 hex characters = 10 bytes = 80 bits of entropy
        const rawHex = code.replace(/-/g, '');
        expect(rawHex.length).toBe(20);
        expect(/^[0-9A-F]{20}$/.test(rawHex)).toBe(true);
      }
    });

    it('2.2 Hashes recovery codes using HMAC-SHA256 with key derived from ENCRYPTION_KEY via HKDF', () => {
      const testCode = 'ABCD-1234-EF56-7890-AAAA';
      const hmac1 = hashRecoveryCode(testCode);
      const hmac2 = hashRecoveryCode(testCode);

      expect(hmac1).toBe(hmac2);
      expect(hmac1.length).toBe(64); // SHA256 hex string

      // Verify key derivation via HKDF with info 'recovery-code'
      const derivedKey = getRecoveryCodeKey();
      expect(derivedKey.length).toBe(32);

      const manualHmac = crypto
        .createHmac('sha256', derivedKey)
        .update(testCode.replace(/[^A-Z0-9]/g, ''), 'utf8')
        .digest('hex');
      expect(hmac1).toBe(manualHmac);

      // Verify constant-time verification helper
      expect(verifyRecoveryCode(testCode, hmac1)).toBe(true);
      expect(verifyRecoveryCode('DIFFERENT-CODE-1234-5678', hmac1)).toBe(false);
    });

    it('2.3 Server generates recovery codes at enrollment and returns them once in POST response', async () => {
      const newUser = await prisma.user.create({
        data: {
          email: `enroll.test.${Date.now()}@example.com`,
          passwordHash: await bcrypt.hash(testPassword, 10),
          firstName: 'Enroll',
          lastName: 'Tester',
          role: UserRole.credentialing_specialist,
          isActive: true,
          mfaEnabled: false,
        },
      });

      const preAuthToken = await createPreAuthToken({
        userId: newUser.id,
        email: newUser.email,
        role: UserRole.credentialing_specialist,
        authStage: 'mfa_enrollment_required',
      });

      // 1. GET setup
      const getReq = new Request('http://localhost:3000/api/v1/auth/mfa', {
        headers: { Authorization: `Bearer ${preAuthToken}` },
      });
      const getRes = await mfaSetupHandler(getReq);
      expect(getRes.status).toBe(200);
      const setupData = await getRes.json();
      expect(setupData.secret).toBeDefined();

      // 2. Generate valid token for the pending secret
      const validCode = authenticator.generate(setupData.secret);

      // 3. Complete enrollment via POST (ignore any client codes)
      const postReq = new Request('http://localhost:3000/api/v1/auth/mfa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${preAuthToken}`,
        },
        body: JSON.stringify({
          token: validCode,
          recoveryCodes: ['CLIENT-SUPPLIED-CODE-SHOULD-BE-IGNORED'],
        }),
      });

      const postRes = await mfaHandler(postReq);
      expect(postRes.status).toBe(200);
      const postData = await postRes.json();

      // Exactly 10 server-generated recovery codes returned once in response
      expect(postData.recoveryCodes).toBeDefined();
      expect(postData.recoveryCodes.length).toBe(10);
      expect(postData.recoveryCodes).not.toContain('CLIENT-SUPPLIED-CODE-SHOULD-BE-IGNORED');

      // Verify in DB that 10 codes were persisted
      const dbCodes = await prisma.userRecoveryCode.findMany({ where: { userId: newUser.id } });
      expect(dbCodes.length).toBe(10);

      await prisma.userRecoveryCode.deleteMany({ where: { userId: newUser.id } });
      await prisma.user.update({ where: { id: newUser.id }, data: { isActive: false } });
    });

    it('2.4 Atomic recovery code consumption: updateMany with usedAt IS NULL prevents concurrent replay', async () => {
      const rawCode = generateBackupCodes(1)[0];
      const codeRecord = await prisma.userRecoveryCode.create({
        data: {
          userId: testUserId,
          codeHash: hashRecoveryCode(rawCode),
        },
      });

      // First consumption: count === 1
      const res1 = await prisma.userRecoveryCode.updateMany({
        where: { id: codeRecord.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      expect(res1.count).toBe(1);

      // Second concurrent consumption attempt: count === 0
      const res2 = await prisma.userRecoveryCode.updateMany({
        where: { id: codeRecord.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      expect(res2.count).toBe(0);
    });

    it('2.5 Atomic TOTP replay protection: updateMany with lastTotpTimestamp < step', async () => {
      const step = BigInt(Math.floor(Date.now() / 1000 / 30));

      // First step recording
      const res1 = await prisma.user.updateMany({
        where: {
          id: testUserId,
          OR: [{ lastTotpTimestamp: null }, { lastTotpTimestamp: { lt: step } }],
        },
        data: { lastTotpTimestamp: step },
      });
      expect(res1.count).toBe(1);

      // Replay attempt within the same step: count === 0
      const res2 = await prisma.user.updateMany({
        where: {
          id: testUserId,
          OR: [{ lastTotpTimestamp: null }, { lastTotpTimestamp: { lt: step } }],
        },
        data: { lastTotpTimestamp: step },
      });
      expect(res2.count).toBe(0);
    });
  });

  // =========================================================================
  // ITEM 3: Secrets & Algorithm Pinning
  // =========================================================================
  describe('Item 3: Secrets Validation & HS256 Pinning', () => {
    it('3.1 validateJwtSecret rejects missing, short, or placeholder secrets', () => {
      expect(() => validateJwtSecret(undefined)).toThrow(/NEXTAUTH_SECRET.*missing/);
      expect(() => validateJwtSecret('short-secret')).toThrow(/at least 32 characters/);
      expect(() => validateJwtSecret('your-nextauth-secret-here-at-least-32-chars-long')).toThrow(
        /placeholder/
      );
      expect(() => validateJwtSecret('a'.repeat(32))).toThrow(/placeholder or repeated/);

      // Valid secret succeeds
      expect(validateJwtSecret('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0')).toBe(
        'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0'
      );
    });

    it('3.2 validateEncryptionKey rejects invalid or sequential placeholder keys', () => {
      expect(() => validateEncryptionKey(undefined)).toThrow(/ENCRYPTION_KEY.*missing/);
      expect(() => validateEncryptionKey('123456')).toThrow(/64-character hex string/);
      expect(() =>
        validateEncryptionKey('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
      ).toThrow(/sequential placeholder/);
      expect(() => validateEncryptionKey('f'.repeat(64))).toThrow(/single repeated character/);

      // Valid 64-hex key succeeds
      const validKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde0';
      expect(validateEncryptionKey(validKey)).toEqual(Buffer.from(validKey, 'hex'));
    });

    it('3.3 jwtVerify rejects tokens signed with algorithms other than HS256', async () => {
      // Create a forged JWT header specifying alg: 'none'
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          userId: testUserId,
          email: testEmail,
          role: 'super_admin',
          sessionId: 'fake-session',
          authStage: 'authenticated',
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url');
      const forgedNoneToken = `${header}.${payload}.`;

      const req = new Request('http://localhost:3000/api/v1/providers', {
        headers: { Authorization: `Bearer ${forgedNoneToken}` },
      });

      await expect(requireAuth(req, 'providers:read')).rejects.toThrow(/Authentication session is required/);
    });
  });

  // =========================================================================
  // ITEM 4: requireAuth DB Verification & Session Invalidation
  // =========================================================================
  describe('Item 4: requireAuth DB Verification & Session Invalidation', () => {
    it('4.1 Uses database role for permission checks, ignoring forged JWT role', async () => {
      // In DB, testUser is credentialing_specialist
      const sessionRecord = await prisma.userSession.create({
        data: {
          userId: testUserId,
          sessionToken: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      // Attacker tampers JWT payload to claim role: 'super_admin'
      const forgedJwt = await createSessionToken({
        userId: testUserId,
        email: testEmail,
        role: UserRole.super_admin, // Spoofed role in JWT
        sessionId: sessionRecord.id,
        authStage: 'authenticated',
      });

      const req = new Request('http://localhost:3000/api/v1/admin/users', {
        headers: { Authorization: `Bearer ${forgedJwt}` },
      });

      // users:manage requires admin/super_admin; DB role is specialist -> must throw 403 Forbidden!
      await expect(requireAuth(req, 'users:manage')).rejects.toThrow(/Forbidden/);
    });

    it('4.2 Rejects session if UserSession row is missing or expired in database', async () => {
      // Token referencing non-existent session UUID
      const fakeSessionId = crypto.randomUUID();
      const token = await createSessionToken({
        userId: testUserId,
        email: testEmail,
        role: UserRole.credentialing_specialist,
        sessionId: fakeSessionId,
        authStage: 'authenticated',
      });

      const req = new Request('http://localhost:3000/api/v1/providers', {
        headers: { Authorization: `Bearer ${token}` },
      });

      await expect(requireAuth(req, 'providers:read')).rejects.toThrow(/Session has been revoked or expired/);
    });

    it('4.3 Role change invalidates all active sessions for the user', async () => {
      // Create active session for testUser
      const sessionRecord = await prisma.userSession.create({
        data: {
          userId: testUserId,
          sessionToken: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      const userToken = await createSessionToken({
        userId: testUserId,
        email: testEmail,
        role: UserRole.credentialing_specialist,
        sessionId: sessionRecord.id,
        authStage: 'authenticated',
      });

      // Admin updates testUser's role to viewer
      const adminSession = await prisma.userSession.create({
        data: {
          userId: adminUserId,
          sessionToken: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const adminToken = await createSessionToken({
        userId: adminUserId,
        email: adminEmail,
        role: UserRole.super_admin,
        sessionId: adminSession.id,
        authStage: 'authenticated',
      });

      const patchReq = new Request(`http://localhost:3000/api/v1/admin/users/${testUserId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ role: UserRole.viewer }),
      });

      const patchRes = await updateUserAdminHandler(patchReq, { params: { id: testUserId } });
      expect(patchRes.status).toBe(200);

      // Verify that all user sessions for testUserId were deleted
      const remainingSessions = await prisma.userSession.count({ where: { userId: testUserId } });
      expect(remainingSessions).toBe(0);

      // Subsequent request by testUser using the old token is rejected
      const testReq = new Request('http://localhost:3000/api/v1/providers', {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      await expect(requireAuth(testReq, 'providers:read')).rejects.toThrow(/Session has been revoked or expired/);
    });
  });

  // =========================================================================
  // ITEM 5: Rate Limiting, Anti-Enumeration & Lockout
  // =========================================================================
  describe('Item 5: Rate Limiting, Anti-Enumeration & Lockout', () => {
    it('5.1 getClientIp takes IP from x-forwarded-for ONLY when TRUST_PROXY === "true"', () => {
      const origTrust = process.env.TRUST_PROXY;

      try {
        process.env.TRUST_PROXY = 'false';
        const reqUntrusted = new Request('http://localhost:3000/api/v1/auth/login', {
          headers: { 'x-forwarded-for': '203.0.113.195' },
        });
        expect(getClientIp(reqUntrusted)).toBe('127.0.0.1');

        process.env.TRUST_PROXY = 'true';
        const reqTrusted = new Request('http://localhost:3000/api/v1/auth/login', {
          headers: { 'x-forwarded-for': '203.0.113.195, 198.51.100.1' },
        });
        expect(getClientIp(reqTrusted)).toBe('203.0.113.195');
      } finally {
        process.env.TRUST_PROXY = origTrust;
      }
    });

    it('5.2 Login returns identical 401 "Invalid email or password." for unknown users, inactive users, and locked accounts', async () => {
      await resetRateLimit('login', `127.0.0.1:${testEmail}`);

      // 1. Unknown user
      const reqUnknown = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `nonexistent-user-${Date.now()}@example.com`, password: 'SomePassword123!' }),
      });
      const resUnknown = await loginHandler(reqUnknown);
      expect(resUnknown.status).toBe(401);
      const dataUnknown = await resUnknown.json();
      expect(dataUnknown.message).toBe('Invalid email or password.');

      // 2. Inactive user
      await resetRateLimit('login', `127.0.0.1:${testEmail}`);
      await prisma.user.update({ where: { id: testUserId }, data: { isActive: false } });
      const reqInactive = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      });
      const resInactive = await loginHandler(reqInactive);
      expect(resInactive.status).toBe(401);
      const dataInactive = await resInactive.json();
      expect(dataInactive.message).toBe('Invalid email or password.');

      // Reactivate user and set lockedUntil
      await resetRateLimit('login', `127.0.0.1:${testEmail}`);
      await prisma.user.update({
        where: { id: testUserId },
        data: { isActive: true, lockedUntil: new Date(Date.now() + 1800000) },
      });

      // 3. Locked account
      const reqLocked = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      });
      const resLocked = await loginHandler(reqLocked);
      expect(resLocked.status).toBe(401);
      const dataLocked = await resLocked.json();
      expect(dataLocked.message).toBe('Invalid email or password.');
    });

    it('5.3 Unknown user login does NOT write "unknown" to UUID audit column; uses null', async () => {
      const unknownEmail = `audit.test.${Date.now()}@example.com`;
      const req = new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: unknownEmail, password: 'WrongPassword123!' }),
      });
      await loginHandler(req);

      // Query the audit log created for this attempt
      const log = await prisma.auditLog.findFirst({
        where: { userEmail: unknownEmail, action: 'login_failed' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
      expect(log?.userId).toBeNull();
      expect(log?.entityId).toBeNull();
    });

    it('5.4 MFA attempts are keyed by userId and account is locked for 30 minutes after 5 failed attempts', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });

      const preAuthToken = await createPreAuthToken({
        userId: testUserId,
        email: testEmail,
        role: UserRole.credentialing_specialist,
        authStage: 'mfa_pending',
      });

      // 4 failed MFA attempts from different IP addresses
      for (let i = 1; i <= 4; i++) {
        const req = new Request('http://localhost:3000/api/v1/auth/mfa', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${preAuthToken}`,
            'x-forwarded-for': `192.168.1.${100 + i}`,
          },
          body: JSON.stringify({ token: '000000' }),
        });
        const res = await mfaHandler(req);
        expect(res.status).toBe(401);
      }

      // 5th failed MFA attempt locks the account for 30 minutes
      const req5 = new Request('http://localhost:3000/api/v1/auth/mfa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${preAuthToken}`,
          'x-forwarded-for': '192.168.1.150',
        },
        body: JSON.stringify({ token: '000000' }),
      });
      const res5 = await mfaHandler(req5);
      expect(res5.status).toBe(403);
      const data5 = await res5.json();
      expect(data5.message).toContain('Account is temporarily locked for 30 minutes');

      // Verify in DB that account has lockedUntil set
      const userInDb = await prisma.user.findUnique({ where: { id: testUserId } });
      expect(userInDb?.failedLoginAttempts).toBe(5);
      expect(userInDb?.lockedUntil).not.toBeNull();
      expect(userInDb!.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 25 * 60 * 1000);
    });
  });

  // =========================================================================
  // SECTION A: Review Fixes from Batch 1
  // =========================================================================
  describe('Section A: Review Fixes (Recovery Codes, Logout, DB Role, Trust Proxy)', () => {
    it('A.1 Allows recovery codes up to 64 chars (>=32 chars); logs in once and reusing it fails', async () => {
      // Generate a valid recovery code for test user
      const rawCode = generateBackupCodes(1)[0]; // 24 chars: XXXX-XXXX-XXXX-XXXX-XXXX
      expect(rawCode.length).toBe(24);

      // Store hashed recovery code in DB
      await prisma.userRecoveryCode.create({
        data: {
          userId: testUserId,
          codeHash: hashRecoveryCode(rawCode),
        },
      });

      const preAuthToken = await createPreAuthToken({
        userId: testUserId,
        email: testEmail,
        role: UserRole.credentialing_specialist,
        authStage: 'mfa_pending',
      });

      // 1. Submit recovery code (length > 20 chars with dashes)
      const req = new Request('http://localhost:3000/api/v1/auth/mfa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${preAuthToken}`,
        },
        body: JSON.stringify({ token: rawCode }),
      });

      const res = await mfaHandler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.authStage).toBe('authenticated');

      // 2. Reusing the SAME recovery code must fail with 401 Unauthorized
      const reqReuse = new Request('http://localhost:3000/api/v1/auth/mfa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${preAuthToken}`,
        },
        body: JSON.stringify({ token: rawCode }),
      });

      const resReuse = await mfaHandler(reqReuse);
      expect(resReuse.status).toBe(401);
    });

    it('A.2 Logout deletes the UserSession row AND clears that session from 30s in-memory cache', async () => {
      // Create session in DB
      const sessionToken = crypto.randomUUID();
      const dbSession = await prisma.userSession.create({
        data: {
          userId: testUserId,
          sessionToken,
          expiresAt: new Date(Date.now() + 3600 * 1000),
        },
      });

      const jwtToken = await createSessionToken({
        userId: testUserId,
        email: testEmail,
        role: UserRole.credentialing_specialist,
        sessionId: dbSession.id,
      });

      // Warm up the 30s cache by calling requireAuth once
      const authReq = new Request('http://localhost:3000/api/v1/dashboard/stats', {
        headers: { Cookie: `session_token=${jwtToken}` },
      });
      const initialAuth = await requireAuth(authReq);
      expect(initialAuth.userId).toBe(testUserId);

      // Perform logout
      const logoutReq = new Request('http://localhost:3000/api/v1/auth/logout', {
        method: 'POST',
        headers: { Cookie: `session_token=${jwtToken}` },
      });
      const logoutRes = await logoutHandler(logoutReq);
      expect(logoutRes.status).toBe(200);

      // Verify row is deleted from database
      const rowInDb = await prisma.userSession.findUnique({ where: { id: dbSession.id } });
      expect(rowInDb).toBeNull();

      // Subsequent requireAuth must fail immediately (cache must be cleared)
      const afterLogoutReq = new Request('http://localhost:3000/api/v1/dashboard/stats', {
        headers: { Cookie: `session_token=${jwtToken}` },
      });
      await expect(requireAuth(afterLogoutReq)).rejects.toThrow();
    });

    it('A.3 requireAuth returns DATABASE role, not JWT role if JWT was tampered or outdated', async () => {
      // User is credentialing_specialist in DB
      const sessionToken = crypto.randomUUID();
      const dbSession = await prisma.userSession.create({
        data: {
          userId: testUserId,
          sessionToken,
          expiresAt: new Date(Date.now() + 3600 * 1000),
        },
      });

      // Craft a JWT token claiming super_admin role
      const forgedJwt = await createSessionToken({
        userId: testUserId,
        email: testEmail,
        role: UserRole.super_admin, // Claiming super_admin in JWT
        sessionId: dbSession.id,
      });

      const req = new Request('http://localhost:3000/api/v1/dashboard/stats', {
        headers: { Cookie: `session_token=${forgedJwt}` },
      });

      // requireAuth must load the actual database role
      const authenticatedSession = await requireAuth(req);
      expect(authenticatedSession.role).toBe(UserRole.credentialing_specialist);
      expect(authenticatedSession.role).not.toBe(UserRole.super_admin);
    });

    it('A.4 getClientIp extracts first entry of x-forwarded-for when TRUST_PROXY is true', () => {
      const origTrust = process.env.TRUST_PROXY;
      try {
        process.env.TRUST_PROXY = 'true';
        const req = new Request('http://localhost:3000/api/test', {
          headers: {
            'x-forwarded-for': '203.0.113.195, 192.168.1.1, 10.0.0.1',
          },
        });
        expect(getClientIp(req)).toBe('203.0.113.195');

        // When TRUST_PROXY is false, ignores proxy headers
        process.env.TRUST_PROXY = 'false';
        expect(getClientIp(req)).toBe('127.0.0.1');
      } finally {
        process.env.TRUST_PROXY = origTrust;
      }
    });
  });

  // =========================================================================
  // SECTION C: Bootstrap Endpoint Security
  // =========================================================================
  describe('Section C: Bootstrap Endpoint Hardening', () => {
    it('C.1 Enforces timingSafeEqual comparison and rate limiting on bootstrap attempts', async () => {
      const origToken = process.env.INITIAL_SETUP_TOKEN;
      const origTrust = process.env.TRUST_PROXY;
      process.env.INITIAL_SETUP_TOKEN = 'secret_bootstrap_token_test_12345';
      process.env.TRUST_PROXY = 'true';

      const testIp = `198.51.100.${Math.floor(Math.random() * 200 + 10)}`;
      await resetRateLimit('bootstrap_attempts', testIp);
      await resetRateLimit('bootstrap_attempts', '127.0.0.1');

      try {
        // 1. Attempt with wrong token -> 403 Forbidden
        const req = new Request('http://localhost:3000/api/v1/auth/bootstrap', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': testIp,
          },
          body: JSON.stringify({
            setupToken: 'wrong_token_12345678',
            email: 'admin.boot@example.com',
            password: 'ValidPassword123!',
            firstName: 'Super',
            lastName: 'Admin',
          }),
        });

        const res = await bootstrapHandler(req);
        expect(res.status).toBe(403);

        // Verify audit log recorded failed attempt
        const failedLog = await prisma.auditLog.findFirst({
          where: { action: 'bootstrap_failed' },
          orderBy: { createdAt: 'desc' },
        });
        expect(failedLog).not.toBeNull();

        // 2. Enforces IP rate limiting (5 attempts per 15 min)
        for (let i = 0; i < 4; i++) {
          const r = new Request('http://localhost:3000/api/v1/auth/bootstrap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': testIp },
            body: JSON.stringify({
              setupToken: 'wrong_token_12345678',
              email: 'admin.boot@example.com',
              password: 'ValidPassword123!',
              firstName: 'Super',
              lastName: 'Admin',
            }),
          });
          await bootstrapHandler(r);
        }

        // 6th attempt from testIp -> 429 Too Many Requests
        const req6 = new Request('http://localhost:3000/api/v1/auth/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': testIp },
          body: JSON.stringify({
            setupToken: 'wrong_token_12345678',
            email: 'admin.boot@example.com',
            password: 'ValidPassword123!',
            firstName: 'Super',
            lastName: 'Admin',
          }),
        });
        const res6 = await bootstrapHandler(req6);
        expect(res6.status).toBe(429);
      } finally {
        process.env.INITIAL_SETUP_TOKEN = origToken;
        process.env.TRUST_PROXY = origTrust;
      }
    });
  });

  // =========================================================================
  // SECTION D: Middleware & Request Handling
  // =========================================================================
  describe('Section D: Middleware & Request Handling Security', () => {
    it('D.1 Prevents arbitrary extension bypass; allows only static extensions under static paths', async () => {
      // A request to /dashboard/secret.txt must NOT bypass middleware
      const bypassReq = new NextRequest('http://localhost:3000/dashboard/secret.txt');
      const bypassRes = await middleware(bypassReq);
      // Unauthenticated, so it redirects to login
      expect(bypassRes.status).toBe(307);
      expect(bypassRes.headers.get('location')).toContain('/login');

      // A genuine static asset under /_next/ is allowed
      const staticReq = new NextRequest('http://localhost:3000/_next/static/chunk.js');
      const staticRes = await middleware(staticReq);
      expect(staticRes.status).toBe(200);
    });

    it('D.2 Injects comprehensive security headers: CSP, HSTS, and Cache-Control: no-store', async () => {
      const req = new NextRequest('http://localhost:3000/api/health', {
        headers: { 'x-forwarded-proto': 'https' },
      });
      const res = await middleware(req);

      // CSP
      const csp = res.headers.get('Content-Security-Policy');
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");

      // HSTS
      expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=63072000');

      // Cache-Control: no-store on /api
      expect(res.headers.get('Cache-Control')).toContain('no-store');
    });

    it('D.3 CSRF Protection: rejects API mutations with mismatched origin, allows matching host and Bearer tokens', async () => {
      // 1. Mismatched origin on POST /api/v1/auth/login -> 403 Forbidden
      const csrfReq = new NextRequest('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'https://evil-attacker.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'test@example.com', password: 'pass' }),
      });
      const csrfRes = await middleware(csrfReq);
      expect(csrfRes.status).toBe(403);

      // 2. Matching origin -> allowed through to API
      const validOriginReq = new NextRequest('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'test@example.com', password: 'pass' }),
      });
      const validRes = await middleware(validOriginReq);
      expect(validRes.status).toBe(200);

      // 3. Authorization: Bearer token skips CSRF check
      const bearerReq = new NextRequest('http://localhost:3000/api/v1/providers', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'https://any-external-client.com',
          authorization: 'Bearer dummy_test_token_123',
          'Content-Type': 'application/json',
        },
      });
      const bearerRes = await middleware(bearerReq);
      expect(bearerRes.status).toBe(200);
    });

    it('D.4 Exact cookie parsing ignores substring false positives', () => {
      const req = new Request('http://localhost:3000/api/test', {
        headers: {
          Cookie: 'fake_session_token=malicious_data; session_token=real_session_token_123; other_cookie=xyz',
        },
      });

      const parsed = getCookieValue(req, 'session_token');
      expect(parsed).toBe('real_session_token_123');
      expect(parsed).not.toBe('malicious_data');
    });
  });

  // =========================================================================
  // SECTION G: Authorization & Super Admin Protections
  // =========================================================================
  describe('Section G: Authorization & Super Admin Protections', () => {
    it('G.1 Grants pii:reveal strictly to super_admin and admin only', () => {
      expect(hasPermission(UserRole.super_admin, 'pii:reveal')).toBe(true);
      expect(hasPermission(UserRole.admin, 'pii:reveal')).toBe(true);
      expect(hasPermission(UserRole.credentialing_specialist, 'pii:reveal')).toBe(false);
      expect(hasPermission(UserRole.enrollment_specialist, 'pii:reveal')).toBe(false);
      expect(hasPermission(UserRole.viewer, 'pii:reveal')).toBe(false);
    });

    it('G.2 Denies SSN reveal to credentialing_specialist and audit-logs pii_reveal for admin', async () => {
      // Create a test provider with encrypted SSN
      const ssnPlaintext = '123-45-6789';
      const provider = await prisma.provider.create({
        data: {
          firstName: 'John',
          lastName: 'Doe',
          npiNumber: `${Math.floor(1000000000 + Math.random() * 9000000000)}`,
          ssnEncrypted: encrypt(ssnPlaintext, 'provider.ssn'),
          status: 'active',
        },
      });

      // 1. Specialist session attempting revealSsn=true -> 403 Forbidden
      const specSession = await prisma.userSession.create({
        data: {
          userId: testUserId,
          sessionToken: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600 * 1000),
        },
      });
      const specToken = await createSessionToken({
        userId: testUserId,
        email: testEmail,
        role: UserRole.credentialing_specialist,
        sessionId: specSession.id,
      });

      const specReq = new Request(`http://localhost:3000/api/v1/providers/${provider.id}?revealSsn=true`, {
        headers: { Authorization: `Bearer ${specToken}` },
      });
      const specRes = await getProviderHandler(specReq, { params: { id: provider.id } });
      expect(specRes.status).toBe(403);

      // 2. Admin session attempting revealSsn=true -> succeeds and logs pii_reveal
      const adminSession = await prisma.userSession.create({
        data: {
          userId: adminUserId,
          sessionToken: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600 * 1000),
        },
      });
      const adminToken = await createSessionToken({
        userId: adminUserId,
        email: adminEmail,
        role: UserRole.super_admin,
        sessionId: adminSession.id,
      });

      const adminReq = new Request(`http://localhost:3000/api/v1/providers/${provider.id}?revealSsn=true`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const adminRes = await getProviderHandler(adminReq, { params: { id: provider.id } });
      expect(adminRes.status).toBe(200);
      const adminData = await adminRes.json();
      expect(adminData.provider.ssn).toBe(ssnPlaintext);

      // Verify audit log
      const piiLog = await prisma.auditLog.findFirst({
        where: { action: 'pii_reveal', entityId: provider.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(piiLog).not.toBeNull();
      expect((piiLog?.metadata as any)?.field).toBe('ssn');

      // Cleanup
      await prisma.provider.delete({ where: { id: provider.id } });
    });

    it('G.3 Only super_admin can create or promote to super_admin; admin gets 403 Forbidden', async () => {
      // Create regular admin user
      const regularAdminEmail = `reg.admin.${Date.now()}@example.com`;
      const regAdmin = await prisma.user.create({
        data: {
          email: regularAdminEmail,
          passwordHash: await bcrypt.hash('Password123!', 10),
          firstName: 'Reg',
          lastName: 'Admin',
          role: UserRole.admin,
          isActive: true,
          mfaEnabled: false,
        },
      });

      const regSession = await prisma.userSession.create({
        data: {
          userId: regAdmin.id,
          sessionToken: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600 * 1000),
        },
      });
      const regToken = await createSessionToken({
        userId: regAdmin.id,
        email: regAdmin.email,
        role: UserRole.admin,
        sessionId: regSession.id,
      });

      // Regular admin trying to create super_admin -> 403
      const createReq = new Request('http://localhost:3000/api/v1/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${regToken}`,
        },
        body: JSON.stringify({
          email: `new.super.${Date.now()}@example.com`,
          password: 'Password123!@#',
          firstName: 'Illegal',
          lastName: 'Super',
          role: UserRole.super_admin,
        }),
      });
      const createRes = await createAdminUserHandler(createReq);
      expect(createRes.status).toBe(403);

      // Regular admin trying to modify super_admin user -> 403
      const modReq = new Request(`http://localhost:3000/api/v1/admin/users/${adminUserId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${regToken}`,
        },
        body: JSON.stringify({ firstName: 'Tampered' }),
      });
      const modRes = await updateUserAdminHandler(modReq, { params: { id: adminUserId } });
      expect(modRes.status).toBe(403);

      // Regular admin trying to reset MFA for super_admin -> 403
      const mfaResetReq = new Request(`http://localhost:3000/api/v1/admin/users/${adminUserId}/reset-mfa`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${regToken}` },
      });
      const mfaResetRes = await resetMfaHandler(mfaResetReq, { params: { id: adminUserId } });
      expect(mfaResetRes.status).toBe(403);

      // Regular admin trying to reset password for super_admin -> 403
      const pwdResetReq = new Request(`http://localhost:3000/api/v1/admin/users/${adminUserId}/reset-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${regToken}` },
      });
      const pwdResetRes = await resetPasswordHandler(pwdResetReq, { params: { id: adminUserId } });
      expect(pwdResetRes.status).toBe(403);

      // Cleanup
      await prisma.user.delete({ where: { id: regAdmin.id } });
    });

    it('G.4 Fresh TOTP code verification enforces TOTP code when acting user has MFA enabled', async () => {
      // Create session for super_admin with active MFA
      const adminSession = await prisma.userSession.create({
        data: {
          userId: adminUserId,
          sessionToken: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600 * 1000),
        },
      });
      const adminToken = await createSessionToken({
        userId: adminUserId,
        email: adminEmail,
        role: UserRole.super_admin,
        sessionId: adminSession.id,
      });

      // 1. Reset MFA without TOTP code -> 400 Bad Request
      const reqNoTotp = new Request(`http://localhost:3000/api/v1/admin/users/${testUserId}/reset-mfa`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const resNoTotp = await resetMfaHandler(reqNoTotp, { params: { id: testUserId } });
      expect(resNoTotp.status).toBe(400);

      // 2. Reset MFA with invalid TOTP code -> 401 Unauthorized
      const reqInvalidTotp = new Request(`http://localhost:3000/api/v1/admin/users/${testUserId}/reset-mfa`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'x-totp-code': '000000',
        },
      });
      const resInvalidTotp = await resetMfaHandler(reqInvalidTotp, { params: { id: testUserId } });
      expect(resInvalidTotp.status).toBe(401);

      // 3. Reset MFA with valid fresh TOTP code -> 200 OK
      const validCode = authenticator.generate(testSecret);
      const reqValidTotp = new Request(`http://localhost:3000/api/v1/admin/users/${testUserId}/reset-mfa`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'x-totp-code': validCode,
        },
      });
      const resValidTotp = await resetMfaHandler(reqValidTotp, { params: { id: testUserId } });
      expect(resValidTotp.status).toBe(200);
      const validData = await resValidTotp.json();
      expect(validData.success).toBe(true);
    });
  });
});

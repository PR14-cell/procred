import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../src/lib/db/prisma';
import { UserRole } from '@prisma/client';
import { createSessionToken } from '../src/lib/auth/jwt';
import { hasPermission } from '../src/lib/auth/rbac';
import { BackupService } from '../src/lib/backup/backup-service';
import { CacheService } from '../src/lib/cache/redis-cache';
import { encrypt, decrypt } from '../src/lib/encryption/aes';

// Route Handlers
import { GET as listUsersRoute, POST as createUserRoute } from '../src/app/api/v1/admin/users/route';
import { GET as getUserRoute, PATCH as updateUserRoute } from '../src/app/api/v1/admin/users/[id]/route';
import { POST as resetUserPasswordRoute } from '../src/app/api/v1/admin/users/[id]/reset-password/route';
import { GET as getProfileRoute, PATCH as updateProfileRoute } from '../src/app/api/v1/profile/route';
import { POST as changePasswordRoute } from '../src/app/api/v1/profile/change-password/route';
import { GET as listBackupsRoute, POST as createBackupRoute } from '../src/app/api/v1/admin/backup/route';
import { POST as verifyBackupRoute } from '../src/app/api/v1/admin/backup/[id]/verify/route';
import { GET as downloadBackupRoute } from '../src/app/api/v1/admin/backup/[id]/download/route';
import { POST as restoreBackupRoute, GET as restoreGetRejectRoute } from '../src/app/api/v1/admin/backup/[id]/restore/route';

describe('Admin & System Management Enhancement Module', () => {
  let superAdminUser: any;
  let adminUser: any;
  let secondAdminUser: any;
  let specialistUser: any;
  let viewerUser: any;

  let superAdminToken: string;
  let adminToken: string;
  let specialistToken: string;
  let viewerToken: string;

  let superAdminSessionId: string;
  let adminSessionId: string;
  let specialistSessionId: string;
  let viewerSessionId: string;

  beforeAll(async () => {
    // 1. Create synthetic users
    const hashedInitialPassword = await bcrypt.hash('InitialSecureP@ss123', 10);

    superAdminUser = await prisma.user.upsert({
      where: { email: 'adm_super@example.com' },
      update: { isActive: true, role: UserRole.super_admin, passwordHash: hashedInitialPassword },
      create: {
        email: 'adm_super@example.com',
        passwordHash: hashedInitialPassword,
        firstName: 'Sarah',
        lastName: 'SuperAdmin',
        role: UserRole.super_admin,
        isActive: true,
      },
    });

    adminUser = await prisma.user.upsert({
      where: { email: 'adm_primary@example.com' },
      update: { isActive: true, role: UserRole.admin, passwordHash: hashedInitialPassword },
      create: {
        email: 'adm_primary@example.com',
        passwordHash: hashedInitialPassword,
        firstName: 'Adam',
        lastName: 'AdminPrimary',
        role: UserRole.admin,
        isActive: true,
      },
    });

    secondAdminUser = await prisma.user.upsert({
      where: { email: 'adm_secondary@example.com' },
      update: { isActive: true, role: UserRole.admin, passwordHash: hashedInitialPassword },
      create: {
        email: 'adm_secondary@example.com',
        passwordHash: hashedInitialPassword,
        firstName: 'Arthur',
        lastName: 'AdminSecondary',
        role: UserRole.admin,
        isActive: true,
      },
    });

    specialistUser = await prisma.user.upsert({
      where: { email: 'adm_specialist@example.com' },
      update: { isActive: true, role: UserRole.credentialing_specialist, passwordHash: hashedInitialPassword },
      create: {
        email: 'adm_specialist@example.com',
        passwordHash: hashedInitialPassword,
        firstName: 'Sam',
        lastName: 'Specialist',
        role: UserRole.credentialing_specialist,
        isActive: true,
      },
    });

    viewerUser = await prisma.user.upsert({
      where: { email: 'adm_viewer@example.com' },
      update: { isActive: true, role: UserRole.viewer, passwordHash: hashedInitialPassword },
      create: {
        email: 'adm_viewer@example.com',
        passwordHash: hashedInitialPassword,
        firstName: 'Vicky',
        lastName: 'Viewer',
        role: UserRole.viewer,
        isActive: true,
      },
    });

    // 2. Create active session records in database
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000);

    const s1 = await prisma.userSession.create({
      data: {
        userId: superAdminUser.id,
        sessionToken: crypto.randomUUID(),
        expiresAt,
      },
    });
    superAdminSessionId = s1.id;
    superAdminToken = await createSessionToken({
      userId: superAdminUser.id,
      email: superAdminUser.email,
      role: superAdminUser.role,
      sessionId: s1.id,
    });

    const s2 = await prisma.userSession.create({
      data: {
        userId: adminUser.id,
        sessionToken: crypto.randomUUID(),
        expiresAt,
      },
    });
    adminSessionId = s2.id;
    adminToken = await createSessionToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      sessionId: s2.id,
    });

    const s3 = await prisma.userSession.create({
      data: {
        userId: specialistUser.id,
        sessionToken: crypto.randomUUID(),
        expiresAt,
      },
    });
    specialistSessionId = s3.id;
    specialistToken = await createSessionToken({
      userId: specialistUser.id,
      email: specialistUser.email,
      role: specialistUser.role,
      sessionId: s3.id,
    });

    const s4 = await prisma.userSession.create({
      data: {
        userId: viewerUser.id,
        sessionToken: crypto.randomUUID(),
        expiresAt,
      },
    });
    viewerSessionId = s4.id;
    viewerToken = await createSessionToken({
      userId: viewerUser.id,
      email: viewerUser.email,
      role: viewerUser.role,
      sessionId: s4.id,
    });
  });

  afterAll(async () => {
    // Cleanup sessions created during tests
    await prisma.userSession.deleteMany({
      where: {
        userId: {
          in: [
            superAdminUser.id,
            adminUser.id,
            secondAdminUser.id,
            specialistUser.id,
            viewerUser.id,
          ],
        },
      },
    });
  });

  // Helper to construct authenticated requests
  function makeReq(url: string, token: string, method = 'GET', body?: any): Request {
    const headers: Record<string, string> = {
      cookie: `session_token=${token}`,
    };
    if (body) {
      headers['content-type'] = 'application/json';
    }
    return new Request(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // =========================================================================
  // DOMAIN 1: RBAC PERMISSION EXTENSIONS
  // =========================================================================
  describe('1. RBAC Permission Extensions', () => {
    it('grants system:backup to super_admin and admin, but denies to specialist and viewer', () => {
      expect(hasPermission(UserRole.super_admin, 'system:backup')).toBe(true);
      expect(hasPermission(UserRole.admin, 'system:backup')).toBe(true);
      expect(hasPermission(UserRole.credentialing_specialist, 'system:backup')).toBe(false);
      expect(hasPermission(UserRole.enrollment_specialist, 'system:backup')).toBe(false);
      expect(hasPermission(UserRole.viewer, 'system:backup')).toBe(false);
    });

    it('grants system:restore exclusively to super_admin', () => {
      expect(hasPermission(UserRole.super_admin, 'system:restore')).toBe(true);
      expect(hasPermission(UserRole.admin, 'system:restore')).toBe(false);
      expect(hasPermission(UserRole.credentialing_specialist, 'system:restore')).toBe(false);
      expect(hasPermission(UserRole.viewer, 'system:restore')).toBe(false);
    });
  });

  // =========================================================================
  // DOMAIN 2: PASSWORD MANAGEMENT & SECURITY
  // =========================================================================
  describe('2. Password Management (Self-Service & Admin-Initiated)', () => {
    it('allows a user to change their own password with valid current password and password policy', async () => {
      const req = makeReq('http://localhost:3000/api/v1/profile/change-password', specialistToken, 'POST', {
        currentPassword: 'InitialSecureP@ss123',
        newPassword: 'BrandNewSecureP@ss456',
        confirmPassword: 'BrandNewSecureP@ss456',
      });

      const res = await changePasswordRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // Verify DB password hash was updated
      const updatedUser = await prisma.user.findUnique({ where: { id: specialistUser.id } });
      const isValid = await bcrypt.compare('BrandNewSecureP@ss456', updatedUser!.passwordHash);
      expect(isValid).toBe(true);

      // Verify audit log
      const log = await prisma.auditLog.findFirst({
        where: { action: 'password_changed', entityId: specialistUser.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
    });

    it('rejects password change if current password does not match', async () => {
      const req = makeReq('http://localhost:3000/api/v1/profile/change-password', specialistToken, 'POST', {
        currentPassword: 'WrongPassword999!',
        newPassword: 'AnotherSecureP@ss789',
        confirmPassword: 'AnotherSecureP@ss789',
      });

      const res = await changePasswordRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.message).toContain('Incorrect current password');
    });

    it('rejects password change if new password is identical to current password', async () => {
      const req = makeReq('http://localhost:3000/api/v1/profile/change-password', specialistToken, 'POST', {
        currentPassword: 'BrandNewSecureP@ss456',
        newPassword: 'BrandNewSecureP@ss456',
        confirmPassword: 'BrandNewSecureP@ss456',
      });

      const res = await changePasswordRoute(req);
      expect(res.status).toBe(400);
    });

    it('rejects weak new passwords failing complexity rules (min 8 chars, uppercase, lowercase, digit)', async () => {
      // Missing digit
      const reqNoDigit = makeReq('http://localhost:3000/api/v1/profile/change-password', specialistToken, 'POST', {
        currentPassword: 'BrandNewSecureP@ss456',
        newPassword: 'NoNumbersPassword',
        confirmPassword: 'NoNumbersPassword',
      });
      const res1 = await changePasswordRoute(reqNoDigit);
      expect(res1.status).toBe(400);

      // Missing uppercase
      const reqNoUpper = makeReq('http://localhost:3000/api/v1/profile/change-password', specialistToken, 'POST', {
        currentPassword: 'BrandNewSecureP@ss456',
        newPassword: 'lowercase1234',
        confirmPassword: 'lowercase1234',
      });
      const res2 = await changePasswordRoute(reqNoUpper);
      expect(res2.status).toBe(400);
    });

    it('invalidates other active user sessions upon self-service password change', async () => {
      // Create a second active session for specialistUser
      const extraSession = await prisma.userSession.create({
        data: {
          userId: specialistUser.id,
          sessionToken: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      const req = makeReq('http://localhost:3000/api/v1/profile/change-password', specialistToken, 'POST', {
        currentPassword: 'BrandNewSecureP@ss456',
        newPassword: 'UpdatedSecureP@ss789',
        confirmPassword: 'UpdatedSecureP@ss789',
      });

      const res = await changePasswordRoute(req);
      expect(res.status).toBe(200);

      // Extra session must be invalidated from user_sessions table
      const remainingExtraSession = await prisma.userSession.findUnique({
        where: { id: extraSession.id },
      });
      expect(remainingExtraSession).toBeNull();
    });

    it('enforces rate limiting on repeated failed password changes', async () => {
      const rateLimitKey = `rate_limit:pwd_change:${viewerUser.id}`;
      // Clear before test
      await CacheService.del(rateLimitKey);

      for (let i = 0; i < 5; i++) {
        const req = makeReq('http://localhost:3000/api/v1/profile/change-password', viewerToken, 'POST', {
          currentPassword: 'WrongPassword!',
          newPassword: 'NewValidPassword123!',
          confirmPassword: 'NewValidPassword123!',
        });
        await changePasswordRoute(req);
      }

      // 6th attempt must be blocked by rate limiter
      const reqBlocked = makeReq('http://localhost:3000/api/v1/profile/change-password', viewerToken, 'POST', {
        currentPassword: 'WrongPassword!',
        newPassword: 'NewValidPassword123!',
        confirmPassword: 'NewValidPassword123!',
      });
      const resBlocked = await changePasswordRoute(reqBlocked);
      expect(resBlocked.status).toBe(400);
      const json = await resBlocked.json();
      expect(json.message).toContain('Too many failed password change attempts');

      await CacheService.del(rateLimitKey);
    });

    it('allows administrator to reset a user password and invalidates all sessions for target user', async () => {
      // Create a test user for reset
      const targetUser = await prisma.user.create({
        data: {
          email: `target_reset_${Date.now()}@example.com`,
          passwordHash: await bcrypt.hash('OldPassword123', 10),
          firstName: 'Target',
          lastName: 'ResetTest',
          role: UserRole.viewer,
          isActive: true,
        },
      });

      const sessionRec = await prisma.userSession.create({
        data: {
          userId: targetUser.id,
          sessionToken: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      const req = makeReq(
        `http://localhost:3000/api/v1/admin/users/${targetUser.id}/reset-password`,
        adminToken,
        'POST'
      );
      const res = await resetUserPasswordRoute(req, { params: { id: targetUser.id } });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.temporaryPassword).toBeDefined();
      expect(json.temporaryPassword.length).toBeGreaterThanOrEqual(8);

      // Verify DB hash changed and matches returned temporary password
      const reloadedUser = await prisma.user.findUnique({ where: { id: targetUser.id } });
      const matches = await bcrypt.compare(json.temporaryPassword, reloadedUser!.passwordHash);
      expect(matches).toBe(true);

      // Verify sessions revoked
      const remainingSession = await prisma.userSession.findUnique({ where: { id: sessionRec.id } });
      expect(remainingSession).toBeNull();

      // Verify audit log exists and does NOT contain the temporary password or hash
      const auditLog = await prisma.auditLog.findFirst({
        where: { action: 'user_password_reset', entityId: targetUser.id },
      });
      expect(auditLog).not.toBeNull();
      expect(JSON.stringify(auditLog)).not.toContain(json.temporaryPassword);

      // Clean up target user
      await prisma.userSession.deleteMany({ where: { userId: targetUser.id } });
      await prisma.user.update({ where: { id: targetUser.id }, data: { isActive: false } });
    });

    it('prevents non-admin roles from initiating password resets', async () => {
      const req = makeReq(
        `http://localhost:3000/api/v1/admin/users/${viewerUser.id}/reset-password`,
        viewerToken,
        'POST'
      );
      const res = await resetUserPasswordRoute(req, { params: { id: viewerUser.id } });
      expect(res.status).toBe(403);
    });

    it('prevents ordinary admin from resetting password of a super_admin', async () => {
      const req = makeReq(
        `http://localhost:3000/api/v1/admin/users/${superAdminUser.id}/reset-password`,
        adminToken,
        'POST'
      );
      const res = await resetUserPasswordRoute(req, { params: { id: superAdminUser.id } });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.message).toContain('Only a super_admin can reset the password for another super_admin');
    });
  });

  // =========================================================================
  // DOMAIN 3: USER & PROFILE MANAGEMENT
  // =========================================================================
  describe('3. User & Profile Management', () => {
    it('allows authorized admin to list and search users with pagination', async () => {
      const req = makeReq('http://localhost:3000/api/v1/admin/users?page=1&limit=5&status=active', adminToken);
      const res = await listUsersRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.users).toBeInstanceOf(Array);
      expect(json.total).toBeGreaterThanOrEqual(1);
      expect(json.page).toBe(1);
      expect(json.limit).toBe(5);

      // Passwords and encrypted TOTP keys must never be exposed
      for (const u of json.users) {
        expect(u.passwordHash).toBeUndefined();
        expect(u.totpSecretEncrypted).toBeUndefined();
        expect(u.mfaBackupCodesEncrypted).toBeUndefined();
      }
    });

    it('allows searching users by name or email', async () => {
      const req = makeReq('http://localhost:3000/api/v1/admin/users?search=SuperAdmin', adminToken);
      const res = await listUsersRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.users.some((u: any) => u.email === 'adm_super@example.com')).toBe(true);
    });

    it('denies user listing to non-admin roles (403 Forbidden)', async () => {
      const req = makeReq('http://localhost:3000/api/v1/admin/users', specialistToken);
      const res = await listUsersRoute(req);
      expect(res.status).toBe(403);
    });

    it('allows a user to view and update their own personal profile details', async () => {
      const reqGet = makeReq('http://localhost:3000/api/v1/profile', viewerToken);
      const resGet = await getProfileRoute(reqGet);
      expect(resGet.status).toBe(200);
      const jsonGet = await resGet.json();
      expect(jsonGet.user.email).toBe(viewerUser.email);

      const reqPatch = makeReq('http://localhost:3000/api/v1/profile', viewerToken, 'PATCH', {
        firstName: 'Victoria',
        lastName: 'ViewerUpdated',
      });
      const resPatch = await updateProfileRoute(reqPatch);
      expect(resPatch.status).toBe(200);
      const jsonPatch = await resPatch.json();
      expect(jsonPatch.user.firstName).toBe('Victoria');
      expect(jsonPatch.user.lastName).toBe('ViewerUpdated');
    });

    it('prevents user self-promotion or role alteration via profile endpoint', async () => {
      const reqPatch = makeReq('http://localhost:3000/api/v1/profile', viewerToken, 'PATCH', {
        firstName: 'Victoria',
        lastName: 'ViewerUpdated',
        role: UserRole.super_admin, // Unauthorized attempt
      });
      const resPatch = await updateProfileRoute(reqPatch);
      expect(resPatch.status).toBe(200);

      // Verify DB role was untouched
      const dbUser = await prisma.user.findUnique({ where: { id: viewerUser.id } });
      expect(dbUser?.role).toBe(UserRole.viewer);
    });

    it('allows an administrator to create a new staff account with validated role', async () => {
      const newUserEmail = `created_staff_${Date.now()}@example.com`;
      const req = makeReq('http://localhost:3000/api/v1/admin/users', adminToken, 'POST', {
        email: newUserEmail,
        password: 'StaffInitialP@ss1',
        firstName: 'New',
        lastName: 'StaffMember',
        role: UserRole.credentialing_specialist,
      });

      const res = await createUserRoute(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.user.email).toBe(newUserEmail);
      expect(json.user.role).toBe(UserRole.credentialing_specialist);

      // Clean up
      await prisma.userSession.deleteMany({ where: { userId: json.user.id } });
      await prisma.user.update({ where: { id: json.user.id }, data: { isActive: false } });
    });

    it('prevents ordinary admin from creating a super_admin account (privilege escalation check)', async () => {
      const req = makeReq('http://localhost:3000/api/v1/admin/users', adminToken, 'POST', {
        email: 'illegal_super@example.com',
        password: 'StaffInitialP@ss1',
        firstName: 'Illegal',
        lastName: 'Super',
        role: UserRole.super_admin,
      });

      const res = await createUserRoute(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.message).toContain('Only a super_admin can create another super_admin');
    });

    it('protects against deactivating or demoting the last active administrator', async () => {
      // Create a temporary solo active admin
      const soloAdmin = await prisma.user.create({
        data: {
          email: `solo_admin_guard_${Date.now()}@example.com`,
          passwordHash: await bcrypt.hash('Pass1234!', 10),
          firstName: 'Solo',
          lastName: 'AdminGuard',
          role: UserRole.admin,
          isActive: true,
        },
      });

      const soloSession = await prisma.userSession.create({
        data: {
          userId: soloAdmin.id,
          sessionToken: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      const soloAdminToken = await createSessionToken({
        userId: soloAdmin.id,
        email: soloAdmin.email,
        role: soloAdmin.role,
        sessionId: soloSession.id,
      });

      // Query all other active admins in database and temporarily deactivate them
      const allOtherActiveAdmins = await prisma.user.findMany({
        where: {
          role: { in: [UserRole.super_admin, UserRole.admin] },
          isActive: true,
          id: { not: soloAdmin.id },
        },
        select: { id: true },
      });
      const otherAdminIds = allOtherActiveAdmins.map((u) => u.id);

      await prisma.user.updateMany({
        where: { id: { in: otherAdminIds } },
        data: { isActive: false },
      });

      try {
        // soloAdmin attempting to deactivate themselves when they are the only active admin
        const reqDeactivate = makeReq(
          `http://localhost:3000/api/v1/admin/users/${soloAdmin.id}`,
          soloAdminToken,
          'PATCH',
          { isActive: false }
        );
        const resDeactivate = await updateUserRoute(reqDeactivate, { params: { id: soloAdmin.id } });
        expect(resDeactivate.status).toBe(400);
        const json1 = await resDeactivate.json();
        expect(json1.message).toContain('Cannot deactivate or demote the last active administrator');
      } finally {
        // Restore all other active admins
        await prisma.user.updateMany({
          where: { id: { in: otherAdminIds } },
          data: { isActive: true },
        });
        await prisma.userSession.deleteMany({ where: { userId: soloAdmin.id } });
        await prisma.user.update({ where: { id: soloAdmin.id }, data: { isActive: false } });
      }
    });

    it('prevents an administrator from altering their own role via admin API', async () => {
      const req = makeReq(
        `http://localhost:3000/api/v1/admin/users/${adminUser.id}`,
        adminToken,
        'PATCH',
        { role: UserRole.viewer }
      );
      const res = await updateUserRoute(req, { params: { id: adminUser.id } });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.message).toContain('Administrators cannot modify their own role');
    });

    it('deactivating an account invalidates all sessions and server-auth rejects subsequent requests', async () => {
      const testDeactUser = await prisma.user.create({
        data: {
          email: `test_deact_${Date.now()}@example.com`,
          passwordHash: await bcrypt.hash('InitialSecureP@ss123', 10),
          firstName: 'Dan',
          lastName: 'Deactivate',
          role: UserRole.viewer,
          isActive: true,
        },
      });

      const sess = await prisma.userSession.create({
        data: {
          userId: testDeactUser.id,
          sessionToken: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      const deactToken = await createSessionToken({
        userId: testDeactUser.id,
        email: testDeactUser.email,
        role: testDeactUser.role,
        sessionId: sess.id,
      });

      // Verify can fetch profile when active
      const req1 = makeReq('http://localhost:3000/api/v1/profile', deactToken);
      const res1 = await getProfileRoute(req1);
      expect(res1.status).toBe(200);

      // Deactivate the user
      const reqDeact = makeReq(
        `http://localhost:3000/api/v1/admin/users/${testDeactUser.id}`,
        adminToken,
        'PATCH',
        { isActive: false }
      );
      const resDeact = await updateUserRoute(reqDeact, { params: { id: testDeactUser.id } });
      expect(resDeact.status).toBe(200);

      // Verify sessions deleted
      const remainingSess = await prisma.userSession.findUnique({ where: { id: sess.id } });
      expect(remainingSess).toBeNull();

      // Subsequent request with the token must be rejected with 401 Unauthorized
      const req2 = makeReq('http://localhost:3000/api/v1/profile', deactToken);
      const res2 = await getProfileRoute(req2);
      expect(res2.status).toBe(401);
      const json2 = await res2.json();
      expect(json2.message).toContain('Account has been deactivated');

      // Clean up sessions
      await prisma.userSession.deleteMany({ where: { userId: testDeactUser.id } });
    });
  });

  // =========================================================================
  // DOMAIN 4: BACKUP & RESTORE MANAGEMENT
  // =========================================================================
  describe('4. Backup & Restore Management', () => {
    let createdBackupId: string;

    it('creates a coordinated backup of PostgreSQL and MinIO document storage', async () => {
      const req = makeReq('http://localhost:3000/api/v1/admin/backup', adminToken, 'POST');
      const res = await createBackupRoute(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.backup).toBeDefined();
      expect(json.backup.id).toMatch(/^backup_\d+$/);
      expect(json.backup.status).toBe('completed');
      expect(json.backup.database.sizeBytes).toBeGreaterThan(0);
      expect(json.backup.database.sha256).toHaveLength(64);
      expect(json.backup.system.secretsExcluded).toBe(true);

      createdBackupId = json.backup.id;

      // Verify manifest was saved on disk
      const backupDir = path.resolve(process.cwd(), 'backups', createdBackupId);
      expect(fs.existsSync(backupDir)).toBe(true);
      expect(fs.existsSync(path.join(backupDir, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(backupDir, 'database.sql'))).toBe(true);

      // Verify audit log
      const log = await prisma.auditLog.findFirst({
        where: { action: 'backup_created' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
      expect((log?.metadata as any)?.backupId).toBe(createdBackupId);
    });

    it('lists backups with metadata, sizes, and timestamps', async () => {
      const req = makeReq('http://localhost:3000/api/v1/admin/backup', adminToken);
      const res = await listBackupsRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.backups).toBeInstanceOf(Array);
      expect(json.total).toBeGreaterThanOrEqual(1);

      const found = json.backups.find((b: any) => b.id === createdBackupId);
      expect(found).toBeDefined();
      expect(found.databaseSizeBytes).toBeGreaterThan(0);
    });

    it('verifies integrity of a valid backup archive', async () => {
      const req = makeReq(
        `http://localhost:3000/api/v1/admin/backup/${createdBackupId}/verify`,
        adminToken,
        'POST'
      );
      const res = await verifyBackupRoute(req, { params: { id: createdBackupId } });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.isValid).toBe(true);
      expect(json.errors).toHaveLength(0);
      expect(json.details.databaseValid).toBe(true);

      // Verify audit log
      const log = await prisma.auditLog.findFirst({
        where: { action: 'backup_verified' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
      expect((log?.metadata as any)?.backupId).toBe(createdBackupId);
    });

    it('detects tampering or corruption during backup integrity verification', async () => {
      // Corrupt the manifest sha256
      const backupDir = path.resolve(process.cwd(), 'backups', createdBackupId);
      const manifestPath = path.join(backupDir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const originalSha = manifest.database.sha256;

      manifest.database.sha256 = '0000000000000000000000000000000000000000000000000000000000000000';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      try {
        const req = makeReq(
          `http://localhost:3000/api/v1/admin/backup/${createdBackupId}/verify`,
          adminToken,
          'POST'
        );
        const res = await verifyBackupRoute(req, { params: { id: createdBackupId } });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.isValid).toBe(false);
        expect(json.errors.some((e: string) => e.includes('checksum mismatch'))).toBe(true);
      } finally {
        // Restore correct sha
        manifest.database.sha256 = originalSha;
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      }
    });

    it('provides secure backup archive download with authorization and audit logging', async () => {
      const req = makeReq(
        `http://localhost:3000/api/v1/admin/backup/${createdBackupId}/download`,
        adminToken
      );
      const res = await downloadBackupRoute(req, { params: { id: createdBackupId } });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('gzip');
      const buffer = await res.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);

      // Verify audit log
      const log = await prisma.auditLog.findFirst({
        where: { action: 'backup_downloaded' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
      expect((log?.metadata as any)?.backupId).toBe(createdBackupId);
    });

    it('denies backup download to unauthorized roles', async () => {
      const req = makeReq(
        `http://localhost:3000/api/v1/admin/backup/${createdBackupId}/download`,
        specialistToken
      );
      const res = await downloadBackupRoute(req, { params: { id: createdBackupId } });
      expect(res.status).toBe(403);
    });

    it('explicitly rejects GET method on restore endpoint (prevents automated or accidental trigger)', async () => {
      const res = restoreGetRejectRoute();
      expect(res.status).toBe(405);
    });

    it('restricts restore execution strictly to super_admin (admin and viewer get 403 Forbidden)', async () => {
      // Ordinary admin attempt
      const reqAdmin = makeReq(
        `http://localhost:3000/api/v1/admin/backup/${createdBackupId}/restore`,
        adminToken,
        'POST',
        { confirmRestore: 'RESTORE_CONFIRM' }
      );
      const resAdmin = await restoreBackupRoute(reqAdmin, { params: { id: createdBackupId } });
      expect(resAdmin.status).toBe(403);

      // Viewer attempt
      const reqViewer = makeReq(
        `http://localhost:3000/api/v1/admin/backup/${createdBackupId}/restore`,
        viewerToken,
        'POST',
        { confirmRestore: 'RESTORE_CONFIRM' }
      );
      const resViewer = await restoreBackupRoute(reqViewer, { params: { id: createdBackupId } });
      expect(resViewer.status).toBe(403);
    });

    it('rejects restore execution if explicit confirmation RESTORE_CONFIRM is missing or malformed', async () => {
      const req = makeReq(
        `http://localhost:3000/api/v1/admin/backup/${createdBackupId}/restore`,
        superAdminToken,
        'POST',
        { confirmRestore: 'YES_PLEASE' } // Invalid token
      );
      const res = await restoreBackupRoute(req, { params: { id: createdBackupId } });
      expect(res.status).toBe(400);
    });

    it('executes protected restore workflow with preflight checks and creates a safety recovery point', async () => {
      const req = makeReq(
        `http://localhost:3000/api/v1/admin/backup/${createdBackupId}/restore`,
        superAdminToken,
        'POST',
        { confirmRestore: 'RESTORE_CONFIRM', createRecoveryPoint: true }
      );

      const res = await restoreBackupRoute(req, { params: { id: createdBackupId } });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.recoveryPointId).toBeDefined();
      expect(json.recoveryPointId).toMatch(/^backup_\d+$/);

      // Verify audit logs
      const preflightLog = await prisma.auditLog.findFirst({
        where: { action: 'restore_preflight_initiated' },
        orderBy: { createdAt: 'desc' },
      });
      expect(preflightLog).not.toBeNull();
      expect((preflightLog?.metadata as any)?.backupId).toBe(createdBackupId);

      const completeLog = await prisma.auditLog.findFirst({
        where: { action: 'restore_completed' },
        orderBy: { createdAt: 'desc' },
      });
      expect(completeLog).not.toBeNull();
      expect((completeLog?.metadata as any)?.backupId).toBe(createdBackupId);
    });

    it('preserves organization TIN decryption capability across backup and restore workflows', async () => {
      // Verify AES-256-GCM encryption key remains identical and functional
      const sampleTin = '74-9876543';
      const encryptedTin = encrypt(sampleTin);
      expect(encryptedTin).toBeInstanceOf(Buffer);

      const decrypted = decrypt(encryptedTin);
      expect(decrypted).toBe(sampleTin);

      // Verify existing organization records in PostgreSQL
      const org = await prisma.organization.findFirst({
        where: { taxIdEncrypted: { not: null } },
      });

      if (org && org.taxIdEncrypted) {
        const orgTin = decrypt(Buffer.from(org.taxIdEncrypted));
        expect(orgTin).toMatch(/^\d{2}-\d{7}$/);
      }
    });
  });
});

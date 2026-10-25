import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/lib/db/prisma';
import { UserRole } from '@prisma/client';
import { hasPermission } from '../src/lib/auth/rbac';
import { createSessionToken } from '../src/lib/auth/jwt';
import {
  getMockSentEmails,
  clearMockSentEmails,
} from '../src/lib/email/email-service';
import {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
  dispatchNotification,
} from '../src/lib/notifications/notification-service';
import {
  runCredentialExpirationScanner,
  runCaqhAttestationScanner,
  runEnrollmentRevalidationScanner,
  runOverdueTaskScanner,
  runMissingDocumentScanner,
  runDailyDigestGenerator,
  getUtcMidnight,
  getDaysBetween,
} from '../src/lib/automation/automation-service';
import { getAllQueueMetrics, retryFailedJobs } from '../src/lib/queue/job-manager';

// Route handlers for direct API testing
import { GET as getNotificationsRoute } from '../src/app/api/v1/notifications/route';
import { PATCH as markReadRoute } from '../src/app/api/v1/notifications/[id]/read/route';
import { POST as markAllReadRoute } from '../src/app/api/v1/notifications/mark-all-read/route';
import {
  GET as getPreferencesRoute,
  PUT as putPreferencesRoute,
} from '../src/app/api/v1/notifications/preferences/route';
import { GET as getAdminJobsRoute } from '../src/app/api/v1/admin/jobs/route';
import { POST as triggerAdminJobRoute } from '../src/app/api/v1/admin/jobs/trigger/route';
import { POST as retryAdminJobRoute } from '../src/app/api/v1/admin/jobs/retry/route';

describe('Phase 8: Background Automation, Schedulers & Notifications Module', () => {
  let adminUser: any;
  let specialistUser: any;
  let viewerUser: any;
  let testProvider: any;
  let testLicense: any;
  let testDea: any;
  let testBoard: any;
  let testMalpractice: any;
  let testCaqh: any;
  let testPayer: any;
  let testEnrollment: any;
  let testOverdueFollowUp: any;
  let testOverdueTask: any;

  beforeAll(async () => {
    // 1. Create synthetic users
    adminUser = await prisma.user.upsert({
      where: { email: 'phase8_admin@example.com' },
      update: {},
      create: {
        email: 'phase8_admin@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Alice',
        lastName: 'AdminPhase8',
        role: 'admin',
      },
    });

    specialistUser = await prisma.user.upsert({
      where: { email: 'phase8_specialist@example.com' },
      update: {},
      create: {
        email: 'phase8_specialist@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Bob',
        lastName: 'SpecialistPhase8',
        role: 'credentialing_specialist',
      },
    });

    viewerUser = await prisma.user.upsert({
      where: { email: 'phase8_viewer@example.com' },
      update: {},
      create: {
        email: 'phase8_viewer@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Valerie',
        lastName: 'ViewerPhase8',
        role: 'viewer',
      },
    });

    // 2. Create synthetic provider
    testProvider = await prisma.provider.upsert({
      where: { npiNumber: '9999999998' },
      update: {},
      create: {
        firstName: 'DrAutomation',
        lastName: 'Eight',
        npiNumber: '9999999998',
        npiType: 1,
        status: 'active',
        credentialingStatus: 'in_progress',
      },
    });

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // 3. Credentials with specific threshold boundaries
    // State license expiring in 25 days (triggers 30-day window)
    testLicense = await prisma.stateLicense.create({
      data: {
        providerId: testProvider.id,
        state: 'TX',
        licenseNumber: 'TX-AUTO-888',
        status: 'active',
        expirationDate: new Date(now + 25 * dayMs),
      },
    });

    // DEA expiring in 10 days (triggers 14-day urgent window)
    testDea = await prisma.deaRegistration.create({
      data: {
        providerId: testProvider.id,
        state: 'TX',
        deaNumber: 'AB8888888',
        status: 'active',
        expirationDate: new Date(now + 10 * dayMs),
      },
    });

    // Board Certification expired 5 days ago (triggers expired state)
    testBoard = await prisma.boardCertification.create({
      data: {
        providerId: testProvider.id,
        boardName: 'American Board of Internal Medicine',
        specialty: 'Internal Medicine',
        certificationNumber: 'BC-AUTO-123',
        status: 'active',
        expirationDate: new Date(now - 5 * dayMs),
      },
    });

    // Malpractice insurance expiring in 70 days (triggers 90-day window)
    testMalpractice = await prisma.malpracticeInsurance.create({
      data: {
        providerId: testProvider.id,
        carrierName: 'ProAssurance Test',
        policyNumber: 'POL-AUTO-888',
        status: 'active',
        expirationDate: new Date(now + 70 * dayMs),
        coverageType: 'claims_made',
      },
    });

    // 4. CAQH profile due in 15 days (120-day cycle reminder window)
    testCaqh = await prisma.caqhProfile.create({
      data: {
        providerId: testProvider.id,
        caqhId: 'CAQH-888888',
        attestationStatus: 'attested',
        lastAttestationDate: new Date(now - 105 * dayMs),
        nextAttestationDate: new Date(now + 15 * dayMs),
      },
    });

    // 5. Payer & Enrollments
    testPayer = await prisma.payer.create({
      data: {
        name: 'Aetna Automation Test',
        shortName: 'AET-AUTO',
        payerType: 'commercial',
      },
    });

    // Enrollment due for revalidation in 40 days (triggers 60-day window)
    testEnrollment = await prisma.payerEnrollment.create({
      data: {
        providerId: testProvider.id,
        payerId: testPayer.id,
        enrollmentType: 'individual',
        status: 'approved',
        effectiveDate: new Date(now - 365 * dayMs),
        revalidationDate: new Date(now + 40 * dayMs),
        assignedToId: specialistUser.id,
      },
    });

    // Enrollment with overdue follow-up date (3 days ago)
    testOverdueFollowUp = await prisma.payerEnrollment.create({
      data: {
        providerId: testProvider.id,
        payerId: testPayer.id,
        enrollmentType: 'individual',
        status: 'submitted',
        submittedDate: new Date(now - 20 * dayMs),
        followUpDate: new Date(now - 3 * dayMs),
        assignedToId: specialistUser.id,
      },
    });

    // 6. Overdue Task assigned to specialist (due 2 days ago)
    testOverdueTask = await prisma.task.create({
      data: {
        title: 'Overdue Verification for DrAutomation',
        taskType: 'verification',
        priority: 'high',
        status: 'pending',
        dueDate: new Date(now - 2 * dayMs),
        assignedToId: specialistUser.id,
        providerId: testProvider.id,
      },
    });
  });

  afterAll(async () => {
    // Clean up all synthetic records created in test
    try {
      if (testOverdueTask) await prisma.task.deleteMany({ where: { id: testOverdueTask.id } });
      await prisma.task.deleteMany({ where: { providerId: testProvider?.id } });
      await prisma.notification.deleteMany({
        where: {
          userId: { in: [adminUser?.id, specialistUser?.id, viewerUser?.id].filter(Boolean) },
        },
      });
      await prisma.notificationPreference.deleteMany({
        where: {
          userId: { in: [adminUser?.id, specialistUser?.id, viewerUser?.id].filter(Boolean) },
        },
      });
      if (testEnrollment) await prisma.payerEnrollment.deleteMany({ where: { id: testEnrollment.id } });
      if (testOverdueFollowUp) await prisma.payerEnrollment.deleteMany({ where: { id: testOverdueFollowUp.id } });
      if (testPayer) await prisma.payer.deleteMany({ where: { id: testPayer.id } });
      if (testCaqh) await prisma.caqhProfile.deleteMany({ where: { id: testCaqh.id } });
      if (testLicense) await prisma.stateLicense.deleteMany({ where: { id: testLicense.id } });
      if (testDea) await prisma.deaRegistration.deleteMany({ where: { id: testDea.id } });
      if (testBoard) await prisma.boardCertification.deleteMany({ where: { id: testBoard.id } });
      if (testMalpractice) await prisma.malpracticeInsurance.deleteMany({ where: { id: testMalpractice.id } });
      if (testProvider) await prisma.provider.deleteMany({ where: { id: testProvider.id } });
    } catch (err) {
      console.warn('Cleanup error in Phase 8 tests:', err);
    }
  });

  beforeEach(() => {
    clearMockSentEmails();
  });

  describe('1. Date Utility Helpers', () => {
    it('calculates UTC midnight accurately regardless of local timezone', () => {
      const d = new Date('2026-10-22T14:35:50.123Z');
      const midnight = getUtcMidnight(d);
      expect(midnight.getUTCHours()).toBe(0);
      expect(midnight.getUTCMinutes()).toBe(0);
      expect(midnight.getUTCSeconds()).toBe(0);
      expect(midnight.getUTCMilliseconds()).toBe(0);
      expect(midnight.toISOString()).toBe('2026-10-22T00:00:00.000Z');
    });

    it('calculates calendar days between dates correctly', () => {
      const base = new Date('2026-10-01T00:00:00.000Z');
      const target = new Date('2026-10-15T00:00:00.000Z');
      expect(getDaysBetween(target, base)).toBe(14);
      expect(getDaysBetween(base, target)).toBe(-14);
    });
  });

  describe('2. Credential Expiration Scanner', () => {
    it('scans expiring & expired credentials and updates status appropriately', async () => {
      const result = await runCredentialExpirationScanner();

      expect(result.scannedCount).toBeGreaterThanOrEqual(4);
      expect(result.expiringCount).toBeGreaterThanOrEqual(3); // license (25d), DEA (10d), malpractice (70d)
      expect(result.expiredCount).toBeGreaterThanOrEqual(1); // board (-5d)
      expect(result.tasksCreated).toBeGreaterThanOrEqual(4);
      expect(result.notificationsSent).toBeGreaterThanOrEqual(4);

      // Verify status transitions in DB
      const updatedLicense = await prisma.stateLicense.findUnique({ where: { id: testLicense.id } });
      expect(updatedLicense?.status).toBe('expiring_soon');

      const updatedDea = await prisma.deaRegistration.findUnique({ where: { id: testDea.id } });
      expect(updatedDea?.status).toBe('expiring_soon');

      const updatedBoard = await prisma.boardCertification.findUnique({ where: { id: testBoard.id } });
      expect(updatedBoard?.status).toBe('expired');

      // Verify task creation with appropriate priorities
      const deaTask = await prisma.task.findFirst({
        where: { entityType: 'dea_registration', entityId: testDea.id },
      });
      expect(deaTask).toBeDefined();
      expect(deaTask?.priority).toBe('urgent'); // <= 14 days

      const boardTask = await prisma.task.findFirst({
        where: { entityType: 'board_certification', entityId: testBoard.id },
      });
      expect(boardTask).toBeDefined();
      expect(boardTask?.priority).toBe('urgent'); // expired

      // Verify email notifications were intercepted by mock email transport
      const sentEmails = getMockSentEmails();
      expect(sentEmails.length).toBeGreaterThanOrEqual(1);
      expect(sentEmails.some((e) => e.subject.includes('Expiration Alert'))).toBe(true);
    });

    it('is strictly idempotent on second consecutive execution (0 duplicate tasks, 0 duplicate notifications)', async () => {
      const secondRun = await runCredentialExpirationScanner();

      // Because tasks and notifications already exist for today, both must be 0
      expect(secondRun.tasksCreated).toBe(0);
      expect(secondRun.notificationsSent).toBe(0);
    });
  });

  describe('3. CAQH 120-Day Cycle Attestation Scanner', () => {
    it('detects upcoming attestation deadlines within 30 days and creates task + notification', async () => {
      const result = await runCaqhAttestationScanner();

      expect(result.scannedCount).toBeGreaterThanOrEqual(1);
      expect(result.dueCount).toBeGreaterThanOrEqual(1);
      expect(result.tasksCreated).toBeGreaterThanOrEqual(1);
      expect(result.notificationsSent).toBeGreaterThanOrEqual(1);

      const caqhTask = await prisma.task.findFirst({
        where: { entityType: 'caqh_profile', entityId: testCaqh.id },
      });
      expect(caqhTask).toBeDefined();
      expect(caqhTask?.title).toContain('CAQH Attestation Due');
      expect(caqhTask?.description).toContain('120-day cycle compliance');
    });

    it('is strictly idempotent on repeat execution', async () => {
      const repeatRun = await runCaqhAttestationScanner();
      expect(repeatRun.tasksCreated).toBe(0);
      expect(repeatRun.notificationsSent).toBe(0);
    });
  });

  describe('4. Payer Enrollment Revalidation & Overdue Follow-up Scanner', () => {
    it('scans revalidations due within 90 days and flags overdue follow-ups', async () => {
      const result = await runEnrollmentRevalidationScanner();

      expect(result.revalidationsScanned).toBeGreaterThanOrEqual(1);
      expect(result.revalidationsDue).toBeGreaterThanOrEqual(1);
      expect(result.followUpsOverdue).toBeGreaterThanOrEqual(1);
      expect(result.tasksCreated).toBeGreaterThanOrEqual(1); // Revalidation task
      expect(result.notificationsSent).toBeGreaterThanOrEqual(2); // Revalidation + overdue follow-up

      // Verify revalidation task created
      const revalTask = await prisma.task.findFirst({
        where: { entityType: 'payer_enrollment', entityId: testEnrollment.id },
      });
      expect(revalTask).toBeDefined();
      expect(revalTask?.title).toContain('Revalidation Due');

      // Verify notifications exist for specialist
      const specialistNotifications = await prisma.notification.findMany({
        where: { userId: specialistUser.id },
      });
      expect(
        specialistNotifications.some((n) => n.type === 'enrollment_follow_up_due')
      ).toBe(true);
      expect(
        specialistNotifications.some((n) => n.type === 'enrollment_status_change')
      ).toBe(true);
    });

    it('is strictly idempotent on repeat execution', async () => {
      const repeatRun = await runEnrollmentRevalidationScanner();
      expect(repeatRun.tasksCreated).toBe(0);
      expect(repeatRun.notificationsSent).toBe(0);
    });
  });

  describe('5. Overdue Task Scanner', () => {
    it('finds overdue open tasks and sends notification alerts to assignee', async () => {
      const result = await runOverdueTaskScanner();

      expect(result.overdueFound).toBeGreaterThanOrEqual(1);
      expect(result.notificationsSent).toBeGreaterThanOrEqual(1);

      const taskNotif = await prisma.notification.findFirst({
        where: {
          userId: specialistUser.id,
          entityType: 'task',
          entityId: testOverdueTask.id,
        },
      });
      expect(taskNotif).toBeDefined();
      expect(taskNotif?.type).toBe('task_due');
      expect(taskNotif?.title).toContain('Overdue Task');
    });

    it('is strictly idempotent on repeat execution within same day', async () => {
      const repeatRun = await runOverdueTaskScanner();
      expect(repeatRun.notificationsSent).toBe(0);
    });
  });

  describe('6. Missing Compliance Document Scanner', () => {
    it('identifies active providers with active licenses but no uploaded license document', async () => {
      const result = await runMissingDocumentScanner();

      expect(result.providersChecked).toBeGreaterThanOrEqual(1);
      expect(result.missingDocAlerts).toBeGreaterThanOrEqual(1);

      const missingNotif = await prisma.notification.findFirst({
        where: {
          entityType: 'provider',
          entityId: testProvider.id,
          type: 'missing_document',
        },
      });
      expect(missingNotif).toBeDefined();
      expect(missingNotif?.title).toContain('Missing Document: Medical License');
    });

    it('is strictly idempotent on repeat execution within same day', async () => {
      const repeatRun = await runMissingDocumentScanner();
      expect(repeatRun.missingDocAlerts).toBe(0);
    });
  });

  describe('7. Daily Digest Generator & Email Service', () => {
    it('compiles operational summary and dispatches daily digest email to specialists and admins', async () => {
      clearMockSentEmails();
      const result = await runDailyDigestGenerator();

      expect(result.digestsSent).toBeGreaterThanOrEqual(1);

      const sentEmails = getMockSentEmails();
      const aliceDigest = sentEmails.find((e) => e.to === adminUser.email);
      expect(aliceDigest).toBeDefined();
      expect(aliceDigest?.subject).toContain('Daily Credentialing Digest');
      expect(aliceDigest?.html).toContain('Daily Operational Digest');
      expect(aliceDigest?.html).toContain(`Hello ${adminUser.firstName} ${adminUser.lastName}`);
    });

    it('respects user preferences and skips digest when dailyDigest is disabled', async () => {
      // Opt out specialist from daily digest
      await updateUserNotificationPreferences(specialistUser.id, { dailyDigest: false });

      clearMockSentEmails();
      await runDailyDigestGenerator();

      const sentEmails = getMockSentEmails();
      const specialistDigest = sentEmails.find((e) => e.to === specialistUser.email);
      expect(specialistDigest).toBeUndefined();

      // Restore preference
      await updateUserNotificationPreferences(specialistUser.id, { dailyDigest: true });
    });
  });

  describe('8. User Notification Service & Preferences', () => {
    it('returns default preferences if none exist yet for a user', async () => {
      const prefs = await getUserNotificationPreferences(viewerUser.id);
      expect(prefs.emailEnabled).toBe(true);
      expect(prefs.expirationAlerts).toBe(true);
      expect(prefs.revalidationAlerts).toBe(true);
      expect(prefs.taskAlerts).toBe(true);
      expect(prefs.missingDocAlerts).toBe(true);
      expect(prefs.dailyDigest).toBe(true);
    });

    it('persists customized notification preferences', async () => {
      const updated = await updateUserNotificationPreferences(viewerUser.id, {
        emailEnabled: false,
        revalidationAlerts: false,
      });

      expect(updated.emailEnabled).toBe(false);
      expect(updated.revalidationAlerts).toBe(false);
      expect(updated.expirationAlerts).toBe(true); // preserved

      const fetched = await getUserNotificationPreferences(viewerUser.id);
      expect(fetched.emailEnabled).toBe(false);
      expect(fetched.revalidationAlerts).toBe(false);
    });

    it('suppresses outbound email when user preference emailEnabled is false', async () => {
      clearMockSentEmails();

      await dispatchNotification({
        userId: viewerUser.id,
        type: 'system_alert',
        title: 'System Notice',
        message: 'This should create an in-app notification but NOT send an email.',
      });

      const sentEmails = getMockSentEmails();
      expect(sentEmails.some((e) => e.to === viewerUser.email)).toBe(false);

      // Verify in-app notification was still created
      const notifs = await getUserNotifications({ userId: viewerUser.id });
      expect(notifs.items.some((n) => n.title === 'System Notice')).toBe(true);
    });

    it('marks individual notification as read with timestamp', async () => {
      const notifs = await getUserNotifications({ userId: viewerUser.id });
      const target = notifs.items.find((n) => !n.isRead);
      expect(target).toBeDefined();

      const marked = await markNotificationAsRead(target!.id, viewerUser.id);
      expect(marked).not.toBeNull();
      expect(marked?.isRead).toBe(true);
      expect(marked?.readAt).toBeDefined();
    });

    it('marks all unread notifications as read in bulk', async () => {
      // Create two unread notifications for viewer
      await dispatchNotification({
        userId: viewerUser.id,
        type: 'system_alert',
        title: 'Bulk Test 1',
        message: 'Message 1',
      });
      await dispatchNotification({
        userId: viewerUser.id,
        type: 'system_alert',
        title: 'Bulk Test 2',
        message: 'Message 2',
      });

      const bulkResult = await markAllNotificationsAsRead(viewerUser.id);
      expect(bulkResult.updatedCount).toBeGreaterThanOrEqual(2);

      const after = await getUserNotifications({ userId: viewerUser.id, unreadOnly: true });
      expect(after.unreadCount).toBe(0);
      expect(after.items.length).toBe(0);
    });
  });

  describe('9. In-App Notification Center API Routes', () => {
    let viewerToken: string;

    beforeAll(async () => {
      await prisma.userSession.upsert({
        where: { sessionToken: 'sess-phase8-viewer-api' },
        update: { expiresAt: new Date(Date.now() + 86400000) },
        create: { userId: viewerUser.id, sessionToken: 'sess-phase8-viewer-api', expiresAt: new Date(Date.now() + 86400000) },
      });
      viewerToken = await createSessionToken({
        userId: viewerUser.id,
        email: viewerUser.email,
        role: UserRole.viewer,
        sessionId: 'sess-phase8-viewer-api',
      });
    });

    it('GET /api/v1/notifications returns paginated notifications and unreadCount (200 OK)', async () => {
      const req = new Request('http://localhost/api/v1/notifications?page=1&limit=10', {
        headers: { cookie: `session_token=${viewerToken}` },
      });

      const res = await getNotificationsRoute(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBe(1);
      expect(typeof body.unreadCount).toBe('number');
    });

    it('PATCH /api/v1/notifications/[id]/read marks a notification as read (200 OK)', async () => {
      // Create fresh unread notification for viewer
      const notif = await dispatchNotification({
        userId: viewerUser.id,
        type: 'system_alert',
        title: 'API Read Test',
        message: 'Test read status via API route',
      });

      const req = new Request(`http://localhost/api/v1/notifications/${notif.id}/read`, {
        method: 'PATCH',
        headers: { cookie: `session_token=${viewerToken}` },
      });

      const res = await markReadRoute(req as any, { params: { id: notif.id } });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.notification.isRead).toBe(true);
    });

    it('POST /api/v1/notifications/mark-all-read marks all user notifications read (200 OK)', async () => {
      const req = new Request('http://localhost/api/v1/notifications/mark-all-read', {
        method: 'POST',
        headers: { cookie: `session_token=${viewerToken}` },
      });

      const res = await markAllReadRoute(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(typeof body.updatedCount).toBe('number');
    });

    it('GET /api/v1/notifications/preferences retrieves current preferences (200 OK)', async () => {
      const req = new Request('http://localhost/api/v1/notifications/preferences', {
        headers: { cookie: `session_token=${viewerToken}` },
      });

      const res = await getPreferencesRoute(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.preferences).toBeDefined();
      expect(body.preferences.userId).toBe(viewerUser.id);
    });

    it('PUT /api/v1/notifications/preferences updates user preferences (200 OK)', async () => {
      const req = new Request('http://localhost/api/v1/notifications/preferences', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          cookie: `session_token=${viewerToken}`,
        },
        body: JSON.stringify({
          emailEnabled: true,
          expirationAlerts: false,
          revalidationAlerts: true,
        }),
      });

      const res = await putPreferencesRoute(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.preferences.expirationAlerts).toBe(false);
      expect(body.preferences.emailEnabled).toBe(true);
    });
  });

  describe('10. Background Job Management, RBAC & Immutable Audit Logging', () => {
    let adminToken: string;
    let viewerToken: string;

    beforeAll(async () => {
      await prisma.userSession.upsert({
        where: { sessionToken: 'sess-phase8-admin-jobs' },
        update: { expiresAt: new Date(Date.now() + 86400000) },
        create: { userId: adminUser.id, sessionToken: 'sess-phase8-admin-jobs', expiresAt: new Date(Date.now() + 86400000) },
      });
      adminToken = await createSessionToken({
        userId: adminUser.id,
        email: adminUser.email,
        role: UserRole.admin,
        sessionId: 'sess-phase8-admin-jobs',
      });

      await prisma.userSession.upsert({
        where: { sessionToken: 'sess-phase8-viewer-jobs' },
        update: { expiresAt: new Date(Date.now() + 86400000) },
        create: { userId: viewerUser.id, sessionToken: 'sess-phase8-viewer-jobs', expiresAt: new Date(Date.now() + 86400000) },
      });
      viewerToken = await createSessionToken({
        userId: viewerUser.id,
        email: viewerUser.email,
        role: UserRole.viewer,
        sessionId: 'sess-phase8-viewer-jobs',
      });
    });

    it('validates RBAC: jobs:manage permission is granted to admin and super_admin, denied to viewer and specialist', () => {
      expect(hasPermission(UserRole.super_admin, 'jobs:manage')).toBe(true);
      expect(hasPermission(UserRole.admin, 'jobs:manage')).toBe(true);
      expect(hasPermission(UserRole.credentialing_specialist, 'jobs:manage')).toBe(false);
      expect(hasPermission(UserRole.enrollment_specialist, 'jobs:manage')).toBe(false);
      expect(hasPermission(UserRole.viewer, 'jobs:manage')).toBe(false);
    });

    it('rejects viewer from accessing GET /api/v1/admin/jobs (403 Forbidden)', async () => {
      const req = new Request('http://localhost/api/v1/admin/jobs', {
        headers: { cookie: `session_token=${viewerToken}` },
      });

      const res = await getAdminJobsRoute(req as any);
      expect(res.status).toBe(403);
    });

    it('allows admin to query GET /api/v1/admin/jobs and returns queue telemetry (200 OK)', async () => {
      const req = new Request('http://localhost/api/v1/admin/jobs', {
        headers: { cookie: `session_token=${adminToken}` },
      });

      const res = await getAdminJobsRoute(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.timestamp).toBeDefined();
      expect(Array.isArray(body.queues)).toBe(true);
      expect(body.queues.length).toBe(5); // expiration-scanner, enrollment-scanner, task-operations, document-scanner, email-dispatch
      expect(body.failedJobs).toBeDefined();
    });

    it('rejects viewer from triggering jobs via POST /api/v1/admin/jobs/trigger (403 Forbidden)', async () => {
      const req = new Request('http://localhost/api/v1/admin/jobs/trigger', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `session_token=${viewerToken}`,
        },
        body: JSON.stringify({ jobType: 'overdue_tasks' }),
      });

      const res = await triggerAdminJobRoute(req as any);
      expect(res.status).toBe(403);
    });

    it('allows admin to trigger scanner via POST /api/v1/admin/jobs/trigger and creates immutable audit log (200 OK)', async () => {
      const req = new Request('http://localhost/api/v1/admin/jobs/trigger', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `session_token=${adminToken}`,
        },
        body: JSON.stringify({ jobType: 'overdue_tasks' }),
      });

      const res = await triggerAdminJobRoute(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.jobType).toBe('overdue_tasks');
      expect(body.result).toBeDefined();

      // Verify immutable audit log was created
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          action: 'JOB_TRIGGERED',
          userId: adminUser.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).toBeDefined();
      expect(auditLog?.entityType).toBe('background_job');
      expect(auditLog?.action).toBe('JOB_TRIGGERED');
      expect((auditLog?.metadata as any)?.jobType).toBe('overdue_tasks');
    });

    it('allows admin to invoke retry of failed queue jobs via POST /api/v1/admin/jobs/retry and logs audit trail', async () => {
      const req = new Request('http://localhost/api/v1/admin/jobs/retry', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `session_token=${adminToken}`,
        },
        body: JSON.stringify({ queueName: 'expiration-scanner' }),
      });

      const res = await retryAdminJobRoute(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.queueName).toBe('expiration-scanner');
      expect(typeof body.retriedCount).toBe('number');

      // Verify immutable audit log
      const retryLog = await prisma.auditLog.findFirst({
        where: {
          action: 'FAILED_JOBS_RETRIED',
          userId: adminUser.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(retryLog).toBeDefined();
      expect(retryLog?.entityType).toBe('background_job');
      expect((retryLog?.metadata as any)?.queueName).toBe('expiration-scanner');
    });
  });
});

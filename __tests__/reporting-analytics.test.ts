import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db/prisma';
import { ReportService } from '../src/lib/reports/report-service';
import { createDocumentWithVersion } from '../src/lib/documents/document-service';
import { hasPermission } from '../src/lib/auth/rbac';
import { createSessionToken } from '../src/lib/auth/jwt';
import { GET as getWorkloadRoute } from '../src/app/api/v1/reports/workload/route';
import { GET as getExportRoute } from '../src/app/api/v1/reports/export/route';
import { UserRole } from '@prisma/client';

describe('Phase 7: Reporting, Analytics & Dashboards Module', () => {
  let adminUser: any;
  let specialistUser: any;
  let viewerUser: any;
  let testProvider: any;
  let testLicense: any;
  let testDea: any;
  let testPayer: any;
  let testEnrollment: any;
  let testDoc: any;
  let testTask: any;

  beforeAll(async () => {
    // 1. Create admin user
    adminUser = await prisma.user.upsert({
      where: { email: 'phase7_admin@example.com' },
      update: {},
      create: {
        email: 'phase7_admin@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Alice',
        lastName: 'AdminReport',
        role: 'admin',
      },
    });

    // 2. Create specialist user
    specialistUser = await prisma.user.upsert({
      where: { email: 'phase7_specialist@example.com' },
      update: {},
      create: {
        email: 'phase7_specialist@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Bob',
        lastName: 'SpecWorkload',
        role: 'credentialing_specialist',
      },
    });

    // 3. Create viewer user
    viewerUser = await prisma.user.upsert({
      where: { email: 'phase7_viewer@example.com' },
      update: {},
      create: {
        email: 'phase7_viewer@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Valerie',
        lastName: 'Viewer',
        role: 'viewer',
      },
    });

    // 4. Create synthetic provider
    testProvider = await prisma.provider.upsert({
      where: { npiNumber: '9999999997' },
      update: {},
      create: {
        firstName: 'DrAnalytics',
        lastName: 'Seven',
        npiNumber: '9999999997',
        npiType: 1,
        status: 'active',
        credentialingStatus: 'in_progress',
      },
    });

    // 5. Create synthetic credentials (one expiring in 20 days, one active)
    const in20Days = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    testLicense = await prisma.stateLicense.create({
      data: {
        providerId: testProvider.id,
        state: 'FL',
        licenseNumber: 'FL-RPT-777',
        status: 'active',
        expirationDate: in20Days,
      },
    });

    testDea = await prisma.deaRegistration.create({
      data: {
        providerId: testProvider.id,
        state: 'FL',
        deaNumber: 'AB7777777',
        status: 'active',
        expirationDate: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000),
      },
    });

    // 6. Create synthetic payer & enrollment (submitted 45 days ago)
    testPayer = await prisma.payer.create({
      data: {
        name: 'Blue Cross Analytics Plan',
        shortName: 'BCAP',
        payerType: 'commercial',
      },
    });

    const submitted45DaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    testEnrollment = await prisma.payerEnrollment.create({
      data: {
        providerId: testProvider.id,
        payerId: testPayer.id,
        enrollmentType: 'individual',
        status: 'submitted',
        submittedDate: submitted45DaysAgo,
        followUpDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // overdue follow up
      },
    });

    // 7. Create synthetic document
    const dummyPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\ntrailer\n<<\n>>\n%%EOF');
    testDoc = await createDocumentWithVersion({
      entityType: 'provider',
      entityId: testProvider.id,
      providerId: testProvider.id,
      title: 'Board Certification Copy',
      documentType: 'board_certificate',
      fileBuffer: dummyPdfBuffer,
      fileName: 'board_cert.pdf',
      mimeType: 'application/pdf',
      uploadedById: adminUser.id,
    });

    // 8. Create synthetic overdue urgent task assigned to Bob
    testTask = await prisma.task.create({
      data: {
        title: 'Urgent PSV Followup for DrAnalytics',
        taskType: 'verification',
        priority: 'urgent',
        status: 'pending',
        dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // overdue
        assignedToId: specialistUser.id,
        providerId: testProvider.id,
      },
    });
  });

  afterAll(async () => {
    // Cleanup synthetic test records
    if (testTask) await prisma.task.deleteMany({ where: { id: testTask.id } });
    if (testDoc) await prisma.document.deleteMany({ where: { id: testDoc.id } });
    if (testEnrollment) await prisma.payerEnrollment.deleteMany({ where: { id: testEnrollment.id } });
    if (testPayer) await prisma.payer.deleteMany({ where: { id: testPayer.id } });
    if (testLicense) await prisma.stateLicense.deleteMany({ where: { id: testLicense.id } });
    if (testDea) await prisma.deaRegistration.deleteMany({ where: { id: testDea.id } });
    if (testProvider) await prisma.provider.deleteMany({ where: { id: testProvider.id } });
  });

  describe('1. Executive Dashboard Aggregated Metrics', () => {
    it('calculates real database-backed metrics for providers, credentials, enrollments, documents, and tasks', async () => {
      const data = await ReportService.getExecutiveDashboard({ timeRange: 'all_time' });

      expect(data.providers.total).toBeGreaterThanOrEqual(1);
      expect(data.providers.active).toBeGreaterThanOrEqual(1);

      expect(data.credentials.total).toBeGreaterThanOrEqual(2);
      expect(data.credentials.active).toBeGreaterThanOrEqual(1);
      expect(data.credentials.expiringSoon).toBeGreaterThanOrEqual(1); // our 20-day license

      expect(data.enrollments.total).toBeGreaterThanOrEqual(1);
      expect(data.enrollments.pending).toBeGreaterThanOrEqual(1);
      expect(data.enrollments.overdueFollowups).toBeGreaterThanOrEqual(1);

      expect(data.documents.total).toBeGreaterThanOrEqual(1);
      expect(data.documents.pendingReview).toBeGreaterThanOrEqual(1);

      expect(data.tasks.open).toBeGreaterThanOrEqual(1);
      expect(data.tasks.overdue).toBeGreaterThanOrEqual(1);
      expect(data.tasks.urgent).toBeGreaterThanOrEqual(1);
    });

    it('correctly handles time filtering windows', () => {
      const todayRange = ReportService.parseDateRange({ timeRange: 'today' });
      expect(todayRange.fromDate).toBeDefined();
      expect(todayRange.toDate).toBeDefined();

      const last30 = ReportService.parseDateRange({ timeRange: 'last_30_days' });
      expect(last30.fromDate!.getTime()).toBeLessThan(last30.toDate!.getTime());

      const custom = ReportService.parseDateRange({
        timeRange: 'custom',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      });
      expect(custom.fromDate?.toISOString().slice(0, 10)).toBe('2026-01-01');
      expect(custom.toDate?.toISOString().slice(0, 10)).toBe('2026-06-30');
    });

    it('rejects invalid custom date formats', () => {
      expect(() => {
        ReportService.parseDateRange({
          timeRange: 'custom',
          startDate: 'invalid-date-string',
        });
      }).toThrow('Invalid startDate format');
    });
  });

  describe('2. Operational Action Required / Attention Alerts', () => {
    it('generates prioritized actionable items from real database alerts', async () => {
      const items = await ReportService.getOperationalAttentionItems(10);

      expect(items.length).toBeGreaterThanOrEqual(1);

      // Verify structure and required properties
      for (const item of items) {
        expect(item.id).toBeDefined();
        expect(item.title).toBeDefined();
        expect(item.subtitle).toBeDefined();
        expect(['critical', 'high', 'medium']).toContain(item.urgency);
        expect(['credential', 'enrollment', 'document', 'task']).toContain(item.category);
        expect(item.drillDownUrl).toMatch(/^\/(credentials|enrollments|documents|tasks)/);
      }

      // Verify our overdue urgent task is captured
      const taskAlert = items.find((i) => i.id === testTask.id);
      expect(taskAlert).toBeDefined();
      expect(taskAlert?.urgency).toBe('critical');
      expect(taskAlert?.drillDownUrl).toContain('/tasks');
    });
  });

  describe('3. Credential Analytics', () => {
    it('aggregates credential statuses, types, states, and expiration windows', async () => {
      const analytics = await ReportService.getCredentialAnalytics();

      expect(analytics.total).toBeGreaterThanOrEqual(2);
      expect(analytics.typeBreakdown.stateLicenses).toBeGreaterThanOrEqual(1);
      expect(analytics.typeBreakdown.deaRegistrations).toBeGreaterThanOrEqual(1);

      // Expiration windows
      expect(analytics.expirationWindows.within30Days).toBeGreaterThanOrEqual(1);

      // Top states must include FL
      const flState = analytics.topStates.find((s) => s.state === 'FL');
      expect(flState).toBeDefined();
      expect(flState?.count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('4. Payer Enrollment Analytics & Aging', () => {
    it('aggregates status counts, individual vs group splits, and aging buckets', async () => {
      const analytics = await ReportService.getEnrollmentAnalytics();

      expect(analytics.total).toBeGreaterThanOrEqual(1);
      expect(analytics.statusCounts.submitted).toBeGreaterThanOrEqual(1);
      expect(analytics.individualCount).toBeGreaterThanOrEqual(1);

      // Aging analysis: our test enrollment is 45 days old, so it falls into days31to60
      expect(analytics.agingBuckets.days31to60).toBeGreaterThanOrEqual(1);
      expect(analytics.averageAgingDays).toBeGreaterThanOrEqual(1);

      // Top payers
      const payerEntry = analytics.topPayers.find((p) => p.name === 'Blue Cross Analytics Plan');
      expect(payerEntry).toBeDefined();
      expect(payerEntry?.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('5. Document Analytics', () => {
    it('aggregates document verification statuses, categories, and recent uploads', async () => {
      const analytics = await ReportService.getDocumentAnalytics();

      expect(analytics.total).toBeGreaterThanOrEqual(1);
      expect(analytics.statusCounts.pending_review).toBeGreaterThanOrEqual(1);
      expect(analytics.typeBreakdown.board_certificate).toBeGreaterThanOrEqual(1);
      expect(analytics.recentUploads.length).toBeGreaterThanOrEqual(1);

      const recent = analytics.recentUploads.find((d) => d.id === testDoc.id);
      expect(recent).toBeDefined();
      expect(recent?.documentType).toBe('board_certificate');
    });
  });

  describe('6. Staff Workload Distribution', () => {
    it('calculates open, overdue, and completed task distribution per staff member', async () => {
      const workload = await ReportService.getWorkloadAnalytics();

      expect(workload.totalTasks).toBeGreaterThanOrEqual(1);
      expect(workload.staffWorkload.length).toBeGreaterThanOrEqual(2);

      // Bob SpecWorkload should have at least 1 open, overdue, and urgent task
      const bob = workload.staffWorkload.find((s) => s.id === specialistUser.id);
      expect(bob).toBeDefined();
      expect(bob?.openTasks).toBeGreaterThanOrEqual(1);
      expect(bob?.overdueTasks).toBeGreaterThanOrEqual(1);
      expect(bob?.urgentTasks).toBeGreaterThanOrEqual(1);
    });
  });

  describe('7. Secure CSV Export', () => {
    it('exports credentials report as properly formatted CSV with header and data', async () => {
      const csv = await ReportService.exportReportCsv('credentials', {
        id: adminUser.id,
        email: adminUser.email,
      });

      expect(csv).toContain('"Type","Provider Name","NPI","Identifier","State/Specialty","Status","Expiration Date"');
      expect(csv).toContain('FL-RPT-777');
      expect(csv).toContain('AB7777777');

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'REPORT_EXPORTED', entityType: 'report' },
      });
      expect(audit).toBeDefined();
      expect(audit?.userId).toBe(adminUser.id);
    });

    it('exports enrollments report as CSV', async () => {
      const csv = await ReportService.exportReportCsv('enrollments', {
        id: adminUser.id,
        email: adminUser.email,
      });

      expect(csv).toContain('"Provider Name","NPI","Payer","Type","Status","Submitted Date","Follow-up Date","Assigned Staff"');
      expect(csv).toContain('Blue Cross Analytics Plan');
    });

    it('exports tasks report as CSV', async () => {
      const csv = await ReportService.exportReportCsv('tasks', {
        id: adminUser.id,
        email: adminUser.email,
      });

      expect(csv).toContain('"Task Title","Type","Priority","Status","Due Date","Assigned To","Provider"');
      expect(csv).toContain('Urgent PSV Followup for DrAnalytics');
    });

    it('exports documents report as CSV', async () => {
      const csv = await ReportService.exportReportCsv('documents', {
        id: adminUser.id,
        email: adminUser.email,
      });

      expect(csv).toContain('"Document Title","Category","Status","Expiration Date","Provider","Uploaded At"');
      expect(csv).toContain('Board Certification Copy');
    });

    it('exports audit logs as CSV', async () => {
      const csv = await ReportService.exportReportCsv('audit', {
        id: adminUser.id,
        email: adminUser.email,
      });

      expect(csv).toContain('"Timestamp","Actor Email","Action","Entity Type","Entity ID"');
    });

    it('rejects invalid reportType', async () => {
      await expect(
        ReportService.exportReportCsv('invalid_type' as any, {
          id: adminUser.id,
          email: adminUser.email,
        })
      ).rejects.toThrow('Invalid reportType specified');
    });
  });

  describe('8. RBAC and Export Security', () => {
    it('grants reports:read to super_admin, admin, specialist, and viewer', () => {
      expect(hasPermission(UserRole.super_admin, 'reports:read')).toBe(true);
      expect(hasPermission(UserRole.admin, 'reports:read')).toBe(true);
      expect(hasPermission(UserRole.credentialing_specialist, 'reports:read')).toBe(true);
      expect(hasPermission(UserRole.enrollment_specialist, 'reports:read')).toBe(true);
      expect(hasPermission(UserRole.viewer, 'reports:read')).toBe(true);
    });

    it('grants reports:export to super_admin, admin, and specialists, but DENIES viewer', () => {
      expect(hasPermission(UserRole.super_admin, 'reports:export')).toBe(true);
      expect(hasPermission(UserRole.admin, 'reports:export')).toBe(true);
      expect(hasPermission(UserRole.credentialing_specialist, 'reports:export')).toBe(true);
      expect(hasPermission(UserRole.enrollment_specialist, 'reports:export')).toBe(true);
      // Viewer CANNOT export bulk data dumps
      expect(hasPermission(UserRole.viewer, 'reports:export')).toBe(false);
    });

    it('rejects viewer from accessing workload endpoint via direct HTTP request (403 Forbidden)', async () => {
      const sessToken = crypto.randomUUID();
      await prisma.userSession.create({
        data: {
          userId: viewerUser.id,
          sessionToken: sessToken,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      const viewerToken = await createSessionToken({
        userId: viewerUser.id,
        email: viewerUser.email,
        role: UserRole.viewer,
        sessionId: sessToken,
      });

      const req = new Request('http://localhost/api/v1/reports/workload', {
        headers: { cookie: `session_token=${viewerToken}` },
      });

      const res = await getWorkloadRoute(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('FORBIDDEN');
    });

    it('rejects viewer from exporting CSV via direct HTTP request (403 Forbidden)', async () => {
      const sessToken = crypto.randomUUID();
      await prisma.userSession.create({
        data: {
          userId: viewerUser.id,
          sessionToken: sessToken,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      const viewerToken = await createSessionToken({
        userId: viewerUser.id,
        email: viewerUser.email,
        role: UserRole.viewer,
        sessionId: sessToken,
      });

      const req = new Request('http://localhost/api/v1/reports/export?type=credentials', {
        headers: { cookie: `session_token=${viewerToken}` },
      });

      const res = await getExportRoute(req);
      expect(res.status).toBe(403);
    });

    it('allows admin to export CSV via direct HTTP request (200 OK)', async () => {
      const sessToken = crypto.randomUUID();
      await prisma.userSession.create({
        data: {
          userId: adminUser.id,
          sessionToken: sessToken,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      const adminToken = await createSessionToken({
        userId: adminUser.id,
        email: adminUser.email,
        role: UserRole.admin,
        sessionId: sessToken,
      });

      const req = new Request('http://localhost/api/v1/reports/export?type=credentials', {
        headers: { cookie: `session_token=${adminToken}` },
      });

      const res = await getExportRoute(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      const csvText = await res.text();
      expect(csvText).toContain('Type');
      expect(csvText).toContain('FL-RPT-777');
    });
  });
});

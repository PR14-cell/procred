import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db/prisma';
import {
  calculateEnrollmentAging,
  evaluateFollowUpStatus,
  getEnrollments,
  transitionEnrollmentStatus,
  scanEnrollmentFollowUpsAndRevalidations,
} from '../src/lib/enrollments/enrollment-service';
import {
  createPayerSchema,
  updatePayerSchema,
  createEnrollmentSchema,
  transitionStatusSchema,
  createFollowUpSchema,
  updateMissingItemsSchema,
} from '../src/lib/validation/enrollment';
import { hasPermission } from '../src/lib/auth/rbac';

describe('Phase 4: Payer Enrollment Management Module', () => {
  let testUserId: string;
  let testViewerUserId: string;
  let testProviderId: string;
  let testLocationId: string;
  let testPayerId: string;
  let testSecondPayerId: string;
  const createdEnrollmentIds: string[] = [];

  beforeAll(async () => {
    // 1. Create or retrieve test specialist user
    const specialistUser = await prisma.user.upsert({
      where: { email: 'phase4_specialist@example.com' },
      update: {},
      create: {
        email: 'phase4_specialist@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Sarah',
        lastName: 'Specialist',
        role: 'enrollment_specialist',
      },
    });
    testUserId = specialistUser.id;

    // 2. Create viewer user
    const viewerUser = await prisma.user.upsert({
      where: { email: 'phase4_viewer@example.com' },
      update: {},
      create: {
        email: 'phase4_viewer@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Victor',
        lastName: 'Viewer',
        role: 'viewer',
      },
    });
    testViewerUserId = viewerUser.id;

    // Ensure any leftover provider with this test NPI is removed
    await prisma.provider.deleteMany({ where: { npiNumber: '9911223344' } });

    // 3. Create test provider with synthetic/fictional data
    const provider = await prisma.provider.create({
      data: {
        firstName: 'Marcus',
        lastName: 'Brody',
        suffix: 'DO',
        npiNumber: '9911223344',
        primaryTaxonomy: '207Q00000X',
        status: 'active',
      },
    });
    testProviderId = provider.id;

    // 4. Create test location
    const location = await prisma.location.create({
      data: {
        name: 'Apex Health Metro Center',
        address1: '100 Medical Plaza Blvd',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
      },
    });
    testLocationId = location.id;

    // 5. Create test payers
    const payer1 = await prisma.payer.create({
      data: {
        name: 'Blue Cross Blue Shield of Texas Synthetic',
        shortName: 'BCBSTX',
        payerType: 'commercial',
        state: 'TX',
        requiredDocumentTypes: ['W9', 'Malpractice Insurance', 'State License'],
        isActive: true,
      },
    });
    testPayerId = payer1.id;

    const payer2 = await prisma.payer.create({
      data: {
        name: 'Medicare Novitas Solutions Synthetic',
        shortName: 'Novitas',
        payerType: 'medicare',
        state: 'TX',
        requiredDocumentTypes: ['CMS 855I', 'EFT Authorization'],
        isActive: true,
      },
    });
    testSecondPayerId = payer2.id;
  });

  afterAll(async () => {
    // Cleanup created test records
    await prisma.enrollmentFollowUp.deleteMany({
      where: { enrollmentId: { in: createdEnrollmentIds } },
    });
    await prisma.enrollmentStatusHistory.deleteMany({
      where: { enrollmentId: { in: createdEnrollmentIds } },
    });
    await prisma.task.deleteMany({
      where: {
        entityId: { in: createdEnrollmentIds },
      },
    });
    await prisma.notification.deleteMany({
      where: { userId: { in: [testUserId, testViewerUserId] } },
    });
    await prisma.payerEnrollment.deleteMany({
      where: { id: { in: createdEnrollmentIds } },
    });
    const payerIdsToDelete = [testPayerId, testSecondPayerId].filter(Boolean);
    if (payerIdsToDelete.length > 0) {
      await prisma.payer.deleteMany({
        where: { id: { in: payerIdsToDelete } },
      });
    }
    if (testLocationId) {
      await prisma.location.delete({ where: { id: testLocationId } }).catch(() => {});
    }
    if (testProviderId) {
      await prisma.provider.delete({ where: { id: testProviderId } }).catch(() => {});
    }
  });

  // ==========================================
  // 1. Payer Directory & Validation
  // ==========================================
  describe('1. Payer Directory & Validation', () => {
    it('should validate payer schema and reject empty payer name', () => {
      const valid = createPayerSchema.safeParse({
        name: 'Aetna Health Synthetic',
        shortName: 'Aetna',
        payerType: 'commercial',
        state: 'TX',
        clearinghouseId: '60054',
        portalUrl: 'https://availity.example.com',
        standardTurnaroundDays: 45,
        requiredDocumentTypes: ['W9', 'Malpractice Insurance', 'State License'],
      });
      expect(valid.success).toBe(true);

      const invalid = createPayerSchema.safeParse({
        name: '',
        payerType: 'commercial',
      });
      expect(invalid.success).toBe(false);
    });

    it('should validate payer update schema', () => {
      const validUpdate = updatePayerSchema.safeParse({
        standardTurnaroundDays: 60,
        notes: 'Payer requires 855I form for revalidation.',
        isActive: false,
      });
      expect(validUpdate.success).toBe(true);
    });

    it('should support required documents checklist stored in payer record', async () => {
      const payer = await prisma.payer.findUnique({
        where: { id: testPayerId },
      });
      expect(payer).toBeDefined();
      expect(payer?.requiredDocumentTypes).toContain('W9');
      expect(payer?.requiredDocumentTypes).toContain('Malpractice Insurance');
      expect(payer?.requiredDocumentTypes.length).toBe(3);
    });
  });

  // ==========================================
  // 2. Individual vs Group Enrollment
  // ==========================================
  describe('2. Individual vs. Group Enrollment Distinction', () => {
    it('should successfully create an Individual Enrollment record', async () => {
      const parsed = createEnrollmentSchema.parse({
        providerId: testProviderId,
        payerId: testPayerId,
        locationId: testLocationId,
        enrollmentType: 'individual',
        status: 'submitted',
        trackingNumber: 'IND-TX-90112',
        submittedDate: '2026-09-01',
        assignedToId: testUserId,
      });

      const enr = await prisma.payerEnrollment.create({
        data: {
          providerId: parsed.providerId,
          payerId: parsed.payerId,
          locationId: parsed.locationId,
          enrollmentType: parsed.enrollmentType,
          status: parsed.status,
          trackingNumber: parsed.trackingNumber,
          submittedDate: new Date(parsed.submittedDate!),
          assignedToId: parsed.assignedToId,
        },
      });

      createdEnrollmentIds.push(enr.id);
      expect(enr.id).toBeDefined();
      expect(enr.enrollmentType).toBe('individual');
      expect(enr.groupNpi).toBeNull();
      expect(enr.groupNumber).toBeNull();
    });

    it('should successfully create a Group Enrollment record with group NPI and group number', async () => {
      const parsed = createEnrollmentSchema.parse({
        providerId: testProviderId,
        payerId: testPayerId,
        locationId: testLocationId,
        enrollmentType: 'group',
        groupNpi: '1992883774',
        groupNumber: 'GRP-TX-88210',
        status: 'pending',
        trackingNumber: 'GRP-TRACK-44321',
        submittedDate: '2026-08-15',
        assignedToId: testUserId,
      });

      const enr = await prisma.payerEnrollment.create({
        data: {
          providerId: parsed.providerId,
          payerId: parsed.payerId,
          locationId: parsed.locationId,
          enrollmentType: parsed.enrollmentType,
          groupNpi: parsed.groupNpi,
          groupNumber: parsed.groupNumber,
          status: parsed.status,
          trackingNumber: parsed.trackingNumber,
          submittedDate: new Date(parsed.submittedDate!),
          assignedToId: parsed.assignedToId,
        },
      });

      createdEnrollmentIds.push(enr.id);
      expect(enr.id).toBeDefined();
      expect(enr.enrollmentType).toBe('group');
      expect(enr.groupNpi).toBe('1992883774');
      expect(enr.groupNumber).toBe('GRP-TX-88210');
    });
  });

  // ==========================================
  // 3. Aging Calculations & Follow-up Status
  // ==========================================
  describe('3. Aging Calculations & Follow-up Status Evaluations', () => {
    it('should return null aging when submittedDate is not set', () => {
      expect(calculateEnrollmentAging(null)).toBeNull();
      expect(calculateEnrollmentAging(undefined)).toBeNull();
    });

    it('should accurately calculate aging days elapsed since submittedDate', () => {
      const today = new Date();
      // Date 45 days ago
      const fortyFiveDaysAgo = new Date(today.getTime() - 45 * 24 * 60 * 60 * 1000);
      const aging = calculateEnrollmentAging(fortyFiveDaysAgo);
      expect(aging).toBeGreaterThanOrEqual(44);
      expect(aging).toBeLessThanOrEqual(46);
    });

    it('should evaluate overdue follow-up dates correctly', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const status = evaluateFollowUpStatus(yesterday);
      expect(status.isOverdue).toBe(true);
      expect(status.isUpcoming).toBe(false);
      expect(status.daysDiff).toBeLessThan(0);
    });

    it('should evaluate upcoming follow-up dates correctly (within 7 days)', () => {
      const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const status = evaluateFollowUpStatus(inThreeDays);
      expect(status.isOverdue).toBe(false);
      expect(status.isUpcoming).toBe(true);
      expect(status.daysDiff).toBeGreaterThanOrEqual(2);
      expect(status.daysDiff).toBeLessThanOrEqual(4);
    });

    it('should evaluate distant follow-up dates correctly (more than 7 days)', () => {
      const inTwentyDays = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
      const status = evaluateFollowUpStatus(inTwentyDays);
      expect(status.isOverdue).toBe(false);
      expect(status.isUpcoming).toBe(false);
    });
  });

  // ==========================================
  // 4. Controlled Status Transitions & Audit History
  // ==========================================
  describe('4. Controlled Status Transitions & Audit History', () => {
    let testEnrollmentId: string;

    beforeAll(async () => {
      const enr = await prisma.payerEnrollment.create({
        data: {
          providerId: testProviderId,
          payerId: testSecondPayerId,
          locationId: testLocationId,
          enrollmentType: 'individual',
          status: 'preparing',
          assignedToId: testUserId,
        },
      });
      testEnrollmentId = enr.id;
      createdEnrollmentIds.push(enr.id);
    });

    it('should transition status from preparing to submitted and record history', async () => {
      const updated = await transitionEnrollmentStatus({
        enrollmentId: testEnrollmentId,
        newStatus: 'submitted',
        changedById: testUserId,
        userEmail: 'phase4_specialist@example.com',
        notes: 'Submitted via Novitas online portal with tracking number NOV-8891.',
      });

      expect(updated.status).toBe('submitted');

      // Verify history row
      const history = await prisma.enrollmentStatusHistory.findMany({
        where: { enrollmentId: testEnrollmentId },
        orderBy: { createdAt: 'desc' },
      });

      expect(history.length).toBe(1);
      expect(history[0].previousStatus).toBe('preparing');
      expect(history[0].newStatus).toBe('submitted');
      expect(history[0].changedById).toBe(testUserId);
      expect(history[0].notes).toContain('Submitted via Novitas online portal');
    });

    it('should transition to needs_info, dispatch notification, and record history', async () => {
      const updated = await transitionEnrollmentStatus({
        enrollmentId: testEnrollmentId,
        newStatus: 'needs_info',
        changedById: testUserId,
        userEmail: 'phase4_specialist@example.com',
        notes: 'Payer representative requested updated W9 form and proof of Texas malpractice coverage.',
      });

      expect(updated.status).toBe('needs_info');

      // Verify history row count incremented
      const history = await prisma.enrollmentStatusHistory.findMany({
        where: { enrollmentId: testEnrollmentId },
        orderBy: { createdAt: 'desc' },
      });
      expect(history.length).toBe(2);
      expect(history[0].previousStatus).toBe('submitted');
      expect(history[0].newStatus).toBe('needs_info');

      // Verify notification was dispatched to assignee
      const notifications = await prisma.notification.findMany({
        where: {
          userId: testUserId,
          entityId: testEnrollmentId,
        },
      });
      expect(notifications.length).toBeGreaterThan(0);
      expect(notifications[0].title).toContain('Needs Information');
    });

    it('should validate status transition schema rejection of invalid status', () => {
      const invalid = transitionStatusSchema.safeParse({
        status: 'invalid_status_code',
        notes: 'Test',
      });
      expect(invalid.success).toBe(false);

      const valid = transitionStatusSchema.safeParse({
        status: 'approved',
        notes: 'Application approved by payer committee.',
      });
      expect(valid.success).toBe(true);
    });
  });

  // ==========================================
  // 5. Missing Items Checklist
  // ==========================================
  describe('5. Missing Information Checklist Tracking', () => {
    let testEnrollmentId: string;

    beforeAll(async () => {
      const enr = await prisma.payerEnrollment.create({
        data: {
          providerId: testProviderId,
          payerId: testPayerId,
          locationId: testLocationId,
          enrollmentType: 'individual',
          status: 'needs_info',
          assignedToId: testUserId,
        },
      });
      testEnrollmentId = enr.id;
      createdEnrollmentIds.push(enr.id);
    });

    it('should add missing items and calculate open count', async () => {
      const initialItems = [
        {
          id: 'item-1',
          category: 'missing_signature' as const,
          description: 'Attestation Form Signature',
          isResolved: false,
        },
        {
          id: 'item-2',
          category: 'missing_document' as const,
          description: 'Updated COI with BCBSTX as Certificate Holder',
          isResolved: false,
        },
      ];

      const validation = updateMissingItemsSchema.safeParse({ missingItems: initialItems });
      expect(validation.success).toBe(true);

      await prisma.payerEnrollment.update({
        where: { id: testEnrollmentId },
        data: { missingItems: initialItems },
      });

      const res = await getEnrollments({ providerId: testProviderId });
      const found = res.items.find((i) => i.id === testEnrollmentId);
      expect(found).toBeDefined();
      expect(found?.openMissingCount).toBe(2);
    });

    it('should resolve one missing item and reflect updated open count', async () => {
      const resolvedItems = [
        {
          id: 'item-1',
          category: 'missing_signature' as const,
          description: 'Attestation Form Signature',
          isResolved: true,
          resolvedAt: new Date().toISOString(),
          notes: 'Signed electronically by Dr. Brody.',
        },
        {
          id: 'item-2',
          category: 'missing_document' as const,
          description: 'Updated COI with BCBSTX as Certificate Holder',
          isResolved: false,
        },
      ];

      await prisma.payerEnrollment.update({
        where: { id: testEnrollmentId },
        data: { missingItems: resolvedItems },
      });

      const res = await getEnrollments({ providerId: testProviderId });
      const found = res.items.find((i) => i.id === testEnrollmentId);
      expect(found).toBeDefined();
      expect(found?.openMissingCount).toBe(1);
    });
  });

  // ==========================================
  // 6. Follow-up Management
  // ==========================================
  describe('6. Structured Follow-up Logging & Updating Parent', () => {
    let testEnrollmentId: string;

    beforeAll(async () => {
      const enr = await prisma.payerEnrollment.create({
        data: {
          providerId: testProviderId,
          payerId: testPayerId,
          locationId: testLocationId,
          enrollmentType: 'individual',
          status: 'submitted',
          assignedToId: testUserId,
        },
      });
      testEnrollmentId = enr.id;
      createdEnrollmentIds.push(enr.id);
    });

    it('should validate follow-up log schema', () => {
      const valid = createFollowUpSchema.safeParse({
        followUpDate: '2026-10-22',
        contactMethod: 'phone',
        contactPerson: 'David at Credentialing Desk',
        notes: 'Application is with medical director for review. Should hear back in 10 business days.',
        referenceNumber: 'REF-CALL-9912',
        outcome: 'in_process',
        nextFollowUpDate: '2026-11-05',
      });
      expect(valid.success).toBe(true);

      const invalid = createFollowUpSchema.safeParse({
        followUpDate: '2026-10-22',
        contactMethod: 'carrier_pigeon', // Invalid method
        notes: 'Invalid',
      });
      expect(invalid.success).toBe(false);
    });

    it('should record follow-up log and update enrollment follow-up dates', async () => {
      const now = new Date();
      const nextDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

      const log = await prisma.enrollmentFollowUp.create({
        data: {
          enrollmentId: testEnrollmentId,
          createdById: testUserId,
          followUpDate: now,
          contactMethod: 'phone',
          contactPerson: 'Jessica Green (Novitas Rep)',
          notes: 'Spoke with rep. All primary source documents received. Review queue is 14 days.',
          referenceNumber: 'NOV-CALL-7721',
          outcome: 'in_process',
        },
      });

      expect(log.id).toBeDefined();

      // Update parent enrollment follow-up dates
      await prisma.payerEnrollment.update({
        where: { id: testEnrollmentId },
        data: {
          lastFollowUpDate: now,
          followUpDate: nextDate,
        },
      });

      const updated = await prisma.payerEnrollment.findUnique({
        where: { id: testEnrollmentId },
      });
      expect(updated?.lastFollowUpDate).toBeDefined();
      expect(updated?.followUpDate).toBeDefined();
    });
  });

  // ==========================================
  // 7. Background Scanner & Idempotent Task Creation
  // ==========================================
  describe('7. Idempotent Follow-up and Revalidation Scanner', () => {
    let overdueEnrId: string;
    let revalEnrId: string;

    beforeAll(async () => {
      // 1. Overdue follow-up enrollment
      const overdue = await prisma.payerEnrollment.create({
        data: {
          providerId: testProviderId,
          payerId: testPayerId,
          locationId: testLocationId,
          enrollmentType: 'individual',
          status: 'submitted',
          followUpDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
          assignedToId: testUserId,
        },
      });
      overdueEnrId = overdue.id;
      createdEnrollmentIds.push(overdue.id);

      // 2. Revalidation required enrollment
      const reval = await prisma.payerEnrollment.create({
        data: {
          providerId: testProviderId,
          payerId: testSecondPayerId,
          locationId: testLocationId,
          enrollmentType: 'individual',
          status: 'active',
          revalidationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
          assignedToId: testUserId,
        },
      });
      revalEnrId = reval.id;
      createdEnrollmentIds.push(reval.id);
    });

    it('should create tasks for overdue follow-ups and upcoming revalidations on first run', async () => {
      const scanResult1 = await scanEnrollmentFollowUpsAndRevalidations();
      expect(scanResult1.overdueFollowUpsScanned).toBeGreaterThanOrEqual(1);
      expect(scanResult1.revalidationsScanned).toBeGreaterThanOrEqual(1);
      expect(scanResult1.followUpTasksCreated).toBeGreaterThanOrEqual(1);
      expect(scanResult1.revalTasksCreated).toBeGreaterThanOrEqual(1);

      // Verify tasks exist in database
      const overdueTask = await prisma.task.findFirst({
        where: { entityId: overdueEnrId, entityType: 'payer_enrollment' },
      });
      expect(overdueTask).toBeDefined();
      expect(overdueTask?.title).toContain('Follow up with');

      const revalTask = await prisma.task.findFirst({
        where: { entityId: revalEnrId, entityType: 'payer_enrollment' },
      });
      expect(revalTask).toBeDefined();
      expect(revalTask?.title).toContain('Revalidation due for');
    });

    it('should be idempotent and not create duplicate tasks on second run', async () => {
      const scanResult2 = await scanEnrollmentFollowUpsAndRevalidations();
      // On rerun, 0 new tasks should be created for the existing enrollments
      expect(scanResult2.followUpTasksCreated).toBe(0);
      expect(scanResult2.revalTasksCreated).toBe(0);
    });
  });

  // ==========================================
  // 8. RBAC Authorization
  // ==========================================
  describe('8. Role-Based Access Control (RBAC)', () => {
    it('should grant enrollment specialist full read and write permissions for enrollments', () => {
      expect(hasPermission('enrollment_specialist', 'enrollments:read')).toBe(true);
      expect(hasPermission('enrollment_specialist', 'enrollments:write')).toBe(true);
      expect(hasPermission('enrollment_specialist', 'payers:read')).toBe(true);
      expect(hasPermission('enrollment_specialist', 'payers:write')).toBe(true);
    });

    it('should allow viewer read-only access and reject write operations', () => {
      expect(hasPermission('viewer', 'enrollments:read')).toBe(true);
      expect(hasPermission('viewer', 'enrollments:write')).toBe(false);
      expect(hasPermission('viewer', 'payers:read')).toBe(true);
      expect(hasPermission('viewer', 'payers:write')).toBe(false);
    });

    it('should grant super_admin and admin all enrollment permissions', () => {
      expect(hasPermission('super_admin', 'enrollments:read')).toBe(true);
      expect(hasPermission('super_admin', 'enrollments:write')).toBe(true);
      expect(hasPermission('admin', 'enrollments:read')).toBe(true);
      expect(hasPermission('admin', 'enrollments:write')).toBe(true);
    });
  });

  // ==========================================
  // 9. Dashboard Queries & Live Counts
  // ==========================================
  describe('9. Real Database Summary Queries for Dashboard', () => {
    it('should return live summary counts without hardcoding', async () => {
      const res = await getEnrollments();
      expect(res.summaryCounts).toBeDefined();
      expect(typeof res.summaryCounts.totalCount).toBe('number');
      expect(typeof res.summaryCounts.pendingCount).toBe('number');
      expect(typeof res.summaryCounts.needsInfoCount).toBe('number');
      expect(typeof res.summaryCounts.approvedCount).toBe('number');
      expect(typeof res.summaryCounts.activeCount).toBe('number');
      expect(typeof res.summaryCounts.overdueFollowUpsCount).toBe('number');
      expect(typeof res.summaryCounts.revalidationRequiredCount).toBe('number');
      expect(res.summaryCounts.totalCount).toBeGreaterThanOrEqual(createdEnrollmentIds.length);
    });
  });
});

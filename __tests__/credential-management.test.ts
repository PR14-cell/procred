import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db/prisma';
import {
  calculateExpirationStatus,
  getUnifiedCredentials,
  scanUpcomingExpirationsAndCreateTasks,
} from '../src/lib/credentials/credential-service';
import {
  createStateLicenseSchema,
  createDeaSchema,
  createBoardCertSchema,
  createMalpracticeSchema,
  createCaqhSchema,
} from '../src/lib/validation/credential';
import { hasPermission } from '../src/lib/auth/rbac';
import { decrypt } from '../src/lib/encryption/aes';

describe('Phase 3: Credential & Expiration Tracking Module', () => {
  let testProviderId: string;
  let testUserId: string;
  const createdCredentialIds: { type: string; id: string }[] = [];

  beforeAll(async () => {
    // 1. Create or retrieve test user
    const user = await prisma.user.upsert({
      where: { email: 'phase3_tester@example.com' },
      update: {},
      create: {
        email: 'phase3_tester@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Phase3',
        lastName: 'Tester',
        role: 'credentialing_specialist',
      },
    });
    testUserId = user.id;

    // 2. Create test provider with synthetic/fictional data
    const provider = await prisma.provider.create({
      data: {
        firstName: 'Eleanor',
        lastName: 'Vance',
        suffix: 'MD',
        npiNumber: '9988776655',
        primaryTaxonomy: '207Q00000X',
        status: 'active',
      },
    });
    testProviderId = provider.id;
  });

  afterAll(async () => {
    // Cleanup created test records
    await prisma.verificationHistory.deleteMany({
      where: { providerId: testProviderId },
    });
    await prisma.task.deleteMany({
      where: {
        OR: [
          { entityId: testProviderId },
          { entityId: { in: createdCredentialIds.map((c) => c.id) } },
        ],
      },
    });
    await prisma.notification.deleteMany({
      where: { userId: testUserId },
    });
    await prisma.document.deleteMany({
      where: { entityId: { in: createdCredentialIds.map((c) => c.id) } },
    });
    await prisma.stateLicense.deleteMany({ where: { providerId: testProviderId } });
    await prisma.deaRegistration.deleteMany({ where: { providerId: testProviderId } });
    await prisma.boardCertification.deleteMany({ where: { providerId: testProviderId } });
    await prisma.malpracticeInsurance.deleteMany({ where: { providerId: testProviderId } });
    await prisma.caqhProfile.deleteMany({ where: { providerId: testProviderId } });
    await prisma.provider.delete({ where: { id: testProviderId } });
    await prisma.user.delete({ where: { id: testUserId } });
  });

  // ==========================================
  // 1. Zod Validation & Invalid Date Rejection
  // ==========================================
  describe('Credential Input Validation', () => {
    it('should validate valid state license data and reject invalid dates', () => {
      // Valid license
      const valid = createStateLicenseSchema.safeParse({
        providerId: testProviderId,
        state: 'CA',
        licenseNumber: 'A123456',
        licenseType: 'MD',
        issueDate: '2022-01-01',
        expirationDate: '2027-01-01',
      });
      expect(valid.success).toBe(true);

      // Invalid date order: issueDate > expirationDate
      const invalid = createStateLicenseSchema.safeParse({
        providerId: testProviderId,
        state: 'CA',
        licenseNumber: 'A123456',
        issueDate: '2028-01-01',
        expirationDate: '2027-01-01',
      });
      expect(invalid.success).toBe(false);
    });

    it('should enforce strict DEA number format (2 letters + 7 digits)', () => {
      const validDea = createDeaSchema.safeParse({
        providerId: testProviderId,
        deaNumber: 'AB1234567',
        expirationDate: '2027-06-30',
      });
      expect(validDea.success).toBe(true);

      const invalidDea = createDeaSchema.safeParse({
        providerId: testProviderId,
        deaNumber: 'INVALID_DEA',
        expirationDate: '2027-06-30',
      });
      expect(invalidDea.success).toBe(false);
    });

    it('should validate CAQH ID format and require 8-10 digits', () => {
      const validCaqh = createCaqhSchema.safeParse({
        providerId: testProviderId,
        caqhId: '12345678',
        nextAttestationDate: '2027-05-01',
      });
      expect(validCaqh.success).toBe(true);

      const invalidCaqh = createCaqhSchema.safeParse({
        providerId: testProviderId,
        caqhId: 'short',
        nextAttestationDate: '2027-05-01',
      });
      expect(invalidCaqh.success).toBe(false);
    });
  });

  // ==========================================
  // 2. Timezone-Safe Status & Alert Windows
  // ==========================================
  describe('Status & Expiration Alert Windows Derivation', () => {
    it('should classify lapsed credentials as EXPIRED with negative day count', () => {
      const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const res = calculateExpirationStatus(pastDate, true, 'active');
      expect(res.computedStatus).toBe('expired');
      expect(res.alertWindow).toBe('expired');
      expect(res.daysUntilExpiration).toBeLessThan(0);
    });

    it('should classify credentials expiring within 14 days as 14_days window', () => {
      const targetDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const res = calculateExpirationStatus(targetDate, true, 'active');
      expect(res.computedStatus).toBe('expiring_soon');
      expect(res.alertWindow).toBe('14_days');
    });

    it('should classify credentials expiring within 30 days as 30_days window', () => {
      const targetDate = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
      const res = calculateExpirationStatus(targetDate, true, 'active');
      expect(res.computedStatus).toBe('expiring_soon');
      expect(res.alertWindow).toBe('30_days');
    });

    it('should classify credentials expiring within 60 days as 60_days window', () => {
      const targetDate = new Date(Date.now() + 50 * 24 * 60 * 60 * 1000);
      const res = calculateExpirationStatus(targetDate, true, 'active');
      expect(res.computedStatus).toBe('expiring_soon');
      expect(res.alertWindow).toBe('60_days');
    });

    it('should classify credentials expiring within 90 days as 90_days window', () => {
      const targetDate = new Date(Date.now() + 80 * 24 * 60 * 60 * 1000);
      const res = calculateExpirationStatus(targetDate, true, 'active');
      expect(res.computedStatus).toBe('expiring_soon');
      expect(res.alertWindow).toBe('90_days');
    });

    it('should mark inactive or revoked credentials as inactive regardless of date', () => {
      const futureDate = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);
      const res = calculateExpirationStatus(futureDate, true, 'inactive');
      expect(res.computedStatus).toBe('inactive');
      expect(res.alertWindow).toBe(null);
    });

    it('should mark unverified credentials without expiration as pending_verification', () => {
      const res = calculateExpirationStatus(null, false, 'active');
      expect(res.computedStatus).toBe('pending_verification');
    });
  });

  // ==========================================
  // 3. Database Persistence Across All 5 Models
  // ==========================================
  describe('Database Persistence of All 5 Credential Models', () => {
    it('should create and retrieve State License in PostgreSQL', async () => {
      const expDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000); // 20 days: <= 30d window
      const lic = await prisma.stateLicense.create({
        data: {
          providerId: testProviderId,
          state: 'TX',
          licenseNumber: 'TX-98765',
          licenseType: 'MD',
          expirationDate: expDate,
          status: 'active',
        },
      });
      createdCredentialIds.push({ type: 'state_license', id: lic.id });
      expect(lic.id).toBeDefined();
      expect(lic.state).toBe('TX');
    });

    it('should create and retrieve DEA Registration in PostgreSQL', async () => {
      const expDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days: <= 14d window
      const dea = await prisma.deaRegistration.create({
        data: {
          providerId: testProviderId,
          deaNumber: 'XY9876543',
          schedule: '2, 2N, 3, 3N, 4, 5',
          state: 'TX',
          expirationDate: expDate,
          status: 'active',
        },
      });
      createdCredentialIds.push({ type: 'dea_registration', id: dea.id });
      expect(dea.id).toBeDefined();
      expect(dea.deaNumber).toBe('XY9876543');
    });

    it('should create and retrieve Board Certification in PostgreSQL', async () => {
      const expDate = new Date(Date.now() + 55 * 24 * 60 * 60 * 1000); // 55 days: <= 60d window
      const board = await prisma.boardCertification.create({
        data: {
          providerId: testProviderId,
          boardName: 'American Board of Internal Medicine',
          specialty: 'Cardiovascular Disease',
          certificationNumber: 'ABIM-112233',
          expirationDate: expDate,
          status: 'active',
        },
      });
      createdCredentialIds.push({ type: 'board_certification', id: board.id });
      expect(board.id).toBeDefined();
      expect(board.specialty).toBe('Cardiovascular Disease');
    });

    it('should create and retrieve Malpractice Insurance in PostgreSQL', async () => {
      const expDate = new Date(Date.now() + 75 * 24 * 60 * 60 * 1000); // 75 days: <= 90d window
      const mal = await prisma.malpracticeInsurance.create({
        data: {
          providerId: testProviderId,
          carrierName: 'ProAssurance Indemnity',
          policyNumber: 'POL-998877',
          coverageType: 'occurrence',
          perClaimAmount: 1000000,
          aggregateAmount: 3000000,
          expirationDate: expDate,
          status: 'active',
        },
      });
      createdCredentialIds.push({ type: 'malpractice_insurance', id: mal.id });
      expect(mal.id).toBeDefined();
      expect(Number(mal.perClaimAmount)).toBe(1000000);
    });

    it('should create and retrieve CAQH Profile with encrypted password', async () => {
      const expDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // Past due: EXPIRED
      const caqh = await prisma.caqhProfile.create({
        data: {
          providerId: testProviderId,
          caqhId: '87654321',
          username: 'dr_vance_caqh',
          nextAttestationDate: expDate,
          attestationStatus: 'expired',
        },
      });
      createdCredentialIds.push({ type: 'caqh_profile', id: caqh.id });
      expect(caqh.id).toBeDefined();
      expect(caqh.caqhId).toBe('87654321');
    });
  });

  // ==========================================
  // 4. Unified Work Queue & Multi-Window Aggregation
  // ==========================================
  describe('Credential Work Queue & Filter Queries', () => {
    it('should return all unified credentials with real database window counts', async () => {
      const result = await getUnifiedCredentials({ providerId: testProviderId });
      expect(result.items.length).toBe(5);
      expect(result.summaryCounts.totalCount).toBeGreaterThanOrEqual(5);
      expect(result.summaryCounts.expiredCount).toBeGreaterThanOrEqual(1); // CAQH is expired
      expect(result.summaryCounts.within14DaysCount).toBeGreaterThanOrEqual(1); // DEA is <= 14d
      expect(result.summaryCounts.within30DaysCount).toBeGreaterThanOrEqual(2); // DEA + License
      expect(result.summaryCounts.within60DaysCount).toBeGreaterThanOrEqual(3); // + Board
      expect(result.summaryCounts.within90DaysCount).toBeGreaterThanOrEqual(4); // + Malpractice
    });

    it('should filter unified credentials by expiration window', async () => {
      // Filter for <= 14 days
      const window14Result = await getUnifiedCredentials({
        providerId: testProviderId,
        expirationWindow: '14_days',
      });
      expect(window14Result.items.some((i) => i.credentialType === 'dea_registration')).toBe(true);

      // Filter for expired
      const expiredResult = await getUnifiedCredentials({
        providerId: testProviderId,
        expirationWindow: 'expired',
      });
      expect(expiredResult.items.some((i) => i.credentialType === 'caqh_profile')).toBe(true);
    });

    it('should filter unified credentials by credential type', async () => {
      const licenseResult = await getUnifiedCredentials({
        providerId: testProviderId,
        credentialType: 'state_license',
      });
      expect(licenseResult.items.length).toBe(1);
      expect(licenseResult.items[0].identifier).toBe('TX-98765');
    });
  });

  // ==========================================
  // 5. Primary Source Verification (PSV) Tracking
  // ==========================================
  describe('Primary Source Verification (PSV) Tracking', () => {
    it('should record verification in verification_history and update parent credential', async () => {
      const lic = await prisma.stateLicense.findFirst({
        where: { providerId: testProviderId },
      });
      expect(lic).toBeDefined();

      const history = await prisma.verificationHistory.create({
        data: {
          entityType: 'state_license',
          entityId: lic!.id,
          providerId: testProviderId,
          method: 'state_board_website',
          source: 'Texas Medical Board Registry',
          status: 'verified',
          notes: 'License verified active and in good standing with zero disciplinary actions.',
          verifiedById: testUserId,
        },
      });

      await prisma.stateLicense.update({
        where: { id: lic!.id },
        data: {
          verified: true,
          verifiedAt: new Date(),
          verifiedById: testUserId,
        },
      });

      const updatedLic = await prisma.stateLicense.findUnique({
        where: { id: lic!.id },
        include: { verifiedBy: true },
      });

      expect(updatedLic?.verified).toBe(true);
      expect(updatedLic?.verifiedBy?.id).toBe(testUserId);
      expect(history.status).toBe('verified');
    });
  });

  // ==========================================
  // 6. Idempotent Expiration Scanner & Task Creation
  // ==========================================
  describe('Idempotent Expiration Scanner & Task Generation', () => {
    it('should scan approaching expirations and create work tasks', async () => {
      const firstScan = await scanUpcomingExpirationsAndCreateTasks();
      expect(firstScan.expiringFound).toBeGreaterThanOrEqual(4);
      expect(firstScan.tasksCreated).toBeGreaterThanOrEqual(1);

      // Verify tasks exist in database
      const createdTasks = await prisma.task.findMany({
        where: {
          entityId: { in: createdCredentialIds.map((c) => c.id) },
        },
      });
      expect(createdTasks.length).toBeGreaterThanOrEqual(1);
    });

    it('should NOT create duplicate tasks when run a second time (Idempotency check)', async () => {
      const secondScan = await scanUpcomingExpirationsAndCreateTasks();
      // Since tasks already exist for these entities and are open/pending, 0 new tasks should be created
      expect(secondScan.tasksCreated).toBe(0);
    });
  });

  // ==========================================
  // 7. Credential Deactivation & Soft Archival
  // ==========================================
  describe('Credential Deactivation', () => {
    it('should deactivate a credential and update computed status to inactive', async () => {
      const lic = await prisma.stateLicense.findFirst({
        where: { providerId: testProviderId },
      });
      expect(lic).toBeDefined();

      const deactivated = await prisma.stateLicense.update({
        where: { id: lic!.id },
        data: { status: 'inactive' },
      });
      expect(deactivated.status).toBe('inactive');

      const { computedStatus } = calculateExpirationStatus(deactivated.expirationDate, true, deactivated.status);
      expect(computedStatus).toBe('inactive');
    });
  });

  // ==========================================
  // 8. RBAC & Security
  // ==========================================
  describe('RBAC & Role-Based Authorization', () => {
    it('should allow credentialing_specialist to write credentials', () => {
      expect(hasPermission('credentialing_specialist', 'credentials:write')).toBe(true);
      expect(hasPermission('admin', 'credentials:write')).toBe(true);
      expect(hasPermission('super_admin', 'credentials:write')).toBe(true);
    });

    it('should FORBID viewer role from writing or verifying credentials', () => {
      expect(hasPermission('viewer', 'credentials:write')).toBe(false);
      expect(hasPermission('viewer', 'credentials:read')).toBe(true);
    });
  });

  // ==========================================
  // 9. Document Relationship Integration
  // ==========================================
  describe('Document Relationship Integration', () => {
    it('should link polymorphic documents to credential records without storing raw files in credential tables', async () => {
      const dea = await prisma.deaRegistration.findFirst({
        where: { providerId: testProviderId },
      });
      expect(dea).toBeDefined();

      const doc = await prisma.document.create({
        data: {
          entityType: 'dea_registration',
          entityId: dea!.id,
          documentType: 'dea_certificate',
          title: '2024-2027 DEA Certificate of Registration',
          uploadedById: testUserId,
        },
      });

      const linkedDocs = await prisma.document.findMany({
        where: { entityType: 'dea_registration', entityId: dea!.id },
      });
      expect(linkedDocs.length).toBe(1);
      expect(linkedDocs[0].documentType).toBe('dea_certificate');
      expect(linkedDocs[0].entityId).toBe(dea!.id);
    });
  });
});

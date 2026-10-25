import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db/prisma';
import { UserRole } from '@prisma/client';
import { createSessionToken } from '../src/lib/auth/jwt';
import { hasPermission } from '../src/lib/auth/rbac';
import { BulkService } from '../src/lib/bulk/bulk-service';
import { CacheService } from '../src/lib/cache/redis-cache';
import { generateFictionalProviders } from '../scripts/seed-fictional-providers';

// Route handlers for direct API testing
import { POST as bulkImportRoute } from '../src/app/api/v1/providers/bulk-import/route';
import { POST as bulkEnrollmentRoute } from '../src/app/api/v1/enrollments/bulk-create/route';
import nextConfig from '../next.config.mjs';

describe('Phase 9: Final Polish, Bulk Operations & Security Hardening Module', () => {
  let adminUser: any;
  let specialistUser: any;
  let viewerUser: any;
  let testProviderA: any;
  let testProviderB: any;
  let testPayerA: any;
  let testPayerB: any;

  beforeAll(async () => {
    // 1. Create synthetic users
    adminUser = await prisma.user.upsert({
      where: { email: 'phase9_admin@example.com' },
      update: {},
      create: {
        email: 'phase9_admin@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Alice',
        lastName: 'AdminPhase9',
        role: 'admin',
      },
    });

    specialistUser = await prisma.user.upsert({
      where: { email: 'phase9_specialist@example.com' },
      update: {},
      create: {
        email: 'phase9_specialist@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Bob',
        lastName: 'SpecialistPhase9',
        role: 'credentialing_specialist',
      },
    });

    viewerUser = await prisma.user.upsert({
      where: { email: 'phase9_viewer@example.com' },
      update: {},
      create: {
        email: 'phase9_viewer@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Valerie',
        lastName: 'ViewerPhase9',
        role: 'viewer',
      },
    });

    // 2. Create synthetic providers for bulk enrollment tests
    testProviderA = await prisma.provider.upsert({
      where: { npiNumber: '9999999981' },
      update: {},
      create: {
        firstName: 'DrAlpha',
        lastName: 'BatchTest',
        npiNumber: '9999999981',
        npiType: 1,
        status: 'active',
        credentialingStatus: 'in_progress',
      },
    });

    testProviderB = await prisma.provider.upsert({
      where: { npiNumber: '9999999982' },
      update: {},
      create: {
        firstName: 'DrBeta',
        lastName: 'BatchTest',
        npiNumber: '9999999982',
        npiType: 1,
        status: 'active',
        credentialingStatus: 'in_progress',
      },
    });

    // 3. Create synthetic payers
    testPayerA = await prisma.payer.create({
      data: {
        name: 'Phase 9 Commercial Payer Alpha',
        shortName: 'P9-ALPHA',
        payerType: 'commercial',
      },
    });

    testPayerB = await prisma.payer.create({
      data: {
        name: 'Phase 9 Medicare Advantage Beta',
        shortName: 'P9-BETA',
        payerType: 'medicare',
      },
    });
  });

  afterAll(async () => {
    try {
      // Clean up enrollments and providers created during test
      await prisma.payerEnrollment.deleteMany({
        where: {
          OR: [
            { providerId: { in: [testProviderA?.id, testProviderB?.id].filter(Boolean) } },
            { payerId: { in: [testPayerA?.id, testPayerB?.id].filter(Boolean) } },
          ],
        },
      });

      // Clean up synthetic providers
      await prisma.provider.deleteMany({
        where: {
          npiNumber: {
            in: [
              '9999999981',
              '9999999982',
              '9998887701',
              '9998887702',
              '9998887703',
              '9998887704',
              '9990000001',
              '9990000002',
              '9990000003',
            ],
          },
        },
      });

      if (testPayerA) await prisma.payer.deleteMany({ where: { id: testPayerA.id } });
      if (testPayerB) await prisma.payer.deleteMany({ where: { id: testPayerB.id } });
    } catch (err) {
      console.warn('Cleanup error in Phase 9 tests:', err);
    }
  });

  describe('1. Bulk Provider CSV Import — Preview Mode', () => {
    it('accurately parses CSV and validates NPIs and names without database mutation', async () => {
      const csv = `First Name,Last Name,NPI,Specialty,Email,Date of Birth,SSN
David,Miller,9998887701,207Q00000X,david@example.com,1980-05-15,999-11-2222
Invalid,User,12345,207R00000X,invalid@example.com,1985-02-10,999-22-3333
Duplicate,One,9998887702,207N00000X,dup1@example.com,1975-08-20,999-33-4444
Duplicate,Two,9998887702,207N00000X,dup2@example.com,1979-01-12,999-44-5555`;

      const result = await BulkService.previewProviderImport(csv);

      expect(result.totalRows).toBe(4);
      expect(result.validCount).toBe(2); // Row 1 (David) and Row 3 (Duplicate One)
      expect(result.invalidCount).toBe(2); // Row 2 (short NPI '12345') and Row 4 (duplicate NPI '9998887702')

      // Errors array should contain descriptive messages
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.some((e) => e.field === 'npiNumber' && e.message.includes('10 numeric digits'))).toBe(true);
      expect(result.errors.some((e) => e.field === 'npiNumber' && e.message.includes('Duplicate NPI'))).toBe(true);

      // Verify DB was NOT mutated during preview
      const checkInDb = await prisma.provider.findUnique({ where: { npiNumber: '9998887701' } });
      expect(checkInDb).toBeNull();
    });

    it('flags collision when CSV row contains NPI already existing in PostgreSQL', async () => {
      // testProviderA has NPI '9999999981' in DB
      const csvWithDbCollision = `First Name,Last Name,NPI,Specialty
Sarah,Existing,9999999981,207Q00000X`;

      const result = await BulkService.previewProviderImport(csvWithDbCollision);
      expect(result.totalRows).toBe(1);
      expect(result.validCount).toBe(0);
      expect(result.invalidCount).toBe(1);
      expect(result.errors[0].message).toContain('already exists in the system');
    });
  });

  describe('2. Bulk Provider CSV Import — Commit Mode', () => {
    it('commits valid providers with encrypted SSN and logs immutable audit event', async () => {
      const csvToCommit = `First Name,Last Name,NPI,Specialty,Email,SSN
Gregory,House,9998887703,207R00000X,dr.house@fictional.org,999-99-8888`;

      const result = await BulkService.commitProviderImport({
        csvText: csvToCommit,
        userId: adminUser.id,
        userEmail: adminUser.email,
      });

      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.importedIds.length).toBe(1);

      // Verify provider exists in PostgreSQL
      const created = await prisma.provider.findUnique({
        where: { npiNumber: '9998887703' },
      });
      expect(created).not.toBeNull();
      expect(created?.firstName).toBe('Gregory');
      expect(created?.lastName).toBe('House');
      expect(created?.ssnEncrypted).toBeDefined();

      // Verify immutable audit log was created
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          action: 'BULK_PROVIDERS_IMPORTED',
          userId: adminUser.id,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditLog).toBeDefined();
      expect(auditLog?.entityType).toBe('provider');
      expect((auditLog?.metadata as any)?.importedCount).toBe(1);
    });

    it('safely handles partial failures: imports valid rows while isolating and reporting invalid rows', async () => {
      const mixedCsv = `First Name,Last Name,NPI,Specialty,Email
Valid,Doc,9998887704,207Q00000X,valid@example.com
,MissingFirst,9998887705,207Q00000X,missing@example.com
Short,Npi,123,207Q00000X,short@example.com`;

      const result = await BulkService.commitProviderImport({
        csvText: mixedCsv,
        userId: adminUser.id,
        userEmail: adminUser.email,
      });

      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(1);
      expect(result.failedCount).toBe(2);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);

      const validProv = await prisma.provider.findUnique({ where: { npiNumber: '9998887704' } });
      expect(validProv).not.toBeNull();
      expect(validProv?.firstName).toBe('Valid');

      // Cleanup
      await prisma.provider.deleteMany({ where: { npiNumber: '9998887704' } });
    });
  });

  describe('3. Bulk Enrollment Creation', () => {
    it('creates multiple enrollments across provider × payer matrix and handles duplicates', async () => {
      const result = await BulkService.createBulkEnrollments({
        input: {
          providerIds: [testProviderA.id, testProviderB.id],
          payerIds: [testPayerA.id, testPayerB.id],
          enrollmentType: 'individual',
          status: 'initial_application',
          notes: 'Batch test creation Phase 9',
        },
        userId: specialistUser.id,
        userEmail: specialistUser.email,
      });

      // 2 providers × 2 payers = 4 combinations
      expect(result.totalCombinations).toBe(4);
      expect(result.createdCount).toBe(4);
      expect(result.skippedCount).toBe(0);
      expect(result.createdEnrollmentIds.length).toBe(4);

      // Verify status history was created for one of the enrollments
      const history = await prisma.enrollmentStatusHistory.findFirst({
        where: { enrollmentId: result.createdEnrollmentIds[0] },
      });
      expect(history).toBeDefined();
      expect(history?.newStatus).toBe('initial_application');

      // Test duplicate protection: running same matrix again must skip all 4 existing active enrollments
      const repeatResult = await BulkService.createBulkEnrollments({
        input: {
          providerIds: [testProviderA.id, testProviderB.id],
          payerIds: [testPayerA.id, testPayerB.id],
        },
        userId: specialistUser.id,
        userEmail: specialistUser.email,
      });

      expect(repeatResult.createdCount).toBe(0);
      expect(repeatResult.skippedCount).toBe(4);
      expect(repeatResult.skippedDetails.length).toBe(4);
      expect(repeatResult.skippedDetails[0].reason).toContain('Active enrollment already exists');

      // Verify immutable audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          action: 'BULK_ENROLLMENTS_CREATED',
          userId: specialistUser.id,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditLog).toBeDefined();
      expect(auditLog?.entityType).toBe('payer_enrollment');
      expect((auditLog?.metadata as any)?.totalCombinations).toBe(4);
    });
  });

  describe('4. Bulk Operations API Endpoints & RBAC Security', () => {
    let adminToken: string;
    let viewerToken: string;

    beforeAll(async () => {
      await prisma.userSession.upsert({
        where: { sessionToken: 'sess-p9-admin-bulk' },
        update: { expiresAt: new Date(Date.now() + 86400000) },
        create: { userId: adminUser.id, sessionToken: 'sess-p9-admin-bulk', expiresAt: new Date(Date.now() + 86400000) },
      });
      adminToken = await createSessionToken({
        userId: adminUser.id,
        email: adminUser.email,
        role: UserRole.admin,
        sessionId: 'sess-p9-admin-bulk',
      });

      await prisma.userSession.upsert({
        where: { sessionToken: 'sess-p9-viewer-bulk' },
        update: { expiresAt: new Date(Date.now() + 86400000) },
        create: { userId: viewerUser.id, sessionToken: 'sess-p9-viewer-bulk', expiresAt: new Date(Date.now() + 86400000) },
      });
      viewerToken = await createSessionToken({
        userId: viewerUser.id,
        email: viewerUser.email,
        role: UserRole.viewer,
        sessionId: 'sess-p9-viewer-bulk',
      });
    });

    it('rejects viewer from accessing POST /api/v1/providers/bulk-import (403 Forbidden)', async () => {
      const req = new Request('http://localhost/api/v1/providers/bulk-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${viewerToken}`,
        },
        body: JSON.stringify({ csvText: 'First Name,Last Name,NPI\nJohn,Doe,9991112233' }),
      });

      const res = await bulkImportRoute(req);
      expect(res.status).toBe(403);
    });

    it('allows admin to preview via POST /api/v1/providers/bulk-import (200 OK)', async () => {
      const req = new Request('http://localhost/api/v1/providers/bulk-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${adminToken}`,
        },
        body: JSON.stringify({
          csvText: 'First Name,Last Name,NPI\nJohn,Doe,9991112233',
          preview: true,
        }),
      });

      const res = await bulkImportRoute(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.mode).toBe('preview');
      expect(body.totalRows).toBe(1);
    });

    it('rejects viewer from accessing POST /api/v1/enrollments/bulk-create (403 Forbidden)', async () => {
      const req = new Request('http://localhost/api/v1/enrollments/bulk-create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${viewerToken}`,
        },
        body: JSON.stringify({
          providerIds: [testProviderA.id],
          payerIds: [testPayerA.id],
        }),
      });

      const res = await bulkEnrollmentRoute(req);
      expect(res.status).toBe(403);
    });
  });

  describe('5. Security Hardening — CSP & HTTP Security Headers', () => {
    it('verifies next.config.mjs specifies production Content-Security-Policy and security headers', async () => {
      expect(typeof (nextConfig as any).headers).toBe('function');

      const headersConfig = await (nextConfig as any).headers();
      expect(Array.isArray(headersConfig)).toBe(true);

      const globalHeaderRule = headersConfig.find((h: any) => h.source === '/:path*');
      expect(globalHeaderRule).toBeDefined();

      const headerMap = new Map(globalHeaderRule!.headers.map((h: any) => [h.key, h.value]));

      // 1. Content Security Policy
      expect(headerMap.has('Content-Security-Policy')).toBe(true);
      const csp = headerMap.get('Content-Security-Policy') as string;
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");

      // 2. Anti-clickjacking & MIME sniffing
      expect(headerMap.get('X-Frame-Options')).toBe('DENY');
      expect(headerMap.get('X-Content-Type-Options')).toBe('nosniff');

      // 3. Strict Transport Security & Referrer Policy
      expect(headerMap.get('Strict-Transport-Security')).toContain('max-age=63072000');
      expect(headerMap.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');

      // 4. Permissions Policy
      expect(headerMap.get('Permissions-Policy')).toContain('camera=()');
    });
  });

  describe('6. Performance Optimization — Caching Utility', () => {
    beforeAll(() => {
      CacheService.clearMemoryCache();
    });

    it('stores and retrieves cached items with fallback safety', async () => {
      await CacheService.set('test_cache_key', { count: 42, label: 'Analytics' }, 60);

      const cached = await CacheService.get<{ count: number; label: string }>('test_cache_key');
      expect(cached).not.toBeNull();
      expect(cached?.count).toBe(42);
      expect(cached?.label).toBe('Analytics');
    });

    it('executes fetcher on cache miss and returns cached on subsequent call', async () => {
      let callCount = 0;
      const fetcher = async () => {
        callCount++;
        return { data: 'fresh_data_result' };
      };

      const result1 = await CacheService.getOrSet('test_fetcher_key', fetcher, 60);
      expect(result1.data).toBe('fresh_data_result');
      expect(callCount).toBe(1);

      // Second call should return cached value without invoking fetcher
      const result2 = await CacheService.getOrSet('test_fetcher_key', fetcher, 60);
      expect(result2.data).toBe('fresh_data_result');
      expect(callCount).toBe(1);
    });

    it('invalidates cache properly', async () => {
      await CacheService.set('key_to_delete', 'value_123');
      await CacheService.del('key_to_delete');

      const after = await CacheService.get('key_to_delete');
      expect(after).toBeNull();
    });
  });

  describe('7. Comprehensive Fictional Seed Data Generator', () => {
    it('generates 3 synthetic providers with valid 10-digit NPIs starting with 999 and encrypted SSNs', async () => {
      const result = await generateFictionalProviders(3);

      expect(result.count).toBe(3);
      expect(result.providerIds.length).toBe(3);

      // Verify created providers in DB
      const providers = await prisma.provider.findMany({
        where: { id: { in: result.providerIds } },
        include: {
          stateLicenses: true,
          deaRegistrations: true,
          boardCertifications: true,
          malpracticePolicies: true,
          caqhProfile: true,
          enrollments: true,
        },
      });

      expect(providers.length).toBe(3);

      for (const p of providers) {
        // Enforce 10-digit synthetic NPI policy
        expect(p.npiNumber).toMatch(/^999\d{7}$/);
        expect(p.ssnEncrypted).toBeDefined();

        // Enforce credentials created
        expect(p.stateLicenses.length).toBeGreaterThanOrEqual(1);
        expect(p.deaRegistrations.length).toBeGreaterThanOrEqual(1);
        expect(p.boardCertifications.length).toBeGreaterThanOrEqual(1);
        expect(p.malpracticePolicies.length).toBeGreaterThanOrEqual(1);
        expect(p.caqhProfile).not.toBeNull();
        expect(p.enrollments.length).toBeGreaterThanOrEqual(2);
      }

      // Cleanup the 3 synthetic providers
      await prisma.payerEnrollment.deleteMany({ where: { providerId: { in: result.providerIds } } });
      await prisma.stateLicense.deleteMany({ where: { providerId: { in: result.providerIds } } });
      await prisma.deaRegistration.deleteMany({ where: { providerId: { in: result.providerIds } } });
      await prisma.boardCertification.deleteMany({ where: { providerId: { in: result.providerIds } } });
      await prisma.malpracticeInsurance.deleteMany({ where: { providerId: { in: result.providerIds } } });
      await prisma.caqhProfile.deleteMany({ where: { providerId: { in: result.providerIds } } });
      await prisma.provider.deleteMany({ where: { id: { in: result.providerIds } } });
    });
  });
});

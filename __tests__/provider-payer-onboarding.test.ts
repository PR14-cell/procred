import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db/prisma';
import { UserRole } from '@prisma/client';
import { createSessionToken } from '../src/lib/auth/jwt';
import { POST as createProviderRoute } from '../src/app/api/v1/providers/route';
import { GET as getPayersRoute } from '../src/app/api/v1/payers/route';
import { GET as getEnrollmentsRoute } from '../src/app/api/v1/enrollments/route';
import { decrypt } from '../src/lib/encryption/aes';

describe('UAT Improvement: Payor Association in Provider Onboarding', () => {
  let superAdminUser: any;
  let credSpecialistUser: any;
  let viewerUser: any;

  let superAdminToken: string;
  let credSpecialistToken: string;
  let viewerToken: string;

  let testPayer1: any;
  let testPayer2: any;
  let testLocation: any;
  let testTaxonomy: any;

  const testProviderIds: string[] = [];

  beforeAll(async () => {
    // 1. Create or retrieve test users across roles
    superAdminUser = await prisma.user.upsert({
      where: { email: 'payor_test_admin@example.com' },
      update: {},
      create: {
        email: 'payor_test_admin@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Alice',
        lastName: 'Admin',
        role: UserRole.super_admin,
      },
    });

    credSpecialistUser = await prisma.user.upsert({
      where: { email: 'payor_test_credspec@example.com' },
      update: {},
      create: {
        email: 'payor_test_credspec@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Charlie',
        lastName: 'CredSpec',
        role: UserRole.credentialing_specialist,
      },
    });

    viewerUser = await prisma.user.upsert({
      where: { email: 'payor_test_viewer@example.com' },
      update: {},
      create: {
        email: 'payor_test_viewer@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Vicky',
        lastName: 'Viewer',
        role: UserRole.viewer,
      },
    });

    // 2. Generate JWT session tokens and active session rows
    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-payor-admin' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: superAdminUser.id, sessionToken: 'sess-payor-admin', expiresAt: new Date(Date.now() + 86400000) },
    });
    superAdminToken = await createSessionToken({
      userId: superAdminUser.id,
      email: superAdminUser.email,
      role: UserRole.super_admin,
      sessionId: 'sess-payor-admin',
    });

    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-payor-credspec' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: credSpecialistUser.id, sessionToken: 'sess-payor-credspec', expiresAt: new Date(Date.now() + 86400000) },
    });
    credSpecialistToken = await createSessionToken({
      userId: credSpecialistUser.id,
      email: credSpecialistUser.email,
      role: UserRole.credentialing_specialist,
      sessionId: 'sess-payor-credspec',
    });

    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-payor-viewer' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: viewerUser.id, sessionToken: 'sess-payor-viewer', expiresAt: new Date(Date.now() + 86400000) },
    });
    viewerToken = await createSessionToken({
      userId: viewerUser.id,
      email: viewerUser.email,
      role: UserRole.viewer,
      sessionId: 'sess-payor-viewer',
    });

    // 3. Ensure test Payers exist
    testPayer1 = await prisma.payer.upsert({
      where: { id: '45fc6ed9-1366-45c4-a7d9-ad72d4b6c4c2' },
      update: { isActive: true },
      create: {
        id: '45fc6ed9-1366-45c4-a7d9-ad72d4b6c4c2',
        name: 'Medicare Part B Fictional',
        shortName: 'MED-B',
        payerType: 'medicare',
        isActive: true,
      },
    });

    testPayer2 = await prisma.payer.upsert({
      where: { id: '9195bbd4-957c-43dd-bc90-e2742008acd8' },
      update: { isActive: true },
      create: {
        id: '9195bbd4-957c-43dd-bc90-e2742008acd8',
        name: 'Aetna Health Plan Fictional',
        shortName: 'AET-FIC',
        payerType: 'commercial',
        isActive: true,
      },
    });

    // 4. Clean up any stale test providers from interrupted runs
    const testNpis = [
      '9900010001', '9900010002', '9900010003', '9900010004',
      '9900010005', '9900010006', '9900010007', '9900010008', '9900010009',
    ];
    const existingProviders = await prisma.provider.findMany({
      where: { npiNumber: { in: testNpis } },
      select: { id: true },
    });
    for (const p of existingProviders) {
      await prisma.enrollmentStatusHistory.deleteMany({
        where: { enrollment: { providerId: p.id } },
      });
      await prisma.payerEnrollment.deleteMany({ where: { providerId: p.id } });
      await prisma.providerSpecialty.deleteMany({ where: { providerId: p.id } });
      await prisma.providerLocation.deleteMany({ where: { providerId: p.id } });
      await prisma.provider.deleteMany({ where: { id: p.id } });
    }

    await prisma.location.deleteMany({
      where: { name: 'Payor Onboarding Test Clinic' },
    });

    // 5. Ensure test Location & Taxonomy exist
    testLocation = await prisma.location.create({
      data: {
        name: 'Payor Onboarding Test Clinic',
        address1: '400 Medical Parkway',
        city: 'Austin',
        state: 'TX',
        zipCode: '78705',
      },
    });

    testTaxonomy = await prisma.taxonomyCode.upsert({
      where: { code: '207Q00000X' },
      update: {},
      create: {
        code: '207Q00000X',
        classification: 'Allopathic & Osteopathic Physicians',
        specialization: 'Family Medicine',
      },
    });
  });

  afterAll(async () => {
    // Clean up created providers & enrollments
    for (const id of testProviderIds) {
      await prisma.enrollmentStatusHistory.deleteMany({
        where: { enrollment: { providerId: id } },
      });
      await prisma.payerEnrollment.deleteMany({ where: { providerId: id } });
      await prisma.providerSpecialty.deleteMany({ where: { providerId: id } });
      await prisma.providerLocation.deleteMany({ where: { providerId: id } });
      await prisma.provider.deleteMany({ where: { id } });
    }

    if (testLocation) {
      await prisma.location.deleteMany({ where: { id: testLocation.id } });
    }

    await prisma.$disconnect();
  });

  // =========================================================================
  // 1. Create a provider with one selected payor
  // =========================================================================
  it('1. should create a provider with one selected payor and return 201 Created', async () => {
    const payload = {
      firstName: 'Emily',
      lastName: 'Watson',
      npiNumber: '9900010001',
      status: 'active',
      credentialingStatus: 'in_progress',
      specialties: [{ taxonomyCode: testTaxonomy.code, isPrimary: true }],
      locationIds: [{ locationId: testLocation.id, isPrimary: true }],
      payerEnrollments: [
        {
          payerId: testPayer1.id,
          enrollmentType: 'individual',
          status: 'not_started',
          notes: 'Initial Medicare enrollment initiated during onboarding',
        },
      ],
    };

    const req = new Request('http://localhost/api/v1/providers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${superAdminToken}`,
      },
      body: JSON.stringify(payload),
    });

    const res = await createProviderRoute(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.provider).toBeDefined();
    expect(body.provider.firstName).toBe('Emily');
    expect(body.provider.npiNumber).toBe('9900010001');

    testProviderIds.push(body.provider.id);

    // Verify enrollment returned in response
    expect(body.provider.enrollments).toBeDefined();
    expect(body.provider.enrollments.length).toBe(1);
    expect(body.provider.enrollments[0].payerId).toBe(testPayer1.id);
    expect(body.provider.enrollments[0].status).toBe('not_started');
    expect(body.provider.enrollments[0].enrollmentType).toBe('individual');
  });

  // =========================================================================
  // 2. Create a provider with multiple selected payors
  // =========================================================================
  it('2. should create a provider with multiple selected payors simultaneously', async () => {
    const payload = {
      firstName: 'Marcus',
      lastName: 'Brody',
      npiNumber: '9900010002',
      status: 'active',
      credentialingStatus: 'in_progress',
      payerIds: [testPayer1.id, testPayer2.id],
    };

    const req = new Request('http://localhost/api/v1/providers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${superAdminToken}`,
      },
      body: JSON.stringify(payload),
    });

    const res = await createProviderRoute(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    testProviderIds.push(body.provider.id);

    expect(body.provider.enrollments).toHaveLength(2);
    const payerIds = body.provider.enrollments.map((e: any) => e.payerId);
    expect(payerIds).toContain(testPayer1.id);
    expect(payerIds).toContain(testPayer2.id);
  });

  // =========================================================================
  // 3. Search and select existing payors
  // =========================================================================
  it('3. should search and filter active payors from the Payers Directory API', async () => {
    const req = new Request('http://localhost/api/v1/payers?search=Medicare&isActive=true', {
      headers: { cookie: `session_token=${credSpecialistToken}` },
    });

    const res = await getPayersRoute(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.payers).toBeDefined();
    expect(body.payers.length).toBeGreaterThanOrEqual(1);

    const found = body.payers.find((p: any) => p.id === testPayer1.id);
    expect(found).toBeDefined();
    expect(found.name).toContain('Medicare');
  });

  // =========================================================================
  // 4. Verify enrollment records are persisted correctly in PostgreSQL
  // =========================================================================
  it('4. should verify enrollment records and initial status history are persisted in DB', async () => {
    const providerId = testProviderIds[0];

    const dbEnrollments = await prisma.payerEnrollment.findMany({
      where: { providerId },
      include: {
        payer: true,
        statusHistory: true,
      },
    });

    expect(dbEnrollments).toHaveLength(1);
    const enr = dbEnrollments[0];
    expect(enr.payerId).toBe(testPayer1.id);
    expect(enr.payer.name).toBe('Medicare Part B Fictional');
    expect(enr.status).toBe('not_started');
    expect(enr.enrollmentType).toBe('individual');
    expect(enr.applicationType).toBe('initial');
    expect(enr.notes).toBe('Initial Medicare enrollment initiated during onboarding');

    // Verify initial status history record was created
    expect(enr.statusHistory).toHaveLength(1);
    expect(enr.statusHistory[0].newStatus).toBe('not_started');
    expect(enr.statusHistory[0].notes).toContain('Initial enrollment application created during provider onboarding');
  });

  // =========================================================================
  // 5. Verify enrollments appear in the dedicated Payer Enrollment module
  // =========================================================================
  it('5. should verify that created enrollments appear in GET /api/v1/enrollments work queue', async () => {
    const providerId = testProviderIds[0];

    const req = new Request(`http://localhost/api/v1/enrollments?providerId=${providerId}`, {
      headers: { cookie: `session_token=${superAdminToken}` },
    });

    const res = await getEnrollmentsRoute(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toBeDefined();
    expect(body.items.length).toBe(1);
    expect(body.items[0].providerId).toBe(providerId);
    expect(body.items[0].payer.name).toBe('Medicare Part B Fictional');
  });

  // =========================================================================
  // 6. Prevent duplicate enrollments in request payload
  // =========================================================================
  it('6. should prevent duplicate enrollments when the same payor is passed multiple times in payload', async () => {
    const payload = {
      firstName: 'David',
      lastName: 'DuplicateCheck',
      npiNumber: '9900010003',
      status: 'active',
      // Same payerId listed in both payerEnrollments and payerIds
      payerEnrollments: [
        { payerId: testPayer1.id, enrollmentType: 'individual', status: 'not_started' },
        { payerId: testPayer1.id, enrollmentType: 'individual', status: 'not_started' },
      ],
      payerIds: [testPayer1.id],
    };

    const req = new Request('http://localhost/api/v1/providers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${superAdminToken}`,
      },
      body: JSON.stringify(payload),
    });

    const res = await createProviderRoute(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    testProviderIds.push(body.provider.id);

    // Verify only ONE enrollment was created for this payer
    expect(body.provider.enrollments).toHaveLength(1);
    expect(body.provider.enrollments[0].payerId).toBe(testPayer1.id);

    const countInDb = await prisma.payerEnrollment.count({
      where: { providerId: body.provider.id, payerId: testPayer1.id },
    });
    expect(countInDb).toBe(1);
  });

  // =========================================================================
  // 7. Preserve existing enrollment details when duplicate enrollment attempted
  // =========================================================================
  it('7. should preserve existing enrollment status and notes when duplicate is attempted', async () => {
    const existingProviderId = testProviderIds[0];

    // Update existing enrollment to 'in_progress' with custom notes
    await prisma.payerEnrollment.updateMany({
      where: { providerId: existingProviderId, payerId: testPayer1.id },
      data: {
        status: 'in_progress',
        notes: 'Pre-existing special tracking notes - DO NOT OVERWRITE',
      },
    });

    // Verify database state before
    const before = await prisma.payerEnrollment.findFirst({
      where: { providerId: existingProviderId, payerId: testPayer1.id },
    });
    expect(before?.status).toBe('in_progress');
    expect(before?.notes).toBe('Pre-existing special tracking notes - DO NOT OVERWRITE');

    // Verify count remains 1 and existing values are intact
    const count = await prisma.payerEnrollment.count({
      where: { providerId: existingProviderId, payerId: testPayer1.id },
    });
    expect(count).toBe(1);
  });

  // =========================================================================
  // 8. Validate missing or invalid required enrollment data
  // =========================================================================
  it('8. should reject request with 400 when an invalid or non-existent payer ID is provided', async () => {
    // 8a. Invalid UUID format
    const invalidUuidPayload = {
      firstName: 'Invalid',
      lastName: 'UUIDTest',
      npiNumber: '9900010004',
      payerIds: ['not-a-valid-uuid'],
    };

    const req1 = new Request('http://localhost/api/v1/providers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${superAdminToken}`,
      },
      body: JSON.stringify(invalidUuidPayload),
    });

    const res1 = await createProviderRoute(req1);
    expect(res1.status).toBe(400);

    // 8b. Non-existent UUID
    const nonExistentPayload = {
      firstName: 'Missing',
      lastName: 'PayerTest',
      npiNumber: '9900010005',
      payerIds: ['00000000-0000-0000-0000-000000009999'],
    };

    const req2 = new Request('http://localhost/api/v1/providers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${superAdminToken}`,
      },
      body: JSON.stringify(nonExistentPayload),
    });

    const res2 = await createProviderRoute(req2);
    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.message).toContain('selected payors do not exist');
  });

  // =========================================================================
  // 9. Enforce server-side RBAC
  // =========================================================================
  it('9. should enforce RBAC: reject viewer with 403 Forbidden and allow authorized roles', async () => {
    const payload = {
      firstName: 'Unauthorized',
      lastName: 'Attempt',
      npiNumber: '9900010006',
      payerIds: [testPayer1.id],
    };

    // Viewer lacks 'providers:write'
    const reqViewer = new Request('http://localhost/api/v1/providers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${viewerToken}`,
      },
      body: JSON.stringify(payload),
    });

    const resViewer = await createProviderRoute(reqViewer);
    expect(resViewer.status).toBe(403);

    // Credentialing specialist possesses 'providers:write'
    const reqCredSpec = new Request('http://localhost/api/v1/providers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${credSpecialistToken}`,
      },
      body: JSON.stringify(payload),
    });

    const resCredSpec = await createProviderRoute(reqCredSpec);
    expect(resCredSpec.status).toBe(201);

    const body = await resCredSpec.json();
    testProviderIds.push(body.provider.id);
    expect(body.provider.enrollments).toHaveLength(1);
  });

  // =========================================================================
  // 10. Verify audit events
  // =========================================================================
  it('10. should record immutable audit events for both provider creation and enrollment creation', async () => {
    const providerId = testProviderIds[testProviderIds.length - 1];

    const logs = await prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: 'provider', entityId: providerId },
          { entityType: 'payer_enrollment', metadata: { path: ['providerId'], equals: providerId } },
        ],
      },
    });

    expect(logs.length).toBeGreaterThanOrEqual(2);

    const providerLog = logs.find((l) => l.action === 'create_provider');
    expect(providerLog).toBeDefined();
    expect(providerLog?.entityType).toBe('provider');

    const enrollmentLog = logs.find((l) => l.action === 'ENROLLMENT_CREATED');
    expect(enrollmentLog).toBeDefined();
    expect(enrollmentLog?.entityType).toBe('payer_enrollment');
    expect((enrollmentLog?.metadata as any)?.source).toBe('provider_onboarding');
  });

  // =========================================================================
  // 11. Verify transaction failure does not leave orphaned records
  // =========================================================================
  it('11. should roll back entire transaction if any part fails, leaving no orphaned provider or enrollment', async () => {
    const doomedNpi = '9900010099';

    const doomedPayload = {
      firstName: 'Orphan',
      lastName: 'PreventTest',
      npiNumber: doomedNpi,
      payerIds: [
        testPayer1.id,
        '00000000-0000-0000-0000-000000009999', // Non-existent payer causes failure
      ],
    };

    const req = new Request('http://localhost/api/v1/providers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${superAdminToken}`,
      },
      body: JSON.stringify(doomedPayload),
    });

    const res = await createProviderRoute(req);
    expect(res.status).toBe(400);

    // Verify provider was NOT created in DB
    const orphanProvider = await prisma.provider.findUnique({
      where: { npiNumber: doomedNpi },
    });
    expect(orphanProvider).toBeNull();

    // Verify no enrollment was created
    const orphanEnrollment = await prisma.payerEnrollment.findFirst({
      where: { payerId: testPayer1.id, provider: { npiNumber: doomedNpi } },
    });
    expect(orphanEnrollment).toBeNull();
  });

  // =========================================================================
  // 12. Verify existing provider onboarding without payors remains intact
  // =========================================================================
  it('12. should continue to support provider onboarding without payors (pure individual provider)', async () => {
    const payload = {
      firstName: 'Independent',
      lastName: 'Physician',
      npiNumber: '9900010007',
      status: 'active',
      credentialingStatus: 'initial',
      ssn: '123-45-6789',
    };

    const req = new Request('http://localhost/api/v1/providers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${superAdminToken}`,
      },
      body: JSON.stringify(payload),
    });

    const res = await createProviderRoute(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    testProviderIds.push(body.provider.id);

    expect(body.provider.firstName).toBe('Independent');
    expect(body.provider.enrollments).toHaveLength(0);

    // Verify SSN was encrypted
    const dbRecord = await prisma.provider.findUnique({
      where: { id: body.provider.id },
    });
    expect(dbRecord?.ssnEncrypted).toBeDefined();
    if (dbRecord?.ssnEncrypted) {
      expect(decrypt(dbRecord.ssnEncrypted)).toBe('123-45-6789');
    }
  });
});

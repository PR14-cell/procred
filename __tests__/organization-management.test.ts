import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db/prisma';
import { UserRole } from '@prisma/client';
import { createSessionToken } from '../src/lib/auth/jwt';
import { POST as createOrgRoute, GET as getOrgsRoute } from '../src/app/api/v1/organizations/route';
import {
  GET as getOrgDetailRoute,
  PATCH as updateOrgRoute,
  DELETE as deleteOrgRoute,
} from '../src/app/api/v1/organizations/[id]/route';
import {
  POST as associateProviderRoute,
  DELETE as disassociateProviderRoute,
} from '../src/app/api/v1/organizations/[id]/providers/route';
import { POST as createProviderRoute, GET as getProvidersRoute } from '../src/app/api/v1/providers/route';
import { POST as createEnrollmentRoute, GET as getEnrollmentsRoute } from '../src/app/api/v1/enrollments/route';
import { POST as createDocumentRoute, GET as getDocumentsRoute } from '../src/app/api/v1/documents/route';
import { BulkService } from '../src/lib/bulk/bulk-service';
import { OrganizationService } from '../src/lib/organizations/organization-service';
import { decrypt } from '../src/lib/encryption/aes';

describe('Provider Group / Organization Management — Many-to-Many Architecture', () => {
  let superAdminUser: any;
  let credSpecialistUser: any;
  let viewerUser: any;

  let superAdminToken: string;
  let credSpecialistToken: string;
  let viewerToken: string;

  let testPayer: any;
  const createdOrgIds: string[] = [];
  const createdProviderIds: string[] = [];
  const createdDocIds: string[] = [];
  const createdEnrollmentIds: string[] = [];

  beforeAll(async () => {
    // 1. Create or retrieve test users across roles
    superAdminUser = await prisma.user.upsert({
      where: { email: 'org_admin_test@example.com' },
      update: {},
      create: {
        email: 'org_admin_test@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Arthur',
        lastName: 'Admin',
        role: UserRole.super_admin,
      },
    });

    credSpecialistUser = await prisma.user.upsert({
      where: { email: 'org_specialist_test@example.com' },
      update: {},
      create: {
        email: 'org_specialist_test@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Sally',
        lastName: 'Specialist',
        role: UserRole.credentialing_specialist,
      },
    });

    viewerUser = await prisma.user.upsert({
      where: { email: 'org_viewer_test@example.com' },
      update: {},
      create: {
        email: 'org_viewer_test@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Victor',
        lastName: 'Viewer',
        role: UserRole.viewer,
      },
    });

    // 2. JWT session tokens and active database session rows
    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-org-admin' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: superAdminUser.id, sessionToken: 'sess-org-admin', expiresAt: new Date(Date.now() + 86400000) },
    });
    superAdminToken = await createSessionToken({
      userId: superAdminUser.id,
      email: superAdminUser.email,
      role: UserRole.super_admin,
      sessionId: 'sess-org-admin',
    });

    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-org-specialist' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: credSpecialistUser.id, sessionToken: 'sess-org-specialist', expiresAt: new Date(Date.now() + 86400000) },
    });
    credSpecialistToken = await createSessionToken({
      userId: credSpecialistUser.id,
      email: credSpecialistUser.email,
      role: UserRole.credentialing_specialist,
      sessionId: 'sess-org-specialist',
    });

    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-org-viewer' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: viewerUser.id, sessionToken: 'sess-org-viewer', expiresAt: new Date(Date.now() + 86400000) },
    });
    viewerToken = await createSessionToken({
      userId: viewerUser.id,
      email: viewerUser.email,
      role: UserRole.viewer,
      sessionId: 'sess-org-viewer',
    });

    // 3. Ensure test Payer exists
    testPayer = await prisma.payer.upsert({
      where: { id: '33333333-3333-3333-3333-333333333333' },
      update: { isActive: true },
      create: {
        id: '33333333-3333-3333-3333-333333333333',
        name: 'Aetna Health Fictional',
        shortName: 'AETNA',
        payerType: 'commercial',
        isActive: true,
      },
    });

    // 4. Clean up any previous test NPIs to guarantee idempotency
    const testNpis = ['9910001001', '9910001002', '9910001003', '9910001091', '9910001092'];
    const testOrgNpis = ['1982736450', '1827364519', '1928374655'];

    await prisma.providerOrganization.deleteMany({
      where: {
        OR: [
          { provider: { npiNumber: { in: testNpis } } },
          { organization: { npiNumber: { in: testOrgNpis } } },
        ],
      },
    });
    await prisma.payerEnrollment.deleteMany({
      where: {
        OR: [
          { provider: { npiNumber: { in: testNpis } } },
          { organization: { npiNumber: { in: testOrgNpis } } },
        ],
      },
    });
    await prisma.provider.deleteMany({
      where: { npiNumber: { in: testNpis } },
    });
    await prisma.organization.deleteMany({
      where: { npiNumber: { in: testOrgNpis } },
    });
  });

  afterAll(async () => {
    // Clean up created resources in reverse foreign-key dependency order
    if (createdEnrollmentIds.length > 0) {
      await prisma.enrollmentStatusHistory.deleteMany({
        where: { enrollmentId: { in: createdEnrollmentIds } },
      });
      await prisma.payerEnrollment.deleteMany({
        where: { id: { in: createdEnrollmentIds } },
      });
    }

    if (createdDocIds.length > 0) {
      await prisma.documentVersion.deleteMany({
        where: { documentId: { in: createdDocIds } },
      });
      await prisma.document.deleteMany({
        where: { id: { in: createdDocIds } },
      });
    }

    if (createdProviderIds.length > 0) {
      await prisma.providerOrganization.deleteMany({
        where: { providerId: { in: createdProviderIds } },
      });
      await prisma.providerSpecialty.deleteMany({
        where: { providerId: { in: createdProviderIds } },
      });
      await prisma.providerLocation.deleteMany({
        where: { providerId: { in: createdProviderIds } },
      });
      await prisma.provider.deleteMany({
        where: { id: { in: createdProviderIds } },
      });
    }

    if (createdOrgIds.length > 0) {
      await prisma.providerOrganization.deleteMany({
        where: { organizationId: { in: createdOrgIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
    }
  });

  // =========================================================================
  // 1. Create Organization with Tax ID Encryption & Masking
  // =========================================================================
  it('1. should create an organization with AES-256-GCM encrypted Tax ID and masked representation', async () => {
    const rawTaxId = '74-1234567';
    const payload = {
      name: 'Austin Medical Specialists P.A.',
      dbaName: 'Austin Specialists',
      npiNumber: '1982736450',
      taxId: rawTaxId,
      organizationType: 'medical_group',
      address1: '1200 S Congress Ave',
      city: 'Austin',
      state: 'TX',
      zipCode: '78704',
      phone: '(512) 555-0199',
      email: 'admin@austinspecialists.com',
      status: 'active',
    };

    const req = new Request('http://localhost/api/v1/organizations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${superAdminToken}`,
      },
      body: JSON.stringify(payload),
    });

    const res = await createOrgRoute(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.organization).toBeDefined();
    expect(body.organization.name).toBe('Austin Medical Specialists P.A.');
    expect(body.organization.npiNumber).toBe('1982736450');
    expect(body.organization.taxIdLastFour).toBe('4567');
    expect(body.organization.maskedTaxId).toBe('XX-XXX4567');
    expect(body.organization.taxId).toBeUndefined(); // Unmasked Tax ID is never returned by default

    createdOrgIds.push(body.organization.id);

    // Verify database record has encrypted bytea
    const dbOrg = await prisma.organization.findUnique({
      where: { id: body.organization.id },
    });
    expect(dbOrg?.taxIdEncrypted).not.toBeNull();
    if (dbOrg?.taxIdEncrypted) {
      expect(decrypt(dbOrg.taxIdEncrypted)).toBe('74-1234567');
    }

    // Verify GET /organizations/[id]?revealTaxId=true exposes decrypted Tax ID
    const revealReq = new Request(
      `http://localhost/api/v1/organizations/${body.organization.id}?revealTaxId=true`,
      {
        headers: { cookie: `session_token=${superAdminToken}` },
      }
    );
    const revealRes = await getOrgDetailRoute(revealReq, { params: { id: body.organization.id } });
    expect(revealRes.status).toBe(200);
    const revealBody = await revealRes.json();
    expect(revealBody.organization.taxId).toBe('74-1234567');
  });

  // =========================================================================
  // 2. Update Organization Details
  // =========================================================================
  it('2. should update organization details and record audit log', async () => {
    const orgId = createdOrgIds[0];
    const updatePayload = {
      dbaName: 'Austin Specialists Healthcare',
      phone: '(512) 555-9999',
      notes: 'Updated credentialing contact information',
    };

    const req = new Request(`http://localhost/api/v1/organizations/${orgId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${credSpecialistToken}`,
      },
      body: JSON.stringify(updatePayload),
    });

    const res = await updateOrgRoute(req, { params: { id: orgId } });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.organization.dbaName).toBe('Austin Specialists Healthcare');
    expect(body.organization.phone).toBe('(512) 555-9999');
    expect(body.organization.notes).toBe('Updated credentialing contact information');

    // Verify audit log exists
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: 'organization',
        entityId: orgId,
        action: 'ORGANIZATION_UPDATED',
      },
    });
    expect(audit).not.toBeNull();
  });

  // =========================================================================
  // 3. Search and Filter Organizations Directory
  // =========================================================================
  it('3. should search and filter the organizations directory with pagination', async () => {
    const req = new Request('http://localhost/api/v1/organizations?search=Austin&status=active', {
      headers: { cookie: `session_token=${superAdminToken}` },
    });

    const res = await getOrgsRoute(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.organizations).toBeDefined();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.organizations.some((o: any) => o.name.includes('Austin'))).toBe(true);
    expect(body.organizations[0].maskedTaxId).toBeDefined();
  });

  // =========================================================================
  // 4. Onboard Provider with Option A (Create New Group & Affiliate)
  // =========================================================================
  it('4. should onboard provider with Option A: create new group and atomically affiliate provider', async () => {
    const providerNpi = '9910001001';
    const groupNpi = '1827364519';

    const payload = {
      firstName: 'Emily',
      lastName: 'Carter',
      npiNumber: providerNpi,
      status: 'active',
      credentialingStatus: 'in_progress',
      organizationAffiliation: {
        mode: 'new',
        employmentType: 'employed',
        isPrimary: true,
        newOrganization: {
          name: 'Hill Country Health Partners',
          dbaName: 'Hill Country Clinic',
          npiNumber: groupNpi,
          taxId: '75-9876543',
          organizationType: 'medical_group',
          address1: '400 Medical Pkwy',
          city: 'Lakeway',
          state: 'TX',
          zipCode: '78734',
          phone: '(512) 555-4000',
        },
      },
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
    createdProviderIds.push(body.provider.id);

    // Verify organization was created
    const createdOrg = await prisma.organization.findUnique({
      where: { npiNumber: groupNpi },
    });
    expect(createdOrg).not.toBeNull();
    expect(createdOrg?.name).toBe('Hill Country Health Partners');
    if (createdOrg) createdOrgIds.push(createdOrg.id);

    // Verify affiliation was created with primary = true
    const affiliation = await prisma.providerOrganization.findUnique({
      where: {
        providerId_organizationId: {
          providerId: body.provider.id,
          organizationId: createdOrg!.id,
        },
      },
    });
    expect(affiliation).not.toBeNull();
    expect(affiliation?.isPrimary).toBe(true);
    expect(affiliation?.employmentType).toBe('employed');
  });

  // =========================================================================
  // 5. Onboard Provider with Option B (Select Existing Group)
  // =========================================================================
  it('5. should onboard provider with Option B: affiliate with existing group from directory', async () => {
    const existingOrgId = createdOrgIds[0];
    const providerNpi = '9910001002';

    const payload = {
      firstName: 'Marcus',
      lastName: 'Vance',
      npiNumber: providerNpi,
      status: 'active',
      credentialingStatus: 'in_progress',
      organizationAffiliation: {
        mode: 'existing',
        organizationId: existingOrgId,
        employmentType: 'contractor',
        isPrimary: true,
      },
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
    createdProviderIds.push(body.provider.id);

    // Verify affiliation
    const affiliation = await prisma.providerOrganization.findUnique({
      where: {
        providerId_organizationId: {
          providerId: body.provider.id,
          organizationId: existingOrgId,
        },
      },
    });
    expect(affiliation).not.toBeNull();
    expect(affiliation?.isPrimary).toBe(true);
    expect(affiliation?.employmentType).toBe('contractor');
  });

  // =========================================================================
  // 6. Onboard Provider with Option C (Individual / No Group)
  // =========================================================================
  it('6. should onboard provider with Option C: individual provider with zero organization affiliations', async () => {
    const providerNpi = '9910001003';
    const payload = {
      firstName: 'Solo',
      lastName: 'Practitioner',
      npiNumber: providerNpi,
      status: 'active',
      credentialingStatus: 'initial',
      organizationAffiliation: {
        mode: 'none',
      },
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
    createdProviderIds.push(body.provider.id);

    // Verify 0 affiliations exist for this provider
    const affiliations = await prisma.providerOrganization.findMany({
      where: { providerId: body.provider.id },
    });
    expect(affiliations).toHaveLength(0);
  });

  // =========================================================================
  // 7. Multiple Providers Affiliated with One Organization
  // =========================================================================
  it('7. should support multiple providers affiliated with one organization', async () => {
    const orgId = createdOrgIds[0];

    // Org 0 has provider 2 (Marcus Vance). Now affiliate provider 3 (Solo Practitioner)
    const providerId = createdProviderIds[2];

    const req = new Request(`http://localhost/api/v1/organizations/${orgId}/providers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${superAdminToken}`,
      },
      body: JSON.stringify({
        providerId,
        employmentType: 'affiliate',
        isPrimary: false,
      }),
    });

    const res = await associateProviderRoute(req, { params: { id: orgId } });
    expect(res.status).toBe(201);

    // Check organization roster count
    const detailReq = new Request(`http://localhost/api/v1/organizations/${orgId}`, {
      headers: { cookie: `session_token=${superAdminToken}` },
    });
    const detailRes = await getOrgDetailRoute(detailReq, { params: { id: orgId } });
    const detailBody = await detailRes.json();

    expect(detailBody.organization.providers.length).toBeGreaterThanOrEqual(2);
    expect(detailBody.organization._count.providers).toBeGreaterThanOrEqual(2);
  });

  // =========================================================================
  // 8. One Provider Affiliated with Multiple Organizations
  // =========================================================================
  it('8. should support one provider affiliated with multiple organizations', async () => {
    const providerId = createdProviderIds[1]; // Marcus Vance
    const secondOrgId = createdOrgIds[1]; // Hill Country Health

    const req = new Request(`http://localhost/api/v1/organizations/${secondOrgId}/providers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${superAdminToken}`,
      },
      body: JSON.stringify({
        providerId,
        employmentType: 'contractor',
        isPrimary: false,
      }),
    });

    const res = await associateProviderRoute(req, { params: { id: secondOrgId } });
    expect(res.status).toBe(201);

    // Verify provider is affiliated with both organizations
    const affiliations = await prisma.providerOrganization.findMany({
      where: { providerId },
    });
    expect(affiliations.length).toBe(2);
  });

  // =========================================================================
  // 9. Atomic Primary Affiliation Switching
  // =========================================================================
  it('9. should atomically switch primary affiliation without allowing duplicate primary flags', async () => {
    const providerId = createdProviderIds[1]; // Marcus Vance
    const firstOrgId = createdOrgIds[0];
    const secondOrgId = createdOrgIds[1];

    // Marcus was primary at firstOrgId, non-primary at secondOrgId.
    // Now switch Marcus to primary at secondOrgId:
    const req = new Request(`http://localhost/api/v1/organizations/${secondOrgId}/providers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${superAdminToken}`,
      },
      body: JSON.stringify({
        providerId,
        employmentType: 'contractor',
        isPrimary: true,
      }),
    });

    const res = await associateProviderRoute(req, { params: { id: secondOrgId } });
    expect(res.status).toBe(201);

    // Verify secondOrg is now primary
    const aff2 = await prisma.providerOrganization.findUnique({
      where: {
        providerId_organizationId: { providerId, organizationId: secondOrgId },
      },
    });
    expect(aff2?.isPrimary).toBe(true);

    // Verify firstOrg was atomically demoted to non-primary
    const aff1 = await prisma.providerOrganization.findUnique({
      where: {
        providerId_organizationId: { providerId, organizationId: firstOrgId },
      },
    });
    expect(aff1?.isPrimary).toBe(false);

    // Total primary affiliations for Marcus Vance must be exactly 1
    const primaryCount = await prisma.providerOrganization.count({
      where: { providerId, isPrimary: true },
    });
    expect(primaryCount).toBe(1);
  });

  // =========================================================================
  // 10. Disassociate Provider from Organization (Preserve Provider Record)
  // =========================================================================
  it('10. should disassociate provider from organization while leaving provider record intact', async () => {
    const providerId = createdProviderIds[2]; // Solo Practitioner affiliated in test 7
    const orgId = createdOrgIds[0];

    const req = new Request(
      `http://localhost/api/v1/organizations/${orgId}/providers?providerId=${providerId}`,
      {
        method: 'DELETE',
        headers: { cookie: `session_token=${superAdminToken}` },
      }
    );

    const res = await disassociateProviderRoute(req, { params: { id: orgId } });
    expect(res.status).toBe(200);

    // Join table row is gone
    const aff = await prisma.providerOrganization.findUnique({
      where: {
        providerId_organizationId: { providerId, organizationId: orgId },
      },
    });
    expect(aff).toBeNull();

    // Provider profile record remains completely intact
    const providerRecord = await prisma.provider.findUnique({
      where: { id: providerId },
    });
    expect(providerRecord).not.toBeNull();
    expect(providerRecord?.firstName).toBe('Solo');
  });

  // =========================================================================
  // 11. Organization Archival vs Hard Deletion Protection with Enrollments
  // =========================================================================
  it('11. should block hard deletion when active enrollments exist and permit safe archival', async () => {
    const orgId = createdOrgIds[0];
    const providerId = createdProviderIds[1];

    // Create an enrollment linked to this organization
    const enrollment = await prisma.payerEnrollment.create({
      data: {
        providerId,
        payerId: testPayer.id,
        organizationId: orgId,
        enrollmentType: 'group',
        applicationType: 'initial',
        status: 'submitted',
        createdById: superAdminUser.id,
      },
    });
    createdEnrollmentIds.push(enrollment.id);

    // Attempt hard deletion -> must be rejected
    const delReq = new Request(
      `http://localhost/api/v1/organizations/${orgId}?hardDelete=true`,
      {
        method: 'DELETE',
        headers: { cookie: `session_token=${superAdminToken}` },
      }
    );
    const delRes = await deleteOrgRoute(delReq, { params: { id: orgId } });
    expect(delRes.status).toBe(400);
    const delBody = await delRes.json();
    expect(delBody.message).toContain('payer enrollments');

    // Archive organization -> permitted safely
    const archiveReq = new Request(`http://localhost/api/v1/organizations/${orgId}`, {
      method: 'DELETE',
      headers: { cookie: `session_token=${superAdminToken}` },
    });
    const archiveRes = await deleteOrgRoute(archiveReq, { params: { id: orgId } });
    expect(archiveRes.status).toBe(200);

    const archivedOrg = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(archivedOrg?.status).toBe('archived');
  });

  // =========================================================================
  // 12. Hard Delete Organization when No Enrollments Exist
  // =========================================================================
  it('12. should hard delete organization without enrollments and preserve provider records', async () => {
    // Create temporary organization
    const tempOrg = await prisma.organization.create({
      data: {
        name: 'Temporary Clinic LLC',
        address1: '100 Temp Way',
        city: 'Dallas',
        state: 'TX',
        zipCode: '75001',
        status: 'active',
      },
    });

    const providerId = createdProviderIds[0];
    await prisma.providerOrganization.create({
      data: {
        providerId,
        organizationId: tempOrg.id,
        isPrimary: false,
      },
    });

    // Hard delete temp organization
    const req = new Request(
      `http://localhost/api/v1/organizations/${tempOrg.id}?hardDelete=true`,
      {
        method: 'DELETE',
        headers: { cookie: `session_token=${superAdminToken}` },
      }
    );
    const res = await deleteOrgRoute(req, { params: { id: tempOrg.id } });
    expect(res.status).toBe(200);

    // Organization is gone
    const checkOrg = await prisma.organization.findUnique({ where: { id: tempOrg.id } });
    expect(checkOrg).toBeNull();

    // Join rows removed via cascade
    const checkJoin = await prisma.providerOrganization.findMany({
      where: { organizationId: tempOrg.id },
    });
    expect(checkJoin).toHaveLength(0);

    // Provider record remains 100% intact
    const checkProvider = await prisma.provider.findUnique({ where: { id: providerId } });
    expect(checkProvider).not.toBeNull();
  });

  // =========================================================================
  // 13. Payer Enrollment Creation with organizationId & Auto-Populated groupNpi
  // =========================================================================
  it('13. should create payer enrollment with organizationId and auto-populate groupNpi', async () => {
    const orgId = createdOrgIds[1]; // Hill Country Health (Group NPI: 1827364519)
    const providerId = createdProviderIds[0];

    const payload = {
      providerId,
      payerId: testPayer.id,
      organizationId: orgId,
      enrollmentType: 'group',
      applicationType: 'initial',
      status: 'submitted',
    };

    const req = new Request('http://localhost/api/v1/enrollments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${superAdminToken}`,
      },
      body: JSON.stringify(payload),
    });

    const res = await createEnrollmentRoute(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    createdEnrollmentIds.push(body.enrollment.id);

    expect(body.enrollment.organizationId).toBe(orgId);
    expect(body.enrollment.groupNpi).toBe('1827364519'); // Auto-populated from Organization NPI

    // Filter enrollments by organizationId
    const filterReq = new Request(`http://localhost/api/v1/enrollments?organizationId=${orgId}`, {
      headers: { cookie: `session_token=${superAdminToken}` },
    });
    const filterRes = await getEnrollmentsRoute(filterReq);
    expect(filterRes.status).toBe(200);
    const filterBody = await filterRes.json();
    const items = filterBody.items || filterBody.enrollments || [];
    expect(items.some((e: any) => e.organizationId === orgId)).toBe(true);
  });

  // =========================================================================
  // 14. Organization Documents Isolation
  // =========================================================================
  it('14. should store organization documents in isolation without contaminating provider documents', async () => {
    const orgId = createdOrgIds[0];
    const providerId = createdProviderIds[0];

    // Upload organization document (W-9) with valid PDF magic bytes
    const dummyBase64 = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF'
    ).toString('base64');
    const docPayload = {
      title: 'Austin Specialists Form W-9',
      documentType: 'w9',
      entityType: 'organization',
      entityId: orgId,
      fileName: 'w9-austin.pdf',
      fileBase64: dummyBase64,
      mimeType: 'application/pdf',
      fileSizeBytes: 1024,
    };

    const req = new Request('http://localhost/api/v1/documents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${superAdminToken}`,
      },
      body: JSON.stringify(docPayload),
    });

    const res = await createDocumentRoute(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    createdDocIds.push(body.document.id);

    // Verify document appears under organization query
    const orgDocReq = new Request(
      `http://localhost/api/v1/documents?entityType=organization&entityId=${orgId}`,
      {
        headers: { cookie: `session_token=${superAdminToken}` },
      }
    );
    const orgDocRes = await getDocumentsRoute(orgDocReq);
    const orgDocBody = await orgDocRes.json();
    expect(orgDocBody.documents.some((d: any) => d.id === body.document.id)).toBe(true);

    // Verify document DOES NOT appear under provider documents query
    const provDocReq = new Request(
      `http://localhost/api/v1/documents?providerId=${providerId}`,
      {
        headers: { cookie: `session_token=${superAdminToken}` },
      }
    );
    const provDocRes = await getDocumentsRoute(provDocReq);
    const provDocBody = await provDocRes.json();
    expect(provDocBody.documents.some((d: any) => d.id === body.document.id)).toBe(false);
  });

  // =========================================================================
  // 15. CSV Import with Group Association and Deduplication
  // =========================================================================
  it('15. should import providers with group deduplication (multiple CSV rows -> exactly 1 organization)', async () => {
    const sharedGroupNpi = '1928374655';
    const csvData = `First Name,Last Name,NPI,Specialty,Email,Group Name,Group NPI,Group Tax ID
Carlos,Ramirez,9910001091,207Q00000X,carlos@baylor.org,Baylor Scott & White Health,${sharedGroupNpi},74-9988776
Angela,Davis,9910001092,207Q00000X,angela@baylor.org,Baylor Scott & White Health,${sharedGroupNpi},74-9988776`;

    // 1. Preview
    const preview = await BulkService.previewProviderImport(csvData);
    expect(preview.totalRows).toBe(2);
    expect(preview.validCount).toBe(2);
    expect(preview.invalidCount).toBe(0);

    // 2. Commit
    const commitResult = await BulkService.commitProviderImport({
      csvText: csvData,
      userId: superAdminUser.id,
      userEmail: superAdminUser.email,
    });

    expect(commitResult.success).toBe(true);
    expect(commitResult.importedCount).toBe(2);
    createdProviderIds.push(...commitResult.importedIds);

    // 3. Verify exactly ONE organization was created for this Group NPI
    const matchingOrgs = await prisma.organization.findMany({
      where: { npiNumber: sharedGroupNpi },
    });
    expect(matchingOrgs).toHaveLength(1);
    createdOrgIds.push(matchingOrgs[0].id);

    // 4. Verify both providers are affiliated with this single organization
    const affiliations = await prisma.providerOrganization.findMany({
      where: { organizationId: matchingOrgs[0].id },
    });
    expect(affiliations).toHaveLength(2);
  });

  // =========================================================================
  // 16. Server-Side RBAC Enforcement
  // =========================================================================
  it('16. should enforce RBAC: reject viewer write access with 403 and allow specialist/admin', async () => {
    const payload = {
      name: 'Unauthorized Group Attempt',
      address1: '123 Fake St',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
    };

    // Viewer -> 403 Forbidden
    const viewerReq = new Request('http://localhost/api/v1/organizations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${viewerToken}`,
      },
      body: JSON.stringify(payload),
    });

    const viewerRes = await createOrgRoute(viewerReq);
    expect(viewerRes.status).toBe(403);

    // Credentialing Specialist -> 201 Created
    const specialistReq = new Request('http://localhost/api/v1/organizations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session_token=${credSpecialistToken}`,
      },
      body: JSON.stringify(payload),
    });

    const specialistRes = await createOrgRoute(specialistReq);
    expect(specialistRes.status).toBe(201);
    const body = await specialistRes.json();
    createdOrgIds.push(body.organization.id);
  });

  // =========================================================================
  // 17. Immutable Audit Logging Verification
  // =========================================================================
  it('17. should record immutable audit logs for organization actions and reject log tampering', async () => {
    const orgId = createdOrgIds[0];

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entityType: 'organization',
        entityId: orgId,
      },
    });

    expect(auditLogs.length).toBeGreaterThanOrEqual(1);

    // Test Postgres database trigger preventing UPDATE or DELETE on audit_logs
    if (auditLogs.length > 0) {
      const logId = auditLogs[0].id;
      await expect(
        prisma.auditLog.update({
          where: { id: logId },
          data: { action: 'TAMPERED_ACTION' },
        })
      ).rejects.toThrow();

      await expect(
        prisma.auditLog.delete({
          where: { id: logId },
        })
      ).rejects.toThrow();
    }
  });
});

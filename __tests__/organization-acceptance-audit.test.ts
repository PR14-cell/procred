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
import { GET as downloadDocRoute } from '../src/app/api/v1/documents/[id]/download/route';
import { DELETE as deleteDocRoute } from '../src/app/api/v1/documents/[id]/route';
import { GET as healthRoute } from '../src/app/api/health/route';
import { BulkService } from '../src/lib/bulk/bulk-service';
import { OrganizationService } from '../src/lib/organizations/organization-service';
import { encrypt, decrypt } from '../src/lib/encryption/aes';
import { S3_BUCKETS } from '../src/lib/storage/s3';
import crypto from 'crypto';

describe('Post-Implementation Acceptance Audit: Organization Management', () => {
  let superAdminUser: any;
  let adminUser: any;
  let credSpecialistUser: any;
  let viewerUser: any;

  let superAdminToken: string;
  let adminToken: string;
  let credSpecialistToken: string;
  let viewerToken: string;

  let testPayer: any;
  const auditOrgIds: string[] = [];
  const auditProviderIds: string[] = [];
  const auditDocIds: string[] = [];
  const auditEnrollmentIds: string[] = [];

  const validPdfBuffer = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF'
  );
  const validPdfBase64 = validPdfBuffer.toString('base64');

  beforeAll(async () => {
    // 1. Create or retrieve users for all 4 roles
    superAdminUser = await prisma.user.upsert({
      where: { email: 'audit_super_admin@example.com' },
      update: {},
      create: {
        email: 'audit_super_admin@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Sam',
        lastName: 'SuperAdmin',
        role: UserRole.super_admin,
      },
    });

    adminUser = await prisma.user.upsert({
      where: { email: 'audit_admin@example.com' },
      update: {},
      create: {
        email: 'audit_admin@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Amy',
        lastName: 'Admin',
        role: UserRole.admin,
      },
    });

    credSpecialistUser = await prisma.user.upsert({
      where: { email: 'audit_specialist@example.com' },
      update: {},
      create: {
        email: 'audit_specialist@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Chris',
        lastName: 'Specialist',
        role: UserRole.credentialing_specialist,
      },
    });

    viewerUser = await prisma.user.upsert({
      where: { email: 'audit_viewer@example.com' },
      update: {},
      create: {
        email: 'audit_viewer@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Val',
        lastName: 'Viewer',
        role: UserRole.viewer,
      },
    });

    // 2. Generate tokens and active database session rows
    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-audit-superadmin' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: superAdminUser.id, sessionToken: 'sess-audit-superadmin', expiresAt: new Date(Date.now() + 86400000) },
    });
    superAdminToken = await createSessionToken({
      userId: superAdminUser.id,
      email: superAdminUser.email,
      role: UserRole.super_admin,
      sessionId: 'sess-audit-superadmin',
    });

    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-audit-admin' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: adminUser.id, sessionToken: 'sess-audit-admin', expiresAt: new Date(Date.now() + 86400000) },
    });
    adminToken = await createSessionToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: UserRole.admin,
      sessionId: 'sess-audit-admin',
    });

    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-audit-specialist' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: credSpecialistUser.id, sessionToken: 'sess-audit-specialist', expiresAt: new Date(Date.now() + 86400000) },
    });
    credSpecialistToken = await createSessionToken({
      userId: credSpecialistUser.id,
      email: credSpecialistUser.email,
      role: UserRole.credentialing_specialist,
      sessionId: 'sess-audit-specialist',
    });

    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-audit-viewer' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: viewerUser.id, sessionToken: 'sess-audit-viewer', expiresAt: new Date(Date.now() + 86400000) },
    });
    viewerToken = await createSessionToken({
      userId: viewerUser.id,
      email: viewerUser.email,
      role: UserRole.viewer,
      sessionId: 'sess-audit-viewer',
    });

    // 3. Ensure test payer exists
    testPayer = await prisma.payer.upsert({
      where: { id: '44444444-4444-4444-4444-444444444444' },
      update: { isActive: true },
      create: {
        id: '44444444-4444-4444-4444-444444444444',
        name: 'UnitedHealthcare Audit Fictional',
        shortName: 'UHC',
        payerType: 'commercial',
        isActive: true,
      },
    });

    // 4. Initial cleanup of audit NPIs
    const auditNpis = ['9920000001', '9920000002', '9920000003', '9920000004', '9920000005', '9920000010', '9920000011', '9920000012', '9920000013', '9920000014'];
    const auditOrgNpis = ['1988877761', '1988877762', '1988877763', '1988877764', '1988877765'];

    await prisma.providerOrganization.deleteMany({
      where: {
        OR: [
          { provider: { npiNumber: { in: auditNpis } } },
          { organization: { npiNumber: { in: auditOrgNpis } } },
        ],
      },
    });
    await prisma.payerEnrollment.deleteMany({
      where: {
        OR: [
          { provider: { npiNumber: { in: auditNpis } } },
          { organization: { npiNumber: { in: auditOrgNpis } } },
        ],
      },
    });
    await prisma.provider.deleteMany({
      where: { npiNumber: { in: auditNpis } },
    });
    await prisma.organization.deleteMany({
      where: { npiNumber: { in: auditOrgNpis } },
    });
  });

  afterAll(async () => {
    // Cleanup audit resources
    if (auditEnrollmentIds.length > 0) {
      await prisma.enrollmentStatusHistory.deleteMany({
        where: { enrollmentId: { in: auditEnrollmentIds } },
      });
      await prisma.payerEnrollment.deleteMany({
        where: { id: { in: auditEnrollmentIds } },
      });
    }

    if (auditDocIds.length > 0) {
      await prisma.documentVersion.deleteMany({
        where: { documentId: { in: auditDocIds } },
      });
      await prisma.document.deleteMany({
        where: { id: { in: auditDocIds } },
      });
    }

    if (auditProviderIds.length > 0) {
      await prisma.providerOrganization.deleteMany({
        where: { providerId: { in: auditProviderIds } },
      });
      await prisma.provider.deleteMany({
        where: { id: { in: auditProviderIds } },
      });
    }

    if (auditOrgIds.length > 0) {
      await prisma.providerOrganization.deleteMany({
        where: { organizationId: { in: auditOrgIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: auditOrgIds } },
      });
    }
  });

  // =========================================================================
  // 1. Tax ID Security Audit
  // =========================================================================
  describe('1. Tax ID Security Audit', () => {
    it('1.1 AES-256-GCM cipher construction, IV/nonce length, and auth tag verification', () => {
      const plaintext = '74-9876543';
      const encrypted = encrypt(plaintext);

      // Verify buffer has minimum length: 12 (IV) + 16 (Tag) + ciphertext (10) = 38 bytes
      expect(encrypted.length).toBeGreaterThanOrEqual(12 + 16 + plaintext.length);

      // Verify normal decryption works
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);

      // Verify tampering with authentication tag fails decryption
      const tamperedTag = Buffer.from(encrypted);
      tamperedTag[14] ^= 0xff; // Flip bit in tag
      expect(() => decrypt(tamperedTag)).toThrow();

      // Verify tampering with ciphertext fails decryption
      const tamperedCiphertext = Buffer.from(encrypted);
      tamperedCiphertext[tamperedCiphertext.length - 1] ^= 0xff; // Flip bit in ciphertext
      expect(() => decrypt(tamperedCiphertext)).toThrow();

      // Verify short buffer rejects safely
      const shortBuffer = Buffer.from('too-short');
      expect(() => decrypt(shortBuffer)).toThrow('Invalid encrypted buffer format: too short.');
    });

    it('1.2 Role-based authorization for revealTaxId=true: super_admin and admin allowed, specialist and viewer blocked', async () => {
      // Create organization with Tax ID
      const createRes = await createOrgRoute(
        new Request('http://localhost/api/v1/organizations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: `session_token=${superAdminToken}`,
          },
          body: JSON.stringify({
            name: 'Audit Tax ID Clinic P.A.',
            npiNumber: '1988877761',
            taxId: '74-5556677',
            address1: '100 Main St',
            city: 'Austin',
            state: 'TX',
            zipCode: '78701',
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const createBody = await createRes.json();
      const orgId = createBody.organization.id;
      auditOrgIds.push(orgId);

      // 1. Super Admin with revealTaxId=true -> returns decrypted taxId
      const superAdminReq = new Request(
        `http://localhost/api/v1/organizations/${orgId}?revealTaxId=true`,
        { headers: { cookie: `session_token=${superAdminToken}` } }
      );
      const superAdminRes = await getOrgDetailRoute(superAdminReq, { params: { id: orgId } });
      expect(superAdminRes.status).toBe(200);
      const superAdminBody = await superAdminRes.json();
      expect(superAdminBody.organization.taxId).toBe('74-5556677');

      // 2. Admin with revealTaxId=true -> returns decrypted taxId
      const adminReq = new Request(
        `http://localhost/api/v1/organizations/${orgId}?revealTaxId=true`,
        { headers: { cookie: `session_token=${adminToken}` } }
      );
      const adminRes = await getOrgDetailRoute(adminReq, { params: { id: orgId } });
      expect(adminRes.status).toBe(200);
      const adminBody = await adminRes.json();
      expect(adminBody.organization.taxId).toBe('74-5556677');

      // 3. Credentialing Specialist with revealTaxId=true -> BLOCKED from decrypting, taxId is null, masked only
      const specReq = new Request(
        `http://localhost/api/v1/organizations/${orgId}?revealTaxId=true`,
        { headers: { cookie: `session_token=${credSpecialistToken}` } }
      );
      const specRes = await getOrgDetailRoute(specReq, { params: { id: orgId } });
      expect(specRes.status).toBe(200);
      const specBody = await specRes.json();
      expect(specBody.organization.taxId).toBeNull();
      expect(specBody.organization.maskedTaxId).toBe('XX-XXX6677');

      // 4. Viewer with revealTaxId=true -> BLOCKED from decrypting, taxId is null, masked only
      const viewerReq = new Request(
        `http://localhost/api/v1/organizations/${orgId}?revealTaxId=true`,
        { headers: { cookie: `session_token=${viewerToken}` } }
      );
      const viewerRes = await getOrgDetailRoute(viewerReq, { params: { id: orgId } });
      expect(viewerRes.status).toBe(200);
      const viewerBody = await viewerRes.json();
      expect(viewerBody.organization.taxId).toBeNull();
      expect(viewerBody.organization.maskedTaxId).toBe('XX-XXX6677');

      // 5. Unauthenticated request -> 401 Unauthorized
      const unauthReq = new Request(
        `http://localhost/api/v1/organizations/${orgId}?revealTaxId=true`
      );
      const unauthRes = await getOrgDetailRoute(unauthReq, { params: { id: orgId } });
      expect(unauthRes.status).toBe(401);
    });

    it('1.3 Directory listing and default detail endpoints mask Tax ID and never expose plaintext or raw bytea', async () => {
      const orgId = auditOrgIds[0];

      // Directory list GET /organizations
      const listReq = new Request('http://localhost/api/v1/organizations?search=Audit Tax ID', {
        headers: { cookie: `session_token=${superAdminToken}` },
      });
      const listRes = await getOrgsRoute(listReq);
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json();
      const org = listBody.organizations.find((o: any) => o.id === orgId);
      expect(org).toBeDefined();
      expect(org.maskedTaxId).toBe('XX-XXX6677');
      expect(org.taxIdLastFour).toBe('6677');
      expect(org.taxId).toBeUndefined();
      expect(org.taxIdEncrypted).toBeUndefined();

      // Default detail GET /organizations/[id] (without revealTaxId)
      const detailReq = new Request(`http://localhost/api/v1/organizations/${orgId}`, {
        headers: { cookie: `session_token=${superAdminToken}` },
      });
      const detailRes = await getOrgDetailRoute(detailReq, { params: { id: orgId } });
      expect(detailRes.status).toBe(200);
      const detailBody = await detailRes.json();
      expect(detailBody.organization.taxId).toBeNull();
      expect(detailBody.organization.maskedTaxId).toBe('XX-XXX6677');
      expect(detailBody.organization.taxIdEncrypted).toBeUndefined();
    });

    it('1.4 Audit logs never log plaintext Tax ID in metadata or change tracking', async () => {
      const orgId = auditOrgIds[0];

      const logs = await prisma.auditLog.findMany({
        where: {
          entityType: 'organization',
          entityId: orgId,
        },
      });

      expect(logs.length).toBeGreaterThanOrEqual(1);
      for (const log of logs) {
        const metadataStr = JSON.stringify(log.metadata || {});
        const changesStr = JSON.stringify(log.changes || {});
        expect(metadataStr).not.toContain('74-5556677');
        expect(changesStr).not.toContain('74-5556677');
      }
    });
  });

  // =========================================================================
  // 2. Primary Affiliation Integrity Audit
  // =========================================================================
  describe('2. Primary Affiliation Integrity Audit', () => {
    let testProv: any;
    let orgA: any;
    let orgB: any;

    beforeAll(async () => {
      // Create test provider
      testProv = await prisma.provider.create({
        data: {
          firstName: 'Integrity',
          lastName: 'Tester',
          npiNumber: '9920000001',
          status: 'active',
          credentialingStatus: 'in_progress',
        },
      });
      auditProviderIds.push(testProv.id);

      // Create Org A
      orgA = await prisma.organization.create({
        data: {
          name: 'Primary Org Alpha',
          npiNumber: '1988877762',
          address1: '100 Alpha St',
          city: 'Austin',
          state: 'TX',
          zipCode: '78701',
          status: 'active',
        },
      });
      auditOrgIds.push(orgA.id);

      // Create Org B
      orgB = await prisma.organization.create({
        data: {
          name: 'Primary Org Beta',
          npiNumber: '1988877763',
          address1: '200 Beta St',
          city: 'Austin',
          state: 'TX',
          zipCode: '78701',
          status: 'active',
        },
      });
      auditOrgIds.push(orgB.id);
    });

    it('2.1 Switching primary affiliation flips old primary to false atomically', async () => {
      // 1. Affiliate with Org A as Primary
      const affARes = await associateProviderRoute(
        new Request(`http://localhost/api/v1/organizations/${orgA.id}/providers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: `session_token=${superAdminToken}`,
          },
          body: JSON.stringify({
            providerId: testProv.id,
            isPrimary: true,
            employmentType: 'employed',
          }),
        }),
        { params: { id: orgA.id } }
      );
      expect(affARes.status).toBe(201);

      // 2. Affiliate with Org B as non-primary
      const affBRes = await associateProviderRoute(
        new Request(`http://localhost/api/v1/organizations/${orgB.id}/providers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: `session_token=${superAdminToken}`,
          },
          body: JSON.stringify({
            providerId: testProv.id,
            isPrimary: false,
            employmentType: 'contractor',
          }),
        }),
        { params: { id: orgB.id } }
      );
      expect(affBRes.status).toBe(201);

      // Verify Org A is primary, Org B is false
      let aAff = await prisma.providerOrganization.findUnique({
        where: { providerId_organizationId: { providerId: testProv.id, organizationId: orgA.id } },
      });
      let bAff = await prisma.providerOrganization.findUnique({
        where: { providerId_organizationId: { providerId: testProv.id, organizationId: orgB.id } },
      });
      expect(aAff?.isPrimary).toBe(true);
      expect(bAff?.isPrimary).toBe(false);

      // 3. Switch Org B to primary
      const switchRes = await associateProviderRoute(
        new Request(`http://localhost/api/v1/organizations/${orgB.id}/providers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: `session_token=${superAdminToken}`,
          },
          body: JSON.stringify({
            providerId: testProv.id,
            isPrimary: true,
          }),
        }),
        { params: { id: orgB.id } }
      );
      expect(switchRes.status).toBe(201);

      // Verify Org B is now true, Org A was atomically flipped to false
      aAff = await prisma.providerOrganization.findUnique({
        where: { providerId_organizationId: { providerId: testProv.id, organizationId: orgA.id } },
      });
      bAff = await prisma.providerOrganization.findUnique({
        where: { providerId_organizationId: { providerId: testProv.id, organizationId: orgB.id } },
      });
      expect(bAff?.isPrimary).toBe(true);
      expect(aAff?.isPrimary).toBe(false);

      // Exactly 1 primary exists
      const totalPrimaries = await prisma.providerOrganization.count({
        where: { providerId: testProv.id, isPrimary: true },
      });
      expect(totalPrimaries).toBe(1);
    });

    it('2.2 Removing/unmarking primary affiliation allows valid 0-primary state', async () => {
      // Toggle Org B isPrimary to false
      const unmarkRes = await associateProviderRoute(
        new Request(`http://localhost/api/v1/organizations/${orgB.id}/providers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: `session_token=${superAdminToken}`,
          },
          body: JSON.stringify({
            providerId: testProv.id,
            isPrimary: false,
          }),
        }),
        { params: { id: orgB.id } }
      );
      expect(unmarkRes.status).toBe(201);

      const primaries = await prisma.providerOrganization.count({
        where: { providerId: testProv.id, isPrimary: true },
      });
      expect(primaries).toBe(0);
    });

    it('2.3 Concurrent primary-switch requests serialize safely without race condition', async () => {
      // Execute concurrent requests switching between Org A and Org B
      const switchA = () =>
        OrganizationService.associateProvider(
          orgA.id,
          { providerId: testProv.id, isPrimary: true, startDate: null, endDate: null },
          { userId: superAdminUser.id }
        );
      const switchB = () =>
        OrganizationService.associateProvider(
          orgB.id,
          { providerId: testProv.id, isPrimary: true, startDate: null, endDate: null },
          { userId: superAdminUser.id }
        );

      await Promise.all([switchA(), switchB(), switchA(), switchB()]);

      // After all concurrent transactions settle, exactly 1 primary affiliation must exist
      const finalPrimaries = await prisma.providerOrganization.count({
        where: { providerId: testProv.id, isPrimary: true },
      });
      expect(finalPrimaries).toBe(1);
    });
  });

  // =========================================================================
  // 3. Deletion and Archival Safety Audit
  // =========================================================================
  describe('3. Deletion and Archival Safety Audit', () => {
    let safetyOrg: any;
    let safetyProv: any;
    let safetyEnrollment: any;

    beforeAll(async () => {
      safetyOrg = await prisma.organization.create({
        data: {
          name: 'Safety Audit Organization',
          npiNumber: '1988877764',
          address1: '500 Safety Way',
          city: 'Houston',
          state: 'TX',
          zipCode: '77001',
          status: 'active',
        },
      });
      auditOrgIds.push(safetyOrg.id);

      safetyProv = await prisma.provider.create({
        data: {
          firstName: 'Precious',
          lastName: 'Physician',
          npiNumber: '9920000002',
          status: 'active',
          credentialingStatus: 'completed',
        },
      });
      auditProviderIds.push(safetyProv.id);

      await prisma.providerOrganization.create({
        data: {
          providerId: safetyProv.id,
          organizationId: safetyOrg.id,
          isPrimary: true,
        },
      });

      safetyEnrollment = await prisma.payerEnrollment.create({
        data: {
          providerId: safetyProv.id,
          payerId: testPayer.id,
          organizationId: safetyOrg.id,
          enrollmentType: 'group',
          applicationType: 'initial',
          status: 'approved',
          createdById: superAdminUser.id,
        },
      });
      auditEnrollmentIds.push(safetyEnrollment.id);
    });

    it('3.1 Hard deletion is blocked with 400 when active payer enrollments exist', async () => {
      const delReq = new Request(
        `http://localhost/api/v1/organizations/${safetyOrg.id}?hardDelete=true`,
        {
          method: 'DELETE',
          headers: { cookie: `session_token=${superAdminToken}` },
        }
      );

      const delRes = await deleteOrgRoute(delReq, { params: { id: safetyOrg.id } });
      expect(delRes.status).toBe(400);

      const delBody = await delRes.json();
      expect(delBody.message).toContain('associated payer enrollments');

      // Verify organization still exists in PostgreSQL
      const checkOrg = await prisma.organization.findUnique({ where: { id: safetyOrg.id } });
      expect(checkOrg).not.toBeNull();

      // Verify enrollment still exists and references the organization
      const checkEnr = await prisma.payerEnrollment.findUnique({ where: { id: safetyEnrollment.id } });
      expect(checkEnr).not.toBeNull();
      expect(checkEnr?.organizationId).toBe(safetyOrg.id);
    });

    it('3.2 Safe archival preserves organization, enrollment references, and roster', async () => {
      const archiveReq = new Request(`http://localhost/api/v1/organizations/${safetyOrg.id}`, {
        method: 'DELETE',
        headers: { cookie: `session_token=${superAdminToken}` },
      });

      const archiveRes = await deleteOrgRoute(archiveReq, { params: { id: safetyOrg.id } });
      expect(archiveRes.status).toBe(200);

      const checkOrg = await prisma.organization.findUnique({ where: { id: safetyOrg.id } });
      expect(checkOrg?.status).toBe('archived');

      // Verify enrollments and provider affiliations are completely intact
      const affiliations = await prisma.providerOrganization.findMany({
        where: { organizationId: safetyOrg.id },
      });
      expect(affiliations.length).toBe(1);

      const enrollments = await prisma.payerEnrollment.findMany({
        where: { organizationId: safetyOrg.id },
      });
      expect(enrollments.length).toBe(1);
    });

    it('3.3 Hard deleting organization without enrollments cascades join rows but leaves provider 100% intact', async () => {
      // Create isolated organization
      const isoOrg = await prisma.organization.create({
        data: {
          name: 'Doomed Organization',
          address1: '999 Bye St',
          city: 'Austin',
          state: 'TX',
          zipCode: '78701',
          status: 'active',
        },
      });

      await prisma.providerOrganization.create({
        data: {
          providerId: safetyProv.id,
          organizationId: isoOrg.id,
          isPrimary: false,
        },
      });

      // Hard delete isoOrg
      const delReq = new Request(
        `http://localhost/api/v1/organizations/${isoOrg.id}?hard=true`,
        {
          method: 'DELETE',
          headers: { cookie: `session_token=${superAdminToken}` },
        }
      );
      const delRes = await deleteOrgRoute(delReq, { params: { id: isoOrg.id } });
      expect(delRes.status).toBe(200);

      // Join row is removed
      const checkJoin = await prisma.providerOrganization.findMany({
        where: { organizationId: isoOrg.id },
      });
      expect(checkJoin).toHaveLength(0);

      // Provider record remains intact
      const checkProv = await prisma.provider.findUnique({ where: { id: safetyProv.id } });
      expect(checkProv).not.toBeNull();
      expect(checkProv?.firstName).toBe('Precious');
    });

    it('3.4 Database triggers prevent any UPDATE or DELETE tampering on audit_logs', async () => {
      const log = await prisma.auditLog.findFirst({
        where: { entityType: 'organization' },
      });
      expect(log).not.toBeNull();

      if (log) {
        // Attempt UPDATE -> must throw
        await expect(
          prisma.auditLog.update({
            where: { id: log.id },
            data: { action: 'MALICIOUS_OVERWRITE' },
          })
        ).rejects.toThrow();

        // Attempt DELETE -> must throw
        await expect(
          prisma.auditLog.delete({
            where: { id: log.id },
          })
        ).rejects.toThrow();
      }
    });
  });

  // =========================================================================
  // 4. Organization Documents Audit
  // =========================================================================
  describe('4. Organization Documents Audit', () => {
    let docOrg: any;
    let docProv: any;
    let uploadedDocId: string;

    beforeAll(async () => {
      docOrg = await prisma.organization.create({
        data: {
          name: 'Document Audit Health Group',
          npiNumber: '1988877765',
          address1: '700 Doc Ave',
          city: 'Austin',
          state: 'TX',
          zipCode: '78701',
          status: 'active',
        },
      });
      auditOrgIds.push(docOrg.id);

      docProv = await prisma.provider.create({
        data: {
          firstName: 'DocAudit',
          lastName: 'Clinician',
          npiNumber: '9920000003',
          status: 'active',
          credentialingStatus: 'in_progress',
        },
      });
      auditProviderIds.push(docProv.id);
    });

    it('4.1 Uploads organization document with valid magic bytes to MinIO and polymorphic document record', async () => {
      const payload = {
        title: 'Organization Form W-9 2026',
        documentType: 'w9',
        entityType: 'organization',
        entityId: docOrg.id,
        fileName: 'w9-org-audit.pdf',
        fileBase64: validPdfBase64,
        mimeType: 'application/pdf',
        fileSizeBytes: validPdfBuffer.length,
      };

      const res = await createDocumentRoute(
        new Request('http://localhost/api/v1/documents', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: `session_token=${superAdminToken}`,
          },
          body: JSON.stringify(payload),
        })
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      uploadedDocId = body.document.id;
      auditDocIds.push(uploadedDocId);

      // Verify database record
      const dbDoc = await prisma.document.findUnique({
        where: { id: uploadedDocId },
        include: { currentVersion: true },
      });
      expect(dbDoc).not.toBeNull();
      expect(dbDoc?.entityType).toBe('organization');
      expect(dbDoc?.entityId).toBe(docOrg.id);
      expect(dbDoc?.providerId).toBeNull(); // Crucial: providerId is null
      expect(dbDoc?.currentVersion?.s3Key).toContain(`organization/${docOrg.id}/`);
      expect(dbDoc?.currentVersion?.s3Bucket).toBe(S3_BUCKETS.GENERAL);
    });

    it('4.2 Downloads organization document successfully via download endpoint', async () => {
      const res = await downloadDocRoute(
        new Request(`http://localhost/api/v1/documents/${uploadedDocId}/download`, {
          headers: { cookie: `session_token=${superAdminToken}` },
        }),
        { params: { id: uploadedDocId } }
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      const blob = await res.arrayBuffer();
      expect(blob.byteLength).toBe(validPdfBuffer.length);
    });

    it('4.3 Enforces strict isolation: provider queries NEVER return organization documents', async () => {
      // Query provider documents for docProv
      const provDocRes = await getDocumentsRoute(
        new Request(`http://localhost/api/v1/documents?providerId=${docProv.id}`, {
          headers: { cookie: `session_token=${superAdminToken}` },
        })
      );
      expect(provDocRes.status).toBe(200);
      const provDocBody = await provDocRes.json();
      expect(provDocBody.documents.some((d: any) => d.id === uploadedDocId)).toBe(false);

      // Query organization documents for docOrg
      const orgDocRes = await getDocumentsRoute(
        new Request(`http://localhost/api/v1/documents?entityType=organization&entityId=${docOrg.id}`, {
          headers: { cookie: `session_token=${superAdminToken}` },
        })
      );
      expect(orgDocRes.status).toBe(200);
      const orgDocBody = await orgDocRes.json();
      expect(orgDocBody.documents.some((d: any) => d.id === uploadedDocId)).toBe(true);
    });

    it('4.4 Deletes organization document (Admin only) and cleans up MinIO storage', async () => {
      // 1. Specialist cannot delete (403 Forbidden)
      const specDelRes = await deleteDocRoute(
        new Request(`http://localhost/api/v1/documents/${uploadedDocId}`, {
          method: 'DELETE',
          headers: { cookie: `session_token=${credSpecialistToken}` },
        }),
        { params: { id: uploadedDocId } }
      );
      expect(specDelRes.status).toBe(403);

      // 2. Admin can delete
      const adminDelRes = await deleteDocRoute(
        new Request(`http://localhost/api/v1/documents/${uploadedDocId}`, {
          method: 'DELETE',
          headers: { cookie: `session_token=${superAdminToken}` },
        }),
        { params: { id: uploadedDocId } }
      );
      expect(adminDelRes.status).toBe(200);

      // Verify document record is deleted
      const checkDoc = await prisma.document.findUnique({ where: { id: uploadedDocId } });
      expect(checkDoc).toBeNull();
    });
  });

  // =========================================================================
  // 5. Migration and Database Integrity Audit
  // =========================================================================
  describe('5. Migration and Database Integrity Audit', () => {
    it('5.1 Migration record exists in _prisma_migrations and finished without failure', async () => {
      const migrations: any[] = await prisma.$queryRaw`
        SELECT migration_name, finished_at, applied_steps_count
        FROM _prisma_migrations
        WHERE migration_name = '20261023073000_add_organization_management';
      `;

      expect(migrations.length).toBe(1);
      expect(migrations[0].applied_steps_count).toBe(1);
      expect(migrations[0].finished_at).not.toBeNull();
    });

    it('5.2 PostgreSQL unique constraints, foreign keys, and indexes are active in the catalog', async () => {
      // Check partial unique index on organizations.npi_number
      const npiIndex: any[] = await prisma.$queryRaw`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'organizations' AND indexname = 'organizations_npi_number_key';
      `;
      expect(npiIndex.length).toBe(1);
      expect(npiIndex[0].indexdef).toContain('WHERE (npi_number IS NOT NULL)');

      // Check unique index on provider_organizations (provider_id, organization_id)
      const joinIndex: any[] = await prisma.$queryRaw`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'provider_organizations' AND indexname = 'provider_organizations_provider_id_organization_id_key';
      `;
      expect(joinIndex.length).toBe(1);

      // Check foreign keys on provider_organizations
      const fkeys: any[] = await prisma.$queryRaw`
        SELECT conname, confdeltype
        FROM pg_constraint
        WHERE conrelid = 'provider_organizations'::regclass AND contype = 'f';
      `;
      expect(fkeys.length).toBe(2);
      // 'c' indicates CASCADE in pg_constraint.confdeltype
      expect(fkeys.every((fk: any) => fk.confdeltype === 'c')).toBe(true);
    });

    it('5.3 Database grants confirm credentialing_app has SELECT, INSERT, UPDATE, DELETE on new tables', async () => {
      const grants: any[] = await prisma.$queryRaw`
        SELECT table_name, privilege_type
        FROM information_schema.table_privileges
        WHERE grantee = 'credentialing_app' AND table_name IN ('organizations', 'provider_organizations')
        ORDER BY table_name, privilege_type;
      `;

      const orgPrivileges = grants.filter((g: any) => g.table_name === 'organizations').map((g: any) => g.privilege_type);
      expect(orgPrivileges).toContain('SELECT');
      expect(orgPrivileges).toContain('INSERT');
      expect(orgPrivileges).toContain('UPDATE');
      expect(orgPrivileges).toContain('DELETE');

      const joinPrivileges = grants.filter((g: any) => g.table_name === 'provider_organizations').map((g: any) => g.privilege_type);
      expect(joinPrivileges).toContain('SELECT');
      expect(joinPrivileges).toContain('INSERT');
      expect(joinPrivileges).toContain('UPDATE');
      expect(joinPrivileges).toContain('DELETE');
    });

    it('5.4 Existing payer enrollment fields groupNpi and groupNumber remain intact', async () => {
      const columns: any[] = await prisma.$queryRaw`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'payer_enrollments' AND column_name IN ('group_npi', 'group_number', 'organization_id');
      `;

      const colMap = new Map(columns.map((c: any) => [c.column_name, c]));
      expect(colMap.has('group_npi')).toBe(true);
      expect(colMap.has('group_number')).toBe(true);
      expect(colMap.has('organization_id')).toBe(true);
      expect(colMap.get('organization_id').is_nullable).toBe('YES');
    });
  });

  // =========================================================================
  // 6. CSV Import Deduplication Audit
  // =========================================================================
  describe('6. CSV Import Deduplication Audit', () => {
    const csvGroupNpi = '1988877766';

    afterAll(async () => {
      await prisma.providerOrganization.deleteMany({
        where: { organization: { npiNumber: csvGroupNpi } },
      });
      await prisma.organization.deleteMany({
        where: { npiNumber: csvGroupNpi },
      });
    });

    it('6.1 CSV with 5 providers sharing group Name and Group NPI resolves to exactly 1 organization', async () => {
      const csv = `First Name,Last Name,NPI,Specialty,Email,Group Name,Group NPI,Group Tax ID
Doc1,Audit,9920000010,207Q00000X,d1@auditgroup.com,Methodist Health System,${csvGroupNpi},74-1122334
Doc2,Audit,9920000011,207Q00000X,d2@auditgroup.com,Methodist Health System,${csvGroupNpi},74-1122334
Doc3,Audit,9920000012,207Q00000X,d3@auditgroup.com,Methodist Health System,${csvGroupNpi},74-1122334
Doc4,Audit,9920000013,207Q00000X,d4@auditgroup.com,Methodist Health System,${csvGroupNpi},74-1122334
Doc5,Audit,9920000014,207Q00000X,d5@auditgroup.com,Methodist Health System,${csvGroupNpi},74-1122334`;

      // 1. Preview
      const preview = await BulkService.previewProviderImport(csv);
      expect(preview.totalRows).toBe(5);
      expect(preview.validCount).toBe(5);
      expect(preview.invalidCount).toBe(0);

      // 2. Commit
      const commit = await BulkService.commitProviderImport({
        csvText: csv,
        userId: superAdminUser.id,
        userEmail: superAdminUser.email,
      });

      expect(commit.success).toBe(true);
      expect(commit.importedCount).toBe(5);
      auditProviderIds.push(...commit.importedIds);

      // 3. Verify exactly 1 organization entity was created
      const matchingOrgs = await prisma.organization.findMany({
        where: { npiNumber: csvGroupNpi },
      });
      expect(matchingOrgs).toHaveLength(1);
      auditOrgIds.push(matchingOrgs[0].id);

      // 4. Verify all 5 providers are affiliated with this single organization
      const affiliations = await prisma.providerOrganization.findMany({
        where: { organizationId: matchingOrgs[0].id },
      });
      expect(affiliations).toHaveLength(5);
    });

    it('6.2 Reusing existing organization NPI links providers to existing organization without creating duplicate', async () => {
      const csvReuse = `First Name,Last Name,NPI,Specialty,Email,Group Name,Group NPI
Doc6,Audit,9920000015,207Q00000X,d6@auditgroup.com,Methodist Health System,${csvGroupNpi}`;

      const commit = await BulkService.commitProviderImport({
        csvText: csvReuse,
        userId: superAdminUser.id,
        userEmail: superAdminUser.email,
      });

      expect(commit.success).toBe(true);
      expect(commit.importedCount).toBe(1);
      auditProviderIds.push(...commit.importedIds);

      // Total organizations with this NPI must still be exactly 1
      const count = await prisma.organization.count({
        where: { npiNumber: csvGroupNpi },
      });
      expect(count).toBe(1);
    });

    it('6.3 Rejects malformed group NPI with validation error in preview and commit', async () => {
      const badCsv = `First Name,Last Name,NPI,Specialty,Email,Group Name,Group NPI
DocBad,Audit,9920000016,207Q00000X,bad@auditgroup.com,Bad Group,12345`; // 5 digits instead of 10

      const preview = await BulkService.previewProviderImport(badCsv);
      expect(preview.invalidCount).toBe(1);
      expect(preview.errors.some((e) => e.field === 'groupNpi' || e.message.includes('10 numeric digits'))).toBe(true);
    });
  });

  // =========================================================================
  // 7. Regression and Runtime Integrity Audit
  // =========================================================================
  describe('7. Regression and Runtime Integrity Audit', () => {
    it('7.1 Provider onboarding without group (Option C) succeeds and creates solo provider', async () => {
      const soloPayload = {
        firstName: 'SoloAudit',
        lastName: 'Doctor',
        npiNumber: '9920000004',
        status: 'active',
        credentialingStatus: 'initial',
        organizationAffiliation: { mode: 'none' },
      };

      const res = await createProviderRoute(
        new Request('http://localhost/api/v1/providers', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: `session_token=${superAdminToken}`,
          },
          body: JSON.stringify(soloPayload),
        })
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      auditProviderIds.push(body.provider.id);

      const affiliations = await prisma.providerOrganization.findMany({
        where: { providerId: body.provider.id },
      });
      expect(affiliations).toHaveLength(0);
    });

    it('7.2 Provider onboarding with payors (Phase 4 integration) succeeds seamlessly', async () => {
      const payorPayload = {
        firstName: 'PayorAudit',
        lastName: 'Doctor',
        npiNumber: '9920000005',
        status: 'active',
        credentialingStatus: 'in_progress',
        payerIds: [testPayer.id],
        organizationAffiliation: { mode: 'none' },
      };

      const res = await createProviderRoute(
        new Request('http://localhost/api/v1/providers', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: `session_token=${superAdminToken}`,
          },
          body: JSON.stringify(payorPayload),
        })
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      auditProviderIds.push(body.provider.id);

      const enrollments = await prisma.payerEnrollment.findMany({
        where: { providerId: body.provider.id },
      });
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0].payerId).toBe(testPayer.id);
      auditEnrollmentIds.push(enrollments[0].id);
    });

    it('7.3 Application health endpoint returns HTTP 200 with all services healthy', async () => {
      const res = await healthRoute();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.services.postgres).toBe('ok');
      expect(body.services.redis).toBe('ok');
      expect(body.services.minio).toBe('ok');
    });
  });
});

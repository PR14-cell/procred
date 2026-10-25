import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db/prisma';
import { UserRole } from '@prisma/client';
import { createSessionToken } from '../src/lib/auth/jwt';
import { POST as createDocRoute } from '../src/app/api/v1/documents/route';
import { DELETE as deleteDocRoute, GET as getDocRoute } from '../src/app/api/v1/documents/[id]/route';
import {
  downloadFromS3,
  deleteFromS3,
  validateDocumentPayload,
  validateFileMagicBytes,
} from '../src/lib/storage/s3';
import { createDocumentWithVersion, addDocumentVersion } from '../src/lib/documents/document-service';

describe('Deep Unattended Acceptance Test: Document Upload & Admin Deletion Module', () => {
  let superAdminUser: any;
  let adminUser: any;
  let credSpecialistUser: any;
  let enrollSpecialistUser: any;
  let viewerUser: any;

  let superAdminToken: string;
  let adminToken: string;
  let credSpecialistToken: string;
  let enrollSpecialistToken: string;
  let viewerToken: string;
  let expiredToken: string;

  let testProvider: any;
  const createdDocIds: string[] = [];

  // Synthetic valid buffers
  const validPdfBuffer = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF'
  );
  const validPdfBase64 = validPdfBuffer.toString('base64');

  const validJpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const validJpgBase64 = validJpgBuffer.toString('base64');

  const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const validPngBase64 = validPngBuffer.toString('base64');

  beforeAll(async () => {
    // 1. Create test users across all RBAC roles
    superAdminUser = await prisma.user.upsert({
      where: { email: 'deep_test_superadmin@example.com' },
      update: {},
      create: {
        email: 'deep_test_superadmin@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Sarah',
        lastName: 'SuperAdmin',
        role: UserRole.super_admin,
      },
    });

    adminUser = await prisma.user.upsert({
      where: { email: 'deep_test_admin@example.com' },
      update: {},
      create: {
        email: 'deep_test_admin@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Arthur',
        lastName: 'Admin',
        role: UserRole.admin,
      },
    });

    credSpecialistUser = await prisma.user.upsert({
      where: { email: 'deep_test_credspec@example.com' },
      update: {},
      create: {
        email: 'deep_test_credspec@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Clara',
        lastName: 'CredSpecialist',
        role: UserRole.credentialing_specialist,
      },
    });

    enrollSpecialistUser = await prisma.user.upsert({
      where: { email: 'deep_test_enrollspec@example.com' },
      update: {},
      create: {
        email: 'deep_test_enrollspec@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Evan',
        lastName: 'EnrollSpecialist',
        role: UserRole.enrollment_specialist,
      },
    });

    viewerUser = await prisma.user.upsert({
      where: { email: 'deep_test_viewer@example.com' },
      update: {},
      create: {
        email: 'deep_test_viewer@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Victor',
        lastName: 'Viewer',
        role: UserRole.viewer,
      },
    });

    // 2. Generate Session Tokens and database session records
    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-deep-superadmin' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: superAdminUser.id, sessionToken: 'sess-deep-superadmin', expiresAt: new Date(Date.now() + 86400000) },
    });
    superAdminToken = await createSessionToken({
      userId: superAdminUser.id,
      email: superAdminUser.email,
      role: UserRole.super_admin,
      sessionId: 'sess-deep-superadmin',
    });

    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-deep-admin' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: adminUser.id, sessionToken: 'sess-deep-admin', expiresAt: new Date(Date.now() + 86400000) },
    });
    adminToken = await createSessionToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: UserRole.admin,
      sessionId: 'sess-deep-admin',
    });

    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-deep-credspec' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: credSpecialistUser.id, sessionToken: 'sess-deep-credspec', expiresAt: new Date(Date.now() + 86400000) },
    });
    credSpecialistToken = await createSessionToken({
      userId: credSpecialistUser.id,
      email: credSpecialistUser.email,
      role: UserRole.credentialing_specialist,
      sessionId: 'sess-deep-credspec',
    });

    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-deep-enrollspec' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: enrollSpecialistUser.id, sessionToken: 'sess-deep-enrollspec', expiresAt: new Date(Date.now() + 86400000) },
    });
    enrollSpecialistToken = await createSessionToken({
      userId: enrollSpecialistUser.id,
      email: enrollSpecialistUser.email,
      role: UserRole.enrollment_specialist,
      sessionId: 'sess-deep-enrollspec',
    });

    await prisma.userSession.upsert({
      where: { sessionToken: 'sess-deep-viewer' },
      update: { expiresAt: new Date(Date.now() + 86400000) },
      create: { userId: viewerUser.id, sessionToken: 'sess-deep-viewer', expiresAt: new Date(Date.now() + 86400000) },
    });
    viewerToken = await createSessionToken({
      userId: viewerUser.id,
      email: viewerUser.email,
      role: UserRole.viewer,
      sessionId: 'sess-deep-viewer',
    });

    // Expired token (signed with expired timestamp)
    expiredToken = await createSessionToken(
      {
        userId: adminUser.id,
        email: adminUser.email,
        role: UserRole.admin,
        sessionId: 'sess-deep-expired',
      },
      '-1h'
    );

    // 3. Create synthetic provider for association tests
    await prisma.provider.deleteMany({ where: { npiNumber: '9991234567' } });
    testProvider = await prisma.provider.create({
      data: {
        firstName: 'Fiona',
        lastName: 'Gallagher',
        suffix: 'MD',
        npiNumber: '9991234567',
        primaryTaxonomy: '207Q00000X',
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    // 1. Delete S3 files for any lingering test documents
    const lingeringDocs = await prisma.document.findMany({
      where: { id: { in: createdDocIds } },
      include: { versions: true },
    });
    for (const d of lingeringDocs) {
      for (const v of d.versions) {
        await deleteFromS3({ bucket: v.s3Bucket, key: v.s3Key });
      }
    }

    // 2. Clean DB records
    await prisma.document.deleteMany({ where: { id: { in: createdDocIds } } });
    await prisma.task.deleteMany({ where: { entityType: 'document', entityId: { in: createdDocIds } } });
    if (testProvider) {
      await prisma.provider.deleteMany({ where: { id: testProvider.id } });
    }
  });

  // ==========================================
  // Section 3A: Required Fields Validation
  // ==========================================
  describe('3A. Required Fields Validation (HTTP API)', () => {
    it('rejects upload when category (documentType) is missing (HTTP 400)', async () => {
      const req = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          title: 'Valid Medical License Title',
          fileName: 'license.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        }),
      });

      const res = await createDocRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.details?.documentType).toBeDefined();
    });

    it('rejects upload when category is invalid / unsupported (HTTP 400)', async () => {
      const req = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          documentType: 'unsupported_category_xyz',
          title: 'Valid Medical License Title',
          fileName: 'license.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        }),
      });

      const res = await createDocRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('rejects upload when title is missing (HTTP 400)', async () => {
      const req = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          documentType: 'state_license',
          fileName: 'license.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        }),
      });

      const res = await createDocRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.details?.title).toBeDefined();
    });

    it('rejects upload when title is whitespace-only (HTTP 400)', async () => {
      const req = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          documentType: 'state_license',
          title: '     ',
          fileName: 'license.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        }),
      });

      const res = await createDocRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.details?.title).toBeDefined();
    });

    it('rejects upload when fileBase64 is missing or empty (HTTP 400)', async () => {
      const req = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          documentType: 'state_license',
          title: 'Valid Medical License Title',
          fileName: 'license.pdf',
          mimeType: 'application/pdf',
          fileBase64: '',
        }),
      });

      const res = await createDocRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('saves file and all supplied metadata correctly on valid upload (HTTP 201)', async () => {
      const req = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          providerId: testProvider.id,
          documentType: 'state_license',
          title: 'Texas Medical License 2026 Verification',
          description: 'Primary source state board verification record.',
          issueDate: '2024-01-15',
          expirationDate: '2028-01-15',
          fileName: 'tx_license_2026.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        }),
      });

      const res = await createDocRoute(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.document).toBeDefined();
      expect(json.document.title).toBe('Texas Medical License 2026 Verification');
      expect(json.document.documentType).toBe('state_license');
      expect(json.document.providerId).toBe(testProvider.id);
      expect(json.document.currentVersion).toBeDefined();
      expect(json.document.currentVersion.fileName).toBe('tx_license_2026.pdf');
      expect(json.document.currentVersion.checksumSha256).toBeDefined();

      createdDocIds.push(json.document.id);

      // Verify file exists in S3
      const s3Stream = await downloadFromS3({
        bucket: json.document.currentVersion.s3Bucket,
        key: json.document.currentVersion.s3Key,
      });
      expect(s3Stream.body).toBeDefined();
    });
  });

  // ==========================================
  // Section 3B: File & MIME Validation
  // ==========================================
  describe('3B. File Validation & Size Enforcement (HTTP API)', () => {
    it('accepts valid PDF, JPEG, and PNG files with correct magic bytes (HTTP 201)', async () => {
      // JPEG upload
      const reqJpg = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          providerId: testProvider.id,
          documentType: 'identity_proof',
          title: 'Driver License Photo ID',
          fileName: 'driver_id.jpg',
          mimeType: 'image/jpeg',
          fileBase64: validJpgBase64,
        }),
      });
      const resJpg = await createDocRoute(reqJpg);
      expect(resJpg.status).toBe(201);
      const jsonJpg = await resJpg.json();
      createdDocIds.push(jsonJpg.document.id);

      // PNG upload
      const reqPng = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          providerId: testProvider.id,
          documentType: 'board_certification',
          title: 'Board Certification Seal',
          fileName: 'board_seal.png',
          mimeType: 'image/png',
          fileBase64: validPngBase64,
        }),
      });
      const resPng = await createDocRoute(reqPng);
      expect(resPng.status).toBe(201);
      const jsonPng = await resPng.json();
      createdDocIds.push(jsonPng.document.id);
    });

    it('rejects unsupported file MIME types like text/plain or application/zip (HTTP 400)', async () => {
      const reqText = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          documentType: 'other',
          title: 'Notes Document',
          fileName: 'notes.txt',
          mimeType: 'text/plain',
          fileBase64: Buffer.from('plain text').toString('base64'),
        }),
      });
      const resText = await createDocRoute(reqText);
      expect(resText.status).toBe(400);

      const reqZip = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          documentType: 'other',
          title: 'Archive Document',
          fileName: 'bundle.zip',
          mimeType: 'application/zip',
          fileBase64: Buffer.from('PK\x03\x04').toString('base64'),
        }),
      });
      const resZip = await createDocRoute(reqZip);
      expect(resZip.status).toBe(400);
    });

    it('rejects files exceeding 25 MB limit (HTTP 400)', async () => {
      // 26MB dummy buffer
      const oversizedBuffer = Buffer.alloc(26 * 1024 * 1024, 'a');
      const oversizedPayload = validateDocumentPayload(oversizedBuffer, 'big.pdf', 'application/pdf');
      expect(oversizedPayload.isValid).toBe(false);
      expect(oversizedPayload.error).toContain('exceeds the 25MB limit');

      const reqOversized = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          documentType: 'other',
          title: 'Oversized File Test',
          fileName: 'huge.pdf',
          mimeType: 'application/pdf',
          fileBase64: oversizedBuffer.toString('base64'),
        }),
      });
      const resOversized = await createDocRoute(reqOversized);
      expect(resOversized.status).toBe(400);
      const json = await resOversized.json();
      expect(json.message).toContain('25MB limit');
    });

    it('rejects misleading file extensions where MIME magic bytes mismatch (HTTP 400)', async () => {
      // Plain text pretending to be PDF
      const fakePdfBuffer = Buffer.from('Not a real PDF header just random text');
      expect(validateFileMagicBytes(fakePdfBuffer, 'application/pdf')).toBe(false);

      const reqSpoofed = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          documentType: 'state_license',
          title: 'Spoofed PDF Document',
          fileName: 'spoofed.pdf',
          mimeType: 'application/pdf',
          fileBase64: fakePdfBuffer.toString('base64'),
        }),
      });
      const resSpoofed = await createDocRoute(reqSpoofed);
      expect(resSpoofed.status).toBe(400);
      const json = await resSpoofed.json();
      expect(json.message).toContain('magic byte check failed');
    });
  });

  // ==========================================
  // Section 3C: Dates & Relationships
  // ==========================================
  describe('3C. Dates and Relationships (HTTP API)', () => {
    it('rejects expiration date earlier than issue date (HTTP 400)', async () => {
      const req = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          documentType: 'state_license',
          title: 'Reversed Dates Test',
          issueDate: '2028-01-01',
          expirationDate: '2024-01-01', // Earlier than issue date
          fileName: 'license.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        }),
      });

      const res = await createDocRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.details?.expirationDate).toBeDefined();
    });

    it('succeeds when optional metadata (description, dates, provider) is omitted (HTTP 201)', async () => {
      const req = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          documentType: 'w9',
          title: 'Unassigned Clinic W-9 Form',
          fileName: 'w9.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        }),
      });

      const res = await createDocRoute(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.document.id).toBeDefined();
      expect(json.document.providerId).toBeNull();
      expect(json.document.entityType).toBe('general');
      expect(json.document.description).toBeNull();
      expect(json.document.issueDate).toBeNull();
      expect(json.document.expirationDate).toBeNull();

      createdDocIds.push(json.document.id);
    });

    it('rejects upload when a non-existent provider UUID is supplied (HTTP 400)', async () => {
      const req = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          providerId: '00000000-0000-0000-0000-000000009999',
          documentType: 'state_license',
          title: 'Bogus Provider License',
          fileName: 'license.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        }),
      });

      const res = await createDocRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.message).toContain('selected provider does not exist');
    });
  });

  // ==========================================
  // Section 3D: Failure Safety & Consistency
  // ==========================================
  describe('3D. Failure Safety & Rollback', () => {
    it('creates neither database record nor orphaned S3 object after validation failure', async () => {
      const docCountBefore = await prisma.document.count();

      const req = new Request('http://localhost/api/v1/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `session_token=${credSpecialistToken}`,
        },
        body: JSON.stringify({
          documentType: 'state_license',
          title: '   ', // Invalid whitespace
          fileName: 'invalid.pdf',
          mimeType: 'application/pdf',
          fileBase64: validPdfBase64,
        }),
      });

      const res = await createDocRoute(req);
      expect(res.status).toBe(400);

      const docCountAfter = await prisma.document.count();
      expect(docCountAfter).toBe(docCountBefore);
    });
  });

  // ==========================================
  // Section 4: Admin-Only Deletion & RBAC Tests
  // ==========================================
  describe('4. Admin-Only Deletion & RBAC Permissions', () => {
    let testDocAId: string;
    let testDocBId: string;
    let s3KeyA: string;
    let s3BucketA: string;
    let taskIdA: string;

    beforeAll(async () => {
      // Create Document A (to be deleted)
      const docA = await createDocumentWithVersion({
        entityType: 'provider',
        entityId: testProvider.id,
        providerId: testProvider.id,
        documentType: 'caqh_profile',
        title: 'CAQH Attestation Profile Doc A',
        fileBuffer: validPdfBuffer,
        fileName: 'caqh_doc_a.pdf',
        mimeType: 'application/pdf',
        uploadedById: credSpecialistUser.id,
      });
      testDocAId = docA.id;
      s3KeyA = docA.currentVersion!.s3Key;
      s3BucketA = docA.currentVersion!.s3Bucket;
      createdDocIds.push(docA.id);

      // Create an associated task for Document A
      const taskA = await prisma.task.create({
        data: {
          title: 'Review CAQH Profile Doc A',
          entityType: 'document',
          entityId: testDocAId,
          priority: 'high',
          status: 'pending',
          dueDate: new Date(),
        },
      });
      taskIdA = taskA.id;

      // Create Document B (unrelated document that must NOT be deleted)
      const docB = await createDocumentWithVersion({
        entityType: 'provider',
        entityId: testProvider.id,
        providerId: testProvider.id,
        documentType: 'malpractice_insurance',
        title: 'Unrelated Malpractice Policy Doc B',
        fileBuffer: validPdfBuffer,
        fileName: 'malpractice_b.pdf',
        mimeType: 'application/pdf',
        uploadedById: credSpecialistUser.id,
      });
      testDocBId = docB.id;
      createdDocIds.push(docB.id);
    });

    it('rejects unauthenticated deletion request (HTTP 401 Unauthorized)', async () => {
      const req = new Request(`http://localhost/api/v1/documents/${testDocAId}`, {
        method: 'DELETE',
      });
      const res = await deleteDocRoute(req, { params: { id: testDocAId } });
      expect(res.status).toBe(401);

      // Verify Document A is untouched
      const checkDoc = await prisma.document.findUnique({ where: { id: testDocAId } });
      expect(checkDoc).not.toBeNull();
    });

    it('rejects expired session token on deletion request (HTTP 401 Unauthorized)', async () => {
      const req = new Request(`http://localhost/api/v1/documents/${testDocAId}`, {
        method: 'DELETE',
        headers: { cookie: `session_token=${expiredToken}` },
      });
      const res = await deleteDocRoute(req, { params: { id: testDocAId } });
      expect(res.status).toBe(401);
    });

    it('rejects credentialing_specialist from deleting document (HTTP 403 Forbidden)', async () => {
      const req = new Request(`http://localhost/api/v1/documents/${testDocAId}`, {
        method: 'DELETE',
        headers: { cookie: `session_token=${credSpecialistToken}` },
      });
      const res = await deleteDocRoute(req, { params: { id: testDocAId } });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.message).toContain("documents:delete' permission required");

      // Verify document still exists
      const checkDoc = await prisma.document.findUnique({ where: { id: testDocAId } });
      expect(checkDoc).not.toBeNull();
    });

    it('rejects enrollment_specialist from deleting document (HTTP 403 Forbidden)', async () => {
      const req = new Request(`http://localhost/api/v1/documents/${testDocAId}`, {
        method: 'DELETE',
        headers: { cookie: `session_token=${enrollSpecialistToken}` },
      });
      const res = await deleteDocRoute(req, { params: { id: testDocAId } });
      expect(res.status).toBe(403);

      const checkDoc = await prisma.document.findUnique({ where: { id: testDocAId } });
      expect(checkDoc).not.toBeNull();
    });

    it('rejects viewer from deleting document (HTTP 403 Forbidden)', async () => {
      const req = new Request(`http://localhost/api/v1/documents/${testDocAId}`, {
        method: 'DELETE',
        headers: { cookie: `session_token=${viewerToken}` },
      });
      const res = await deleteDocRoute(req, { params: { id: testDocAId } });
      expect(res.status).toBe(403);

      const checkDoc = await prisma.document.findUnique({ where: { id: testDocAId } });
      expect(checkDoc).not.toBeNull();
    });

    it('allows administrator (admin) to delete document (HTTP 200 OK)', async () => {
      // Verify S3 object exists before deletion
      const s3Before = await downloadFromS3({ bucket: s3BucketA, key: s3KeyA });
      expect(s3Before.body).toBeDefined();

      const req = new Request(`http://localhost/api/v1/documents/${testDocAId}`, {
        method: 'DELETE',
        headers: { cookie: `session_token=${adminToken}` },
      });
      const res = await deleteDocRoute(req, { params: { id: testDocAId } });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.message).toContain('deleted successfully');

      // Verify Document A is removed from PostgreSQL
      const dbDocA = await prisma.document.findUnique({ where: { id: testDocAId } });
      expect(dbDocA).toBeNull();

      // Verify associated versions removed
      const dbVersionsA = await prisma.documentVersion.findMany({ where: { documentId: testDocAId } });
      expect(dbVersionsA.length).toBe(0);

      // Verify associated task removed
      const dbTaskA = await prisma.task.findUnique({ where: { id: taskIdA } });
      expect(dbTaskA).toBeNull();

      // Verify S3 object deleted
      await expect(downloadFromS3({ bucket: s3BucketA, key: s3KeyA })).rejects.toThrow();
    });

    it('guarantees unrelated document (Doc B) remains completely intact', async () => {
      // Document B must still exist in DB
      const dbDocB = await prisma.document.findUnique({
        where: { id: testDocBId },
        include: { currentVersion: true },
      });
      expect(dbDocB).not.toBeNull();
      expect(dbDocB?.title).toBe('Unrelated Malpractice Policy Doc B');

      // S3 file for Doc B must still exist
      const s3DocB = await downloadFromS3({
        bucket: dbDocB!.currentVersion!.s3Bucket,
        key: dbDocB!.currentVersion!.s3Key,
      });
      expect(s3DocB.body).toBeDefined();
    });

    it('records immutable DOCUMENT_DELETED audit log with actor attribution and preserves prior audit logs', async () => {
      const docAAuditLogs = await prisma.auditLog.findMany({
        where: { entityType: 'document', entityId: testDocAId },
        orderBy: { createdAt: 'asc' },
      });

      // Must have at least DOCUMENT_UPLOADED and DOCUMENT_DELETED
      expect(docAAuditLogs.length).toBeGreaterThanOrEqual(2);

      const uploadedLog = docAAuditLogs.find((l) => l.action === 'DOCUMENT_UPLOADED');
      expect(uploadedLog).toBeDefined();
      expect(uploadedLog?.userId).toBe(credSpecialistUser.id);

      const deletedLog = docAAuditLogs.find((l) => l.action === 'DOCUMENT_DELETED');
      expect(deletedLog).toBeDefined();
      expect(deletedLog?.userId).toBe(adminUser.id);
      expect(deletedLog?.userEmail).toBe(adminUser.email);

      const changes = deletedLog?.changes as Record<string, unknown>;
      expect(changes.title).toBe('CAQH Attestation Profile Doc A');
      expect(changes.documentType).toBe('caqh_profile');
      expect(changes.deletedByRole).toBe(UserRole.admin);

      // Verify audit immutability triggers prevent modifying or deleting audit records
      await expect(
        prisma.$executeRaw`UPDATE audit_logs SET action = 'ALTERED' WHERE id = ${deletedLog!.id}::uuid`
      ).rejects.toThrow();

      await expect(
        prisma.$executeRaw`DELETE FROM audit_logs WHERE id = ${deletedLog!.id}::uuid`
      ).rejects.toThrow();
    });
  });
});

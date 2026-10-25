import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db/prisma';
import {
  createDocumentWithVersion,
  addDocumentVersion,
  verifyDocument,
  getDocuments,
  getDocumentById,
  scanDocumentExpirationsAndPendingReview,
  deleteDocument,
} from '../src/lib/documents/document-service';
import {
  sanitizeFileName,
  validateFileMagicBytes,
  validateDocumentPayload,
  computeSha256,
  downloadFromS3,
  deleteFromS3,
} from '../src/lib/storage/s3';
import {
  createDocumentSchema,
  verifyDocumentSchema,
  updateDocumentMetadataSchema,
} from '../src/lib/validation/document';
import { hasPermission } from '../src/lib/auth/rbac';

describe('Phase 5: Document Management & Verification Module', () => {
  let testUserId: string;
  let testViewerUserId: string;
  let testAdminUserId: string;
  let testEnrollmentUserId: string;
  let testProviderId: string;
  let testPayerId: string;
  let testEnrollmentId: string;
  let testLicenseId: string;
  const createdDocumentIds: string[] = [];

  // Valid synthetic PDF buffer (%PDF-1.4...)
  const dummyPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\ntrailer\n<<\n>>\n%%EOF');
  // Valid synthetic JPEG buffer (0xFF 0xD8 0xFF 0xE0...)
  const dummyJpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  // Valid synthetic PNG buffer (0x89 0x50 0x4E 0x47...)
  const dummyPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  beforeAll(async () => {
    // 1. Create or retrieve specialist user
    const specialistUser = await prisma.user.upsert({
      where: { email: 'phase5_specialist@example.com' },
      update: {},
      create: {
        email: 'phase5_specialist@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Diana',
        lastName: 'DocSpecialist',
        role: 'credentialing_specialist',
      },
    });
    testUserId = specialistUser.id;

    // 2. Create viewer user
    const viewerUser = await prisma.user.upsert({
      where: { email: 'phase5_viewer@example.com' },
      update: {},
      create: {
        email: 'phase5_viewer@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Vince',
        lastName: 'DocViewer',
        role: 'viewer',
      },
    });
    testViewerUserId = viewerUser.id;

    // 2b. Create admin user
    const adminUser = await prisma.user.upsert({
      where: { email: 'phase5_admin@example.com' },
      update: {},
      create: {
        email: 'phase5_admin@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Adam',
        lastName: 'DocAdmin',
        role: 'admin',
      },
    });
    testAdminUserId = adminUser.id;

    // 2c. Create enrollment specialist user
    const enrollUser = await prisma.user.upsert({
      where: { email: 'phase5_enrollment@example.com' },
      update: {},
      create: {
        email: 'phase5_enrollment@example.com',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Emma',
        lastName: 'DocEnrollment',
        role: 'enrollment_specialist',
      },
    });
    testEnrollmentUserId = enrollUser.id;

    // 3. Create test provider
    await prisma.provider.deleteMany({ where: { npiNumber: '9955443322' } });
    const provider = await prisma.provider.create({
      data: {
        firstName: 'Elena',
        lastName: 'Vance',
        suffix: 'MD',
        npiNumber: '9955443322',
        primaryTaxonomy: '207Q00000X',
        status: 'active',
      },
    });
    testProviderId = provider.id;

    // 4. Create test state license credential
    const license = await prisma.stateLicense.create({
      data: {
        providerId: testProviderId,
        state: 'TX',
        licenseNumber: 'TX-DOC-88910',
        licenseType: 'MD',
        issueDate: new Date('2024-01-01'),
        expirationDate: new Date('2028-01-01'),
        status: 'active',
      },
    });
    testLicenseId = license.id;

    // 5. Create test payer and enrollment
    const payer = await prisma.payer.create({
      data: {
        name: 'Humana Texas Synthetic Payer',
        shortName: 'HumanaTX',
        payerType: 'commercial',
        state: 'TX',
      },
    });
    testPayerId = payer.id;

    const enrollment = await prisma.payerEnrollment.create({
      data: {
        providerId: testProviderId,
        payerId: testPayerId,
        enrollmentType: 'individual',
        status: 'submitted',
        trackingNumber: 'HUM-IND-5544',
      },
    });
    testEnrollmentId = enrollment.id;
  });

  afterAll(async () => {
    // 1. Fetch all created documents to delete files from S3
    const docs = await prisma.document.findMany({
      where: { id: { in: createdDocumentIds } },
      include: { versions: true },
    });
    for (const d of docs) {
      for (const v of d.versions) {
        await deleteFromS3({ bucket: v.s3Bucket, key: v.s3Key });
      }
    }

    // 2. Database cleanup
    await prisma.document.deleteMany({
      where: { id: { in: createdDocumentIds } },
    });
    await prisma.task.deleteMany({
      where: { entityType: 'document', entityId: { in: createdDocumentIds } },
    });
    await prisma.notification.deleteMany({
      where: { userId: { in: [testUserId, testViewerUserId, testAdminUserId, testEnrollmentUserId] } },
    });
    await prisma.payerEnrollment.deleteMany({ where: { id: testEnrollmentId } });
    await prisma.payer.deleteMany({ where: { id: testPayerId } });
    await prisma.stateLicense.deleteMany({ where: { id: testLicenseId } });
    await prisma.provider.deleteMany({ where: { id: testProviderId } });
  });

  // ==========================================
  // 1. Storage Security & File Validation
  // ==========================================
  describe('1. Storage Security & File Validation', () => {
    it('should sanitize unsafe filenames and prevent path traversal', () => {
      expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
      expect(sanitizeFileName('..\\..\\windows\\system32\\cmd.exe')).toBe('cmd.exe');
      expect(sanitizeFileName('My Medical License (2026)!.pdf')).toBe('My_Medical_License__2026__.pdf');
      expect(sanitizeFileName('')).toBe('document_file.pdf');
    });

    it('should accurately validate magic bytes for PDF, JPEG, and PNG', () => {
      expect(validateFileMagicBytes(dummyPdfBuffer, 'application/pdf')).toBe(true);
      expect(validateFileMagicBytes(dummyJpgBuffer, 'image/jpeg')).toBe(true);
      expect(validateFileMagicBytes(dummyPngBuffer, 'image/png')).toBe(true);

      // Mismatched magic bytes (text pretending to be PDF)
      const fakePdf = Buffer.from('Just plain text content not a real pdf');
      expect(validateFileMagicBytes(fakePdf, 'application/pdf')).toBe(false);

      // Short buffer
      expect(validateFileMagicBytes(Buffer.from([0x01, 0x02]), 'application/pdf')).toBe(false);
    });

    it('should reject invalid MIME types and oversized files', () => {
      // Disallowed MIME type
      const textBuffer = Buffer.from('Hello world');
      const textCheck = validateDocumentPayload(textBuffer, 'notes.txt', 'text/plain');
      expect(textCheck.isValid).toBe(false);
      expect(textCheck.error).toContain('Disallowed file type');

      // Empty buffer
      const emptyCheck = validateDocumentPayload(Buffer.alloc(0), 'test.pdf', 'application/pdf');
      expect(emptyCheck.isValid).toBe(false);

      // Oversized buffer (> 25MB)
      const oversizedBuffer = Buffer.alloc(26 * 1024 * 1024); // 26MB
      const sizeCheck = validateDocumentPayload(oversizedBuffer, 'huge.pdf', 'application/pdf');
      expect(sizeCheck.isValid).toBe(false);
      expect(sizeCheck.error).toContain('exceeds the 25MB limit');
    });

    it('should compute consistent SHA-256 checksums', () => {
      const hash1 = computeSha256(dummyPdfBuffer);
      const hash2 = computeSha256(dummyPdfBuffer);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });
  });

  // ==========================================
  // 2. Upload with Version 1 Creation
  // ==========================================
  describe('2. Upload with Initial Version Creation', () => {
    let docId: string;

    it('should upload a valid PDF document with Version 1 and currentVersion reference', async () => {
      const doc = await createDocumentWithVersion({
        entityType: 'provider',
        entityId: testProviderId,
        providerId: testProviderId,
        documentType: 'state_license',
        title: 'Texas Medical License Certificate 2026',
        description: 'Primary source state board issued certificate.',
        issueDate: '2024-01-01',
        expirationDate: '2028-01-01',
        fileBuffer: dummyPdfBuffer,
        fileName: 'texas_license_2026.pdf',
        mimeType: 'application/pdf',
        uploadedById: testUserId,
        userEmail: 'phase5_specialist@example.com',
      });

      docId = doc.id;
      createdDocumentIds.push(doc.id);

      expect(doc.id).toBeDefined();
      expect(doc.title).toBe('Texas Medical License Certificate 2026');
      expect(doc.status).toBe('pending_review');
      expect(doc.currentVersionId).toBeDefined();
      expect(doc.currentVersion?.versionNumber).toBe(1);
      expect(doc.currentVersion?.fileName).toBe('texas_license_2026.pdf');
      expect(doc.currentVersion?.mimeType).toBe('application/pdf');
      expect(doc.currentVersion?.checksumSha256).toBeDefined();
    });

    it('should retrieve uploaded file stream from S3 matching uploaded bytes', async () => {
      const doc = await getDocumentById(docId);
      expect(doc).toBeDefined();
      expect(doc?.currentVersion).toBeDefined();

      const s3Stream = await downloadFromS3({
        bucket: doc!.currentVersion!.s3Bucket,
        key: doc!.currentVersion!.s3Key,
      });

      expect(s3Stream.body).toBeDefined();
      expect(s3Stream.contentType).toBe('application/pdf');
    });

    it('should validate createDocumentSchema rejection when expiration is before issue date', () => {
      const invalid = createDocumentSchema.safeParse({
        entityType: 'provider',
        entityId: testProviderId,
        documentType: 'state_license',
        title: 'Invalid Dates Test',
        issueDate: '2028-01-01',
        expirationDate: '2024-01-01', // Before issue date!
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
        fileBase64: 'dGVzdA==',
      });
      expect(invalid.success).toBe(false);
    });
  });

  // ==========================================
  // 3. Multi-Version Management
  // ==========================================
  describe('3. Multi-Version Document Lifecycle', () => {
    let testDocId: string;
    let version1Id: string;
    let version2Id: string;

    beforeAll(async () => {
      const doc = await createDocumentWithVersion({
        entityType: 'provider',
        entityId: testProviderId,
        documentType: 'malpractice_insurance',
        title: 'COI Policy 2026',
        fileBuffer: dummyPdfBuffer,
        fileName: 'coi_v1.pdf',
        mimeType: 'application/pdf',
        uploadedById: testUserId,
      });
      testDocId = doc.id;
      version1Id = doc.currentVersionId!;
      createdDocumentIds.push(doc.id);
    });

    it('should add a revised version, increment versionNumber, and preserve previous version', async () => {
      // First verify v1
      await verifyDocument({
        documentId: testDocId,
        status: 'verified',
        reviewerId: testUserId,
      });

      const updatedToVerified = await getDocumentById(testDocId);
      expect(updatedToVerified?.status).toBe('verified');

      // Now add Version 2 with new JPEG buffer
      const result = await addDocumentVersion({
        documentId: testDocId,
        fileBuffer: dummyJpgBuffer,
        fileName: 'coi_v2_renewed.jpg',
        mimeType: 'image/jpeg',
        uploadedById: testUserId,
        userEmail: 'phase5_specialist@example.com',
        notes: 'Annual renewal endorsement attached.',
      });

      version2Id = result.version.id;
      expect(result.version.versionNumber).toBe(2);
      expect(result.version.fileName).toBe('coi_v2_renewed.jpg');
      expect(result.document.currentVersionId).toBe(version2Id);

      // Revised version MUST automatically reset status to pending_review
      expect(result.document.status).toBe('pending_review');
    });

    it('should maintain full version history with both v1 and v2 retrievable', async () => {
      const doc = await getDocumentById(testDocId);
      expect(doc).toBeDefined();
      expect(doc?.versions.length).toBe(2);

      // Version 2 is current
      expect(doc?.currentVersion?.versionNumber).toBe(2);
      expect(doc?.currentVersion?.id).toBe(version2Id);

      // Version 1 is still preserved in history
      const v1 = doc?.versions.find((v) => v.versionNumber === 1);
      expect(v1).toBeDefined();
      expect(v1?.id).toBe(version1Id);
      expect(v1?.fileName).toBe('coi_v1.pdf');

      // Both versions remain downloadable from S3
      const s3v1 = await downloadFromS3({ bucket: v1!.s3Bucket, key: v1!.s3Key });
      expect(s3v1.body).toBeDefined();

      const s3v2 = await downloadFromS3({ bucket: doc!.currentVersion!.s3Bucket, key: doc!.currentVersion!.s3Key });
      expect(s3v2.body).toBeDefined();
    });
  });

  // ==========================================
  // 4. Review and Verification Workflow
  // ==========================================
  describe('4. Review and Verification Workflow', () => {
    let testDocId: string;

    beforeAll(async () => {
      const doc = await createDocumentWithVersion({
        entityType: 'credential',
        entityId: testLicenseId,
        providerId: testProviderId,
        documentType: 'state_license',
        title: 'PSV Board Verification Extract',
        fileBuffer: dummyPdfBuffer,
        fileName: 'psv_extract.pdf',
        mimeType: 'application/pdf',
        uploadedById: testUserId,
      });
      testDocId = doc.id;
      createdDocumentIds.push(doc.id);
    });

    it('should reject invalid verification schema without rejection reason when rejecting', () => {
      const invalid = verifyDocumentSchema.safeParse({
        status: 'rejected',
        rejectionReason: '', // Missing
      });
      expect(invalid.success).toBe(false);

      const validReject = verifyDocumentSchema.safeParse({
        status: 'rejected',
        rejectionReason: 'Seal is illegible and expiration date is cropped out.',
      });
      expect(validReject.success).toBe(true);

      const validApprove = verifyDocumentSchema.safeParse({
        status: 'verified',
        verificationNotes: 'Verified directly on Texas Medical Board registry portal.',
      });
      expect(validApprove.success).toBe(true);
    });

    it('should reject a document and record rejection reason and audit event', async () => {
      const rejected = await verifyDocument({
        documentId: testDocId,
        status: 'rejected',
        reviewerId: testUserId,
        userEmail: 'phase5_specialist@example.com',
        rejectionReason: 'Document image is blurred and registration seal cannot be read.',
      });

      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectionReason).toContain('Document image is blurred');
      expect(rejected.verifiedById).toBe(testUserId);
      expect(rejected.verifiedAt).toBeDefined();
    });

    it('should re-verify a previously rejected document when corrected', async () => {
      const verified = await verifyDocument({
        documentId: testDocId,
        status: 'verified',
        reviewerId: testUserId,
        userEmail: 'phase5_specialist@example.com',
        verificationNotes: 'High-resolution scan provided by provider office; verified OK.',
      });

      expect(verified.status).toBe('verified');
      expect(verified.rejectionReason).toBeNull();
      expect(verified.verificationNotes).toContain('High-resolution scan provided');
    });
  });

  // ==========================================
  // 5. Integration with Credentials & Enrollments
  // ==========================================
  describe('5. Entity Associations (Credentials and Enrollments)', () => {
    it('should associate document with Phase 3 StateLicense credential', async () => {
      const doc = await createDocumentWithVersion({
        entityType: 'credential',
        entityId: testLicenseId,
        providerId: testProviderId,
        documentType: 'state_license',
        title: 'Texas Medical License Primary Source Verification',
        fileBuffer: dummyPdfBuffer,
        fileName: 'tmb_verification.pdf',
        mimeType: 'application/pdf',
        uploadedById: testUserId,
      });

      createdDocumentIds.push(doc.id);
      expect(doc.entityType).toBe('credential');
      expect(doc.entityId).toBe(testLicenseId);
      expect(doc.providerId).toBe(testProviderId);

      const res = await getDocuments({ entityType: 'credential', entityId: testLicenseId });
      expect(res.documents.length).toBeGreaterThanOrEqual(1);
      expect(res.documents.some((d) => d.id === doc.id)).toBe(true);
    });

    it('should associate document with Phase 4 Payer Enrollment record', async () => {
      const doc = await createDocumentWithVersion({
        entityType: 'payer_enrollment',
        entityId: testEnrollmentId,
        providerId: testProviderId,
        documentType: 'payer_application',
        title: 'Humana Provider Participation Agreement',
        fileBuffer: dummyPdfBuffer,
        fileName: 'humana_agreement.pdf',
        mimeType: 'application/pdf',
        uploadedById: testUserId,
      });

      createdDocumentIds.push(doc.id);
      expect(doc.entityType).toBe('payer_enrollment');
      expect(doc.entityId).toBe(testEnrollmentId);

      const res = await getDocuments({ entityType: 'payer_enrollment', entityId: testEnrollmentId });
      expect(res.documents.length).toBeGreaterThanOrEqual(1);
      expect(res.documents.some((d) => d.id === doc.id)).toBe(true);
    });
  });

  // ==========================================
  // 6. Expiration Boundaries & Background Scanner
  // ==========================================
  describe('6. Expiration Windows & Idempotent Scanner', () => {
    let expiringDocId: string;
    let expiredDocId: string;

    beforeAll(async () => {
      const now = new Date();
      // 1. Expiring soon: 20 days from now
      const in20Days = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const expiringDoc = await createDocumentWithVersion({
        entityType: 'provider',
        entityId: testProviderId,
        documentType: 'dea_registration',
        title: 'Expiring DEA Certificate',
        expirationDate: in20Days,
        fileBuffer: dummyPdfBuffer,
        fileName: 'expiring_dea.pdf',
        mimeType: 'application/pdf',
        uploadedById: testUserId,
      });
      expiringDocId = expiringDoc.id;
      createdDocumentIds.push(expiringDoc.id);

      // 2. Already expired: 10 days ago
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const expiredDoc = await createDocumentWithVersion({
        entityType: 'provider',
        entityId: testProviderId,
        documentType: 'board_certification',
        title: 'Expired Board Certification',
        expirationDate: tenDaysAgo,
        fileBuffer: dummyPdfBuffer,
        fileName: 'expired_board.pdf',
        mimeType: 'application/pdf',
        uploadedById: testUserId,
      });
      expiredDocId = expiredDoc.id;
      createdDocumentIds.push(expiredDoc.id);
    });

    it('should detect expiring soon and expired documents on first scan and create tasks', async () => {
      const scan1 = await scanDocumentExpirationsAndPendingReview();
      expect(scan1.expiringDocsScanned).toBeGreaterThanOrEqual(1);
      expect(scan1.expiredDocsScanned).toBeGreaterThanOrEqual(1);
      expect(scan1.expiringTasksCreated).toBeGreaterThanOrEqual(1);
      expect(scan1.expiredTasksCreated).toBeGreaterThanOrEqual(1);

      // Verify task exists in DB
      const taskExpiring = await prisma.task.findFirst({
        where: { entityType: 'document', entityId: expiringDocId },
      });
      expect(taskExpiring).toBeDefined();
      expect(taskExpiring?.title).toContain('Document Expiring Soon:');

      const taskExpired = await prisma.task.findFirst({
        where: { entityType: 'document', entityId: expiredDocId },
      });
      expect(taskExpired).toBeDefined();
      expect(taskExpired?.title).toContain('Expired Document Action:');
    });

    it('should be idempotent and create 0 duplicate tasks on second scan', async () => {
      const scan2 = await scanDocumentExpirationsAndPendingReview();
      expect(scan2.expiringTasksCreated).toBe(0);
      expect(scan2.expiredTasksCreated).toBe(0);
    });
  });

  // ==========================================
  // 7. Role-Based Access Control
  // ==========================================
  describe('7. Role-Based Access Control (RBAC)', () => {
    it('should allow credentialing specialist read and write access to documents', () => {
      expect(hasPermission('credentialing_specialist', 'documents:read')).toBe(true);
      expect(hasPermission('credentialing_specialist', 'documents:write')).toBe(true);
    });

    it('should allow viewer read-only access and reject write permissions', () => {
      expect(hasPermission('viewer', 'documents:read')).toBe(true);
      expect(hasPermission('viewer', 'documents:write')).toBe(false);
    });

    it('should grant super_admin and admin all document permissions', () => {
      expect(hasPermission('super_admin', 'documents:read')).toBe(true);
      expect(hasPermission('super_admin', 'documents:write')).toBe(true);
      expect(hasPermission('admin', 'documents:read')).toBe(true);
      expect(hasPermission('admin', 'documents:write')).toBe(true);
    });
  });

  // ==========================================
  // 8. Audit Log Immutability Non-Regression
  // ==========================================
  describe('8. Audit Log Immutability Non-Regression for Documents', () => {
    it('should reject UPDATE operations on audit_logs via PostgreSQL BEFORE trigger or permissions', async () => {
      const testAudit = await prisma.auditLog.create({
        data: {
          action: 'TEST_DOC_IMMUTABILITY_AUDIT',
          entityType: 'document',
          entityId: createdDocumentIds[0],
          changes: { test: true },
        },
      });

      await expect(
        prisma.$executeRaw`UPDATE audit_logs SET action = 'HACKED' WHERE id = ${testAudit.id}::uuid`
      ).rejects.toThrow();
    });

    it('should reject DELETE operations on audit_logs via PostgreSQL BEFORE trigger or permissions', async () => {
      const testAudit = await prisma.auditLog.create({
        data: {
          action: 'TEST_DOC_DELETE_AUDIT',
          entityType: 'document',
          entityId: createdDocumentIds[0],
          changes: { test: true },
        },
      });

      await expect(
        prisma.$executeRaw`DELETE FROM audit_logs WHERE id = ${testAudit.id}::uuid`
      ).rejects.toThrow();
    });
  });

  // ==========================================
  // 9. Dashboard Queries & Live Summary Counts
  // ==========================================
  describe('9. Real Database Document Summary Queries', () => {
    it('should return live summary counts without hardcoding', async () => {
      const res = await getDocuments();
      expect(res.summaryCounts).toBeDefined();
      expect(typeof res.summaryCounts.totalCount).toBe('number');
      expect(typeof res.summaryCounts.pendingReviewCount).toBe('number');
      expect(typeof res.summaryCounts.verifiedCount).toBe('number');
      expect(typeof res.summaryCounts.rejectedCount).toBe('number');
      expect(typeof res.summaryCounts.expiringSoonCount).toBe('number');
      expect(typeof res.summaryCounts.expiredCount).toBe('number');
      expect(res.summaryCounts.totalCount).toBeGreaterThanOrEqual(createdDocumentIds.length);
    });
  });

  // ==========================================
  // 10. Storage Reconciliation on Failure
  // ==========================================
  describe('10. Storage Reconciliation and Rollback on Failure', () => {
    it('should clean up S3 object when database transaction fails during upload', async () => {
      // Intentionally provide a non-existent provider UUID that violates foreign key
      const nonExistentId = '00000000-0000-0000-0000-000000009999';

      await expect(
        createDocumentWithVersion({
          entityType: 'provider',
          entityId: nonExistentId,
          providerId: nonExistentId,
          documentType: 'state_license',
          title: 'Orphan Prevention Test',
          fileBuffer: dummyPdfBuffer,
          fileName: 'orphan_test.pdf',
          mimeType: 'application/pdf',
          uploadedById: testUserId,
        })
      ).rejects.toThrow();

      // Verify no document was saved in the database
      const dbCheck = await prisma.document.findFirst({
        where: { title: 'Orphan Prevention Test' },
      });
      expect(dbCheck).toBeNull();
    });
  });

  // ==========================================
  // 11. IDOR and Cross-Provider Access Boundaries
  // ==========================================
  describe('11. IDOR Prevention & Cross-Provider Isolation', () => {
    let secondProviderId: string;
    let secondDocId: string;

    beforeAll(async () => {
      await prisma.provider.deleteMany({ where: { npiNumber: '9988112233' } });
      const prov2 = await prisma.provider.create({
        data: {
          firstName: 'Aaron',
          lastName: 'Stone',
          suffix: 'MD',
          npiNumber: '9988112233',
          primaryTaxonomy: '207Q00000X',
          status: 'active',
        },
      });
      secondProviderId = prov2.id;

      const doc2 = await createDocumentWithVersion({
        entityType: 'provider',
        entityId: secondProviderId,
        providerId: secondProviderId,
        documentType: 'board_certification',
        title: 'Dr. Stone Board Certificate',
        fileBuffer: dummyPdfBuffer,
        fileName: 'stone_cert.pdf',
        mimeType: 'application/pdf',
        uploadedById: testUserId,
      });
      secondDocId = doc2.id;
      createdDocumentIds.push(doc2.id);
    });

    afterAll(async () => {
      await prisma.document.deleteMany({ where: { id: secondDocId } });
      await prisma.provider.deleteMany({ where: { id: secondProviderId } });
    });

    it('should return null when querying non-existent document ID (preventing IDOR)', async () => {
      const nonExistent = await getDocumentById('00000000-0000-0000-0000-000000000000');
      expect(nonExistent).toBeNull();
    });

    it('should strictly isolate document queries by providerId', async () => {
      const vanceDocs = await getDocuments({ providerId: testProviderId });
      expect(vanceDocs.documents.every((d) => d.providerId === testProviderId)).toBe(true);
      expect(vanceDocs.documents.some((d) => d.id === secondDocId)).toBe(false);

      const stoneDocs = await getDocuments({ providerId: secondProviderId });
      expect(stoneDocs.documents.length).toBe(1);
      expect(stoneDocs.documents[0].id).toBe(secondDocId);
      expect(stoneDocs.documents[0].providerId).toBe(secondProviderId);
    });
  });

  // ==========================================
  // 12. Metadata Updates & Schema Boundaries
  // ==========================================
  describe('12. Metadata Updates and Schema Validations', () => {
    it('should validate and update document metadata safely', async () => {
      const doc = await getDocumentById(createdDocumentIds[0]);
      expect(doc).toBeDefined();

      const validUpdate = updateDocumentMetadataSchema.safeParse({
        title: 'Updated State License Title 2026',
        description: 'Updated description for board verification.',
        expirationDate: '2028-12-31',
      });
      expect(validUpdate.success).toBe(true);

      const invalidUpdate = updateDocumentMetadataSchema.safeParse({
        issueDate: '2029-01-01',
        expirationDate: '2025-01-01', // Invalid: expiration before issue date
      });
      expect(invalidUpdate.success).toBe(false);
    });
  });

  // ==========================================
  // 13. Upload Validation & Boundary Enforcement
  // ==========================================
  describe('13. Upload Validation & Boundary Enforcement', () => {
    it('should reject upload when document category (documentType) is missing or invalid', () => {
      // Missing category
      const missingCategory = createDocumentSchema.safeParse({
        title: 'Valid Document Title',
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
        fileBase64: 'dGVzdA==',
      });
      expect(missingCategory.success).toBe(false);

      // Unsupported category
      const invalidCategory = createDocumentSchema.safeParse({
        documentType: 'unsupported_custom_type',
        title: 'Valid Document Title',
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
        fileBase64: 'dGVzdA==',
      });
      expect(invalidCategory.success).toBe(false);
    });

    it('should reject blank or whitespace-only titles', () => {
      // Empty title
      const emptyTitle = createDocumentSchema.safeParse({
        documentType: 'state_license',
        title: '',
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
        fileBase64: 'dGVzdA==',
      });
      expect(emptyTitle.success).toBe(false);

      // Whitespace-only title
      const whitespaceTitle = createDocumentSchema.safeParse({
        documentType: 'state_license',
        title: '   ',
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
        fileBase64: 'dGVzdA==',
      });
      expect(whitespaceTitle.success).toBe(false);

      // Single character title
      const shortTitle = createDocumentSchema.safeParse({
        documentType: 'state_license',
        title: 'A',
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
        fileBase64: 'dGVzdA==',
      });
      expect(shortTitle.success).toBe(false);
    });

    it('should reject missing file or empty fileBase64 data', () => {
      // Empty fileBase64
      const emptyFile = createDocumentSchema.safeParse({
        documentType: 'state_license',
        title: 'Valid License Title',
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
        fileBase64: '',
      });
      expect(emptyFile.success).toBe(false);

      // Missing fileName
      const missingName = createDocumentSchema.safeParse({
        documentType: 'state_license',
        title: 'Valid License Title',
        mimeType: 'application/pdf',
        fileBase64: 'dGVzdA==',
      });
      expect(missingName.success).toBe(false);
    });

    it('should reject disallowed MIME types and enforce 25 MB limit', () => {
      // Disallowed MIME types
      const textMime = createDocumentSchema.safeParse({
        documentType: 'state_license',
        title: 'Valid License Title',
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        fileBase64: 'dGVzdA==',
      });
      expect(textMime.success).toBe(false);

      const zipMime = createDocumentSchema.safeParse({
        documentType: 'state_license',
        title: 'Valid License Title',
        fileName: 'archive.zip',
        mimeType: 'application/zip',
        fileBase64: 'dGVzdA==',
      });
      expect(zipMime.success).toBe(false);

      // Allowed MIME types
      for (const validMime of ['application/pdf', 'image/jpeg', 'image/png']) {
        const ok = createDocumentSchema.safeParse({
          documentType: 'state_license',
          title: 'Valid License Title',
          fileName: 'doc.pdf',
          mimeType: validMime,
          fileBase64: 'dGVzdA==',
        });
        expect(ok.success).toBe(true);
      }

      // Server payload validation enforces 25MB limit
      const oversized = Buffer.alloc(26 * 1024 * 1024);
      const sizeValidation = validateDocumentPayload(oversized, 'big.pdf', 'application/pdf');
      expect(sizeValidation.isValid).toBe(false);
      expect(sizeValidation.error).toContain('exceeds the 25MB limit');
    });

    it('should reject invalid date range where expiration date is earlier than issue date', () => {
      const invalidDates = createDocumentSchema.safeParse({
        documentType: 'state_license',
        title: 'Valid License Title',
        issueDate: '2026-06-01',
        expirationDate: '2025-06-01', // Before issue date!
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
        fileBase64: 'dGVzdA==',
      });
      expect(invalidDates.success).toBe(false);

      const validDates = createDocumentSchema.safeParse({
        documentType: 'state_license',
        title: 'Valid License Title',
        issueDate: '2025-06-01',
        expirationDate: '2026-06-01',
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
        fileBase64: 'dGVzdA==',
      });
      expect(validDates.success).toBe(true);
    });

    it('should allow optional provider association and persist document metadata without provider', async () => {
      const generalDoc = await createDocumentWithVersion({
        entityType: 'general',
        entityId: '00000000-0000-0000-0000-000000000001',
        providerId: null,
        documentType: 'w9',
        title: 'Clinic Corporate W9 Form 2026',
        description: 'Facility-level tax documentation not tied to individual provider.',
        issueDate: '2026-01-01',
        expirationDate: '2026-12-31',
        fileBuffer: dummyPdfBuffer,
        fileName: 'corporate_w9_2026.pdf',
        mimeType: 'application/pdf',
        uploadedById: testUserId,
      });

      createdDocumentIds.push(generalDoc.id);

      expect(generalDoc.id).toBeDefined();
      expect(generalDoc.providerId).toBeNull();
      expect(generalDoc.entityType).toBe('general');
      expect(generalDoc.title).toBe('Clinic Corporate W9 Form 2026');
      expect(generalDoc.currentVersion?.versionNumber).toBe(1);
    });
  });

  // ==========================================
  // 14. Administrator-Only Document Deletion & RBAC
  // ==========================================
  describe('14. Administrator-Only Document Deletion & RBAC', () => {
    let docToDeleteId: string;
    let v1Key: string;
    let v2Key: string;
    let v1Bucket: string;
    let v2Bucket: string;
    let taskId: string;

    beforeAll(async () => {
      // Create a document with Version 1
      const doc = await createDocumentWithVersion({
        entityType: 'provider',
        entityId: testProviderId,
        providerId: testProviderId,
        documentType: 'cme_certificate',
        title: 'CME Trauma Life Support Certificate',
        fileBuffer: dummyPdfBuffer,
        fileName: 'cme_v1.pdf',
        mimeType: 'application/pdf',
        uploadedById: testUserId,
      });
      docToDeleteId = doc.id;
      v1Key = doc.currentVersion!.s3Key;
      v1Bucket = doc.currentVersion!.s3Bucket;

      // Add Version 2
      const v2Result = await addDocumentVersion({
        documentId: docToDeleteId,
        fileBuffer: dummyJpgBuffer,
        fileName: 'cme_v2_updated.jpg',
        mimeType: 'image/jpeg',
        uploadedById: testUserId,
        notes: 'Updated certificate with credit hours.',
      });
      v2Key = v2Result.version.s3Key;
      v2Bucket = v2Result.version.s3Bucket;

      // Create an associated task
      const task = await prisma.task.create({
        data: {
          title: `Review CME Certificate: ${doc.title}`,
          entityType: 'document',
          entityId: docToDeleteId,
          priority: 'medium',
          status: 'pending',
          dueDate: new Date(),
        },
      });
      taskId = task.id;
    });

    it('should enforce RBAC permissions restricting document deletion to administrator roles only', () => {
      // Authorized roles
      expect(hasPermission('super_admin', 'documents:delete')).toBe(true);
      expect(hasPermission('admin', 'documents:delete')).toBe(true);

      // Unauthorized roles
      expect(hasPermission('credentialing_specialist', 'documents:delete')).toBe(false);
      expect(hasPermission('enrollment_specialist', 'documents:delete')).toBe(false);
      expect(hasPermission('viewer', 'documents:delete')).toBe(false);
    });

    it('should delete document, all its version files from S3, and related tasks when an authorized admin deletes', async () => {
      // Confirm files exist in S3 before deletion
      const s3v1Before = await downloadFromS3({ bucket: v1Bucket, key: v1Key });
      expect(s3v1Before.body).toBeDefined();

      const s3v2Before = await downloadFromS3({ bucket: v2Bucket, key: v2Key });
      expect(s3v2Before.body).toBeDefined();

      // Execute authorized admin deletion
      const result = await deleteDocument({
        documentId: docToDeleteId,
        actorId: testAdminUserId,
        actorEmail: 'phase5_admin@example.com',
        actorRole: 'admin',
      });

      expect(result.success).toBe(true);

      // Verify document record is removed from DB
      const dbDoc = await prisma.document.findUnique({ where: { id: docToDeleteId } });
      expect(dbDoc).toBeNull();

      // Verify all versions cascaded in DB
      const dbVersions = await prisma.documentVersion.findMany({ where: { documentId: docToDeleteId } });
      expect(dbVersions.length).toBe(0);

      // Verify associated task is cleaned up
      const dbTask = await prisma.task.findUnique({ where: { id: taskId } });
      expect(dbTask).toBeNull();

      // Verify S3 files are deleted
      await expect(downloadFromS3({ bucket: v1Bucket, key: v1Key })).rejects.toThrow();
      await expect(downloadFromS3({ bucket: v2Bucket, key: v2Key })).rejects.toThrow();
    });
  });

  // ==========================================
  // 15. Audit Record Creation & History Preservation
  // ==========================================
  describe('15. Audit Record Creation & History Preservation', () => {
    it('should create DOCUMENT_DELETED audit log with actor attribution while preserving prior audit events', async () => {
      // Fetch all audit logs for the deleted document
      const auditLogs = await prisma.auditLog.findMany({
        where: { entityType: 'document' },
        orderBy: { createdAt: 'desc' },
      });

      // Find the DOCUMENT_DELETED log
      const deleteLog = auditLogs.find((l) => l.action === 'DOCUMENT_DELETED');
      expect(deleteLog).toBeDefined();
      expect(deleteLog?.userId).toBe(testAdminUserId);
      expect(deleteLog?.userEmail).toBe('phase5_admin@example.com');

      const changes = deleteLog?.changes as Record<string, unknown>;
      expect(changes.title).toBe('CME Trauma Life Support Certificate');
      expect(changes.documentType).toBe('cme_certificate');
      expect(changes.versionCount).toBe(2);
      expect(changes.deletedByRole).toBe('admin');
      expect(Array.isArray(changes.versions)).toBe(true);

      // Historical audit events (DOCUMENT_UPLOADED, DOCUMENT_VERSION_CREATED) must still exist
      const uploadLogs = auditLogs.filter((l) => l.action === 'DOCUMENT_UPLOADED');
      expect(uploadLogs.length).toBeGreaterThanOrEqual(1);

      const versionLogs = auditLogs.filter((l) => l.action === 'DOCUMENT_VERSION_CREATED');
      expect(versionLogs.length).toBeGreaterThanOrEqual(1);
    });
  });
});

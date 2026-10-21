import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { createProviderSchema, updateProviderSchema } from '@/lib/validation/provider';
import { encrypt, decrypt } from '@/lib/encryption/aes';
import { hasPermission } from '@/lib/auth/rbac';
import { UserRole } from '@prisma/client';
import { logAuditEvent } from '@/lib/audit/audit-logger';

describe('Phase 2: Provider Management Module', () => {
  let testLocationId: string;
  let testTaxonomyCode1: string;
  let testTaxonomyCode2: string;
  let createdProviderId: string;

  const testNpi = '9876543210';
  const testSsn = '123-45-6789';

  beforeAll(async () => {
    await prisma.$connect();

    // 1. Ensure test taxonomy codes exist
    const tax1 = await prisma.taxonomyCode.upsert({
      where: { code: '207Q00000X' },
      update: {},
      create: {
        code: '207Q00000X',
        classification: 'Allopathic & Osteopathic Physicians',
        specialization: 'Family Medicine',
      },
    });
    testTaxonomyCode1 = tax1.code;

    const tax2 = await prisma.taxonomyCode.upsert({
      where: { code: '207RC0000X' },
      update: {},
      create: {
        code: '207RC0000X',
        classification: 'Allopathic & Osteopathic Physicians',
        specialization: 'Cardiovascular Disease',
      },
    });
    testTaxonomyCode2 = tax2.code;

    // 2. Ensure test location exists
    const location = await prisma.location.create({
      data: {
        name: 'St. Jude Test Medical Clinic',
        address1: '789 Healthcare Way',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        phone: '(555) 300-4000',
      },
    });
    testLocationId = location.id;
  });

  afterAll(async () => {
    // Clean up created test records
    if (createdProviderId) {
      await prisma.providerSpecialty.deleteMany({ where: { providerId: createdProviderId } });
      await prisma.providerLocation.deleteMany({ where: { providerId: createdProviderId } });
      await prisma.provider.deleteMany({ where: { id: createdProviderId } });
    }
    if (testLocationId) {
      await prisma.location.deleteMany({ where: { id: testLocationId } });
    }
    await prisma.$disconnect();
  });

  // ==========================================
  // 1. Validation Tests
  // ==========================================
  describe('Validation', () => {
    it('should reject provider payload with missing required firstName or lastName', () => {
      const invalid = {
        lastName: 'Smith',
        npiNumber: '1234567890',
      };
      expect(() => createProviderSchema.parse(invalid)).toThrow();
    });

    it('should reject provider payload with invalid NPI (not exactly 10 numeric digits)', () => {
      const invalidShortNpi = {
        firstName: 'John',
        lastName: 'Doe',
        npiNumber: '12345',
      };
      expect(() => createProviderSchema.parse(invalidShortNpi)).toThrow();

      const invalidLettersNpi = {
        firstName: 'John',
        lastName: 'Doe',
        npiNumber: '12345ABCDE',
      };
      expect(() => createProviderSchema.parse(invalidLettersNpi)).toThrow();
    });

    it('should accept valid provider payload conforming to approved schema', () => {
      const valid = {
        firstName: 'Sarah',
        lastName: 'Connor',
        suffix: 'MD',
        npiNumber: '1122334455',
        npiType: 1,
        email: 'sarah.connor@test.local',
        phone: '(555) 999-0000',
        status: 'active' as const,
        credentialingStatus: 'in_progress' as const,
      };
      const parsed = createProviderSchema.parse(valid);
      expect(parsed.firstName).toBe('Sarah');
      expect(parsed.npiNumber).toBe('1122334455');
    });
  });

  // ==========================================
  // 2. Provider Creation & SSN Encryption Tests
  // ==========================================
  describe('Provider Creation & SSN Encryption', () => {
    it('should create provider in database with AES-256 encrypted SSN', async () => {
      const encryptedSsn = encrypt(testSsn);

      const provider = await prisma.provider.create({
        data: {
          firstName: 'Marcus',
          middleName: 'Alexander',
          lastName: 'Welby',
          suffix: 'MD',
          npiNumber: testNpi,
          npiType: 1,
          email: 'marcus.welby@fictional-hospital.org',
          phone: '(555) 432-1098',
          ssnEncrypted: encryptedSsn,
          gender: 'Male',
          primaryTaxonomy: testTaxonomyCode1,
          taxonomyDescription: 'Family Medicine',
          status: 'active',
          credentialingStatus: 'in_progress',
        },
      });

      createdProviderId = provider.id;

      expect(provider.id).toBeDefined();
      expect(provider.npiNumber).toBe(testNpi);
      expect(provider.ssnEncrypted).toBeDefined();

      // Verify encrypted bytes are NOT plaintext
      const ssnRawBytes = Buffer.from(provider.ssnEncrypted!);
      expect(ssnRawBytes.toString('utf8')).not.toContain(testSsn);

      // Verify AES-256 decryption yields original sensitive value
      const decryptedSsn = decrypt(ssnRawBytes);
      expect(decryptedSsn).toBe(testSsn);
    });

    it('should enforce unique NPI constraint at the database layer', async () => {
      await expect(
        prisma.provider.create({
          data: {
            firstName: 'Duplicate',
            lastName: 'NPI',
            npiNumber: testNpi, // Same NPI as created above
          },
        })
      ).rejects.toThrow();
    });
  });

  // ==========================================
  // 3. Relationships: Specialties & Locations
  // ==========================================
  describe('Relationships (Multiple Specialties & Locations)', () => {
    it('should link multiple clinical specialties to provider with primary indicator', async () => {
      // Link Specialty 1 (Primary)
      const spec1 = await prisma.providerSpecialty.create({
        data: {
          providerId: createdProviderId,
          taxonomyCode: testTaxonomyCode1,
          isPrimary: true,
        },
      });
      expect(spec1.isPrimary).toBe(true);

      // Link Specialty 2 (Secondary)
      const spec2 = await prisma.providerSpecialty.create({
        data: {
          providerId: createdProviderId,
          taxonomyCode: testTaxonomyCode2,
          isPrimary: false,
        },
      });
      expect(spec2.isPrimary).toBe(false);

      // Retrieve provider specialties
      const specialties = await prisma.providerSpecialty.findMany({
        where: { providerId: createdProviderId },
        include: { taxonomy: true },
      });

      expect(specialties).toHaveLength(2);
      expect(specialties.some((s) => s.isPrimary && s.taxonomyCode === testTaxonomyCode1)).toBe(true);
      expect(specialties.some((s) => !s.isPrimary && s.taxonomyCode === testTaxonomyCode2)).toBe(true);
    });

    it('should link practice locations to provider via provider_locations join table', async () => {
      const locLink = await prisma.providerLocation.create({
        data: {
          providerId: createdProviderId,
          locationId: testLocationId,
          isPrimary: true,
        },
      });

      expect(locLink.locationId).toBe(testLocationId);
      expect(locLink.isPrimary).toBe(true);

      const providerWithLocations = await prisma.provider.findUnique({
        where: { id: createdProviderId },
        include: {
          locations: {
            include: { location: true },
          },
        },
      });

      expect(providerWithLocations?.locations).toHaveLength(1);
      expect(providerWithLocations?.locations[0].location.name).toBe('St. Jude Test Medical Clinic');
    });

    it('should unlink specialty and location when requested', async () => {
      // Unlink specialty 2
      await prisma.providerSpecialty.delete({
        where: {
          providerId_taxonomyCode: {
            providerId: createdProviderId,
            taxonomyCode: testTaxonomyCode2,
          },
        },
      });

      const remainingSpecialties = await prisma.providerSpecialty.findMany({
        where: { providerId: createdProviderId },
      });
      expect(remainingSpecialties).toHaveLength(1);
      expect(remainingSpecialties[0].taxonomyCode).toBe(testTaxonomyCode1);
    });
  });

  // ==========================================
  // 4. Search and Filtering Tests
  // ==========================================
  describe('Search and Filtering', () => {
    it('should find provider by partial first name search', async () => {
      const results = await prisma.provider.findMany({
        where: {
          firstName: { contains: 'Marc', mode: 'insensitive' },
        },
      });
      expect(results.some((p) => p.id === createdProviderId)).toBe(true);
    });

    it('should find provider by exact 10-digit NPI search', async () => {
      const result = await prisma.provider.findUnique({
        where: { npiNumber: testNpi },
      });
      expect(result).not.toBeNull();
      expect(result?.id).toBe(createdProviderId);
    });

    it('should filter providers by clinical specialty taxonomy code', async () => {
      const results = await prisma.provider.findMany({
        where: {
          specialties: {
            some: { taxonomyCode: testTaxonomyCode1 },
          },
        },
      });
      expect(results.some((p) => p.id === createdProviderId)).toBe(true);
    });

    it('should correctly support pagination and sorting controls', async () => {
      const pageSize = 1;
      const page1 = await prisma.provider.findMany({
        skip: 0,
        take: pageSize,
        orderBy: { lastName: 'asc' },
      });
      expect(page1.length).toBeLessThanOrEqual(pageSize);

      const total = await prisma.provider.count();
      const totalPages = Math.ceil(total / pageSize);
      expect(totalPages).toBeGreaterThanOrEqual(1);

      const page2 = await prisma.provider.findMany({
        skip: 1,
        take: pageSize,
        orderBy: { lastName: 'asc' },
      });
      expect(page2.length).toBeLessThanOrEqual(pageSize);
    });
  });

  // ==========================================
  // 5. Provider Editing & Updates
  // ==========================================
  describe('Provider Editing', () => {
    it('should update demographics and credentialing status cleanly', async () => {
      const updated = await prisma.provider.update({
        where: { id: createdProviderId },
        data: {
          middleName: 'Robert',
          credentialingStatus: 'completed',
          notes: 'Primary source verification completed by credentialing staff.',
        },
      });

      expect(updated.middleName).toBe('Robert');
      expect(updated.credentialingStatus).toBe('completed');
      expect(updated.notes).toContain('Primary source verification');
    });
  });

  // ==========================================
  // 6. Provider Archival (Soft Delete)
  // ==========================================
  describe('Provider Archival', () => {
    it('should archive provider by setting status to archived', async () => {
      const archived = await prisma.provider.update({
        where: { id: createdProviderId },
        data: { status: 'archived' },
      });

      expect(archived.status).toBe('archived');

      // Default active providers query should exclude archived
      const activeProviders = await prisma.provider.findMany({
        where: {
          id: createdProviderId,
          status: { not: 'archived' },
        },
      });
      expect(activeProviders).toHaveLength(0);
    });
  });

  // ==========================================
  // 7. Authorization & RBAC
  // ==========================================
  describe('Authorization', () => {
    it('should allow credentialing_specialist to write providers', () => {
      expect(hasPermission(UserRole.credentialing_specialist, 'providers:write')).toBe(true);
      expect(hasPermission(UserRole.credentialing_specialist, 'providers:read')).toBe(true);
    });

    it('should allow viewer to read providers but NOT write', () => {
      expect(hasPermission(UserRole.viewer, 'providers:read')).toBe(true);
      expect(hasPermission(UserRole.viewer, 'providers:write')).toBe(false);
    });
  });

  // ==========================================
  // 8. Audit Logging Verification
  // ==========================================
  describe('Audit Events for Provider Lifecycle', () => {
    it('should log create_provider and update_provider events in audit_logs', async () => {
      await logAuditEvent({
        userId: null,
        userEmail: 'staff@example.local',
        action: 'create_provider',
        entityType: 'provider',
        entityId: createdProviderId,
        changes: {
          npiNumber: { new: testNpi },
          lastName: { new: 'Welby' },
        },
      });

      await logAuditEvent({
        userId: null,
        userEmail: 'staff@example.local',
        action: 'archive_provider',
        entityType: 'provider',
        entityId: createdProviderId,
        changes: {
          status: { old: 'active', new: 'archived' },
        },
      });

      const auditEntries = await prisma.auditLog.findMany({
        where: {
          entityType: 'provider',
          entityId: createdProviderId,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditEntries.length).toBeGreaterThanOrEqual(2);
      expect(auditEntries.some((a) => a.action === 'create_provider')).toBe(true);
      expect(auditEntries.some((a) => a.action === 'archive_provider')).toBe(true);
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';

describe('Prisma & PostgreSQL Schema Smoke Tests', () => {
  beforeAll(async () => {
    // Check connection to PostgreSQL
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should connect to PostgreSQL and execute raw query', async () => {
    const result = await prisma.$queryRaw<Array<{ value: number }>>`SELECT 1 as value`;
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(1);
  });

  it('should retrieve seeded super admin user from database', async () => {
    const admin = await prisma.user.findUnique({
      where: { email: 'admin@example.com' },
    });
    expect(admin).not.toBeNull();
    expect(admin?.role).toBe('super_admin');
    expect(admin?.isActive).toBe(true);
  });

  it('should retrieve seeded public taxonomy codes', async () => {
    const taxonomyCount = await prisma.taxonomyCode.count();
    expect(taxonomyCount).toBeGreaterThanOrEqual(6);

    const familyMed = await prisma.taxonomyCode.findUnique({
      where: { code: '207Q00000X' },
    });
    expect(familyMed?.specialization).toBe('Family Medicine');
  });

  it('should retrieve seeded credential expiration alert rules with default [90, 60, 30, 14]', async () => {
    const rule = await prisma.credentialExpirationRule.findUnique({
      where: { credentialType: 'state_license' },
    });
    expect(rule).not.toBeNull();
    expect(rule?.alertDaysBefore).toEqual([90, 60, 30, 14]);
  });

  it('should confirm 0 real providers exist in development database (fictional-only policy)', async () => {
    const count = await prisma.provider.count();
    expect(count).toBe(0);
  });

  it('should successfully write to audit_logs table (append-only)', async () => {
    const testAction = `test_audit_${Date.now()}`;
    const log = await prisma.auditLog.create({
      data: {
        action: testAction,
        entityType: 'system_test',
        changes: { test: true },
      },
    });

    expect(log.id).toBeDefined();
    expect(log.action).toBe(testAction);
  });
});

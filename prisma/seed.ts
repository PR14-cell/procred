import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

// AES encryption helper for seed script
function encryptSeed(plaintext: string): Buffer {
  const hexKey = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const key = Buffer.from(hexKey, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

async function main() {
  console.log('Seeding fresh testing installation foundation data...');

  // 1. Create Default Initial Testing Super Admin (Requires immediate password change)
  const tempPassword = process.env.TESTING_BOOTSTRAP_PASSWORD || 'admin';
  const adminPasswordHash = await bcrypt.hash(tempPassword, 12);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin' },
    update: {
      passwordHash: adminPasswordHash,
      mustChangePassword: true,
      isActive: true,
      mfaEnabled: false,
    },
    create: {
      email: 'admin',
      passwordHash: adminPasswordHash,
      firstName: 'Testing',
      lastName: 'Administrator',
      role: UserRole.super_admin,
      isActive: true,
      mustChangePassword: true,
      mfaEnabled: false,
    },
  });
  console.log(`✓ Initial Testing Administrator seeded: ${adminUser.email} (mustChangePassword: true)`);

  // 2. Seed Standard Public Healthcare Taxonomy Codes (Public Data - Not PHI)
  const taxonomyData = [
    {
      code: '207Q00000X',
      classification: 'Allopathic & Osteopathic Physicians',
      specialization: 'Family Medicine',
      definition: 'A physician who provides comprehensive personal care in an ambulatory setting.',
    },
    {
      code: '207R00000X',
      classification: 'Allopathic & Osteopathic Physicians',
      specialization: 'Internal Medicine',
      definition: 'A personal physician who provides long-term, comprehensive care in the office and the hospital.',
    },
    {
      code: '207RC0000X',
      classification: 'Allopathic & Osteopathic Physicians',
      specialization: 'Cardiovascular Disease',
      definition: 'An internist who specializes in diseases of the heart and blood vessels.',
    },
    {
      code: '207N00000X',
      classification: 'Allopathic & Osteopathic Physicians',
      specialization: 'Dermatology',
      definition: 'A physician trained to diagnose and treat pediatric and adult patients with benign and malignant disorders of the skin.',
    },
    {
      code: '363L00000X',
      classification: 'Physician Assistants & Advanced Practice Nursing',
      specialization: 'Nurse Practitioner',
      definition: 'A registered nurse who has completed advanced education and clinical training.',
    },
    {
      code: '363A00000X',
      classification: 'Physician Assistants & Advanced Practice Nursing',
      specialization: 'Physician Assistant',
      definition: 'A healthcare professional licensed to practice medicine with physician supervision.',
    },
  ];

  for (const item of taxonomyData) {
    await prisma.taxonomyCode.upsert({
      where: { code: item.code },
      update: {},
      create: item,
    });
  }
  console.log(`✓ Seeded ${taxonomyData.length} taxonomy codes`);

  // 3. Seed Configurable Credential Expiration Rules (Appendix A & B default: 90, 60, 30, 14 days)
  const defaultRules = [
    { credentialType: 'state_license', alertDaysBefore: [90, 60, 30, 14] },
    { credentialType: 'dea', alertDaysBefore: [90, 60, 30, 14] },
    { credentialType: 'board_certification', alertDaysBefore: [90, 60, 30, 14] },
    { credentialType: 'malpractice_insurance', alertDaysBefore: [90, 60, 30, 14] },
    { credentialType: 'caqh_attestation', alertDaysBefore: [90, 60, 30, 14] },
    { credentialType: 'document', alertDaysBefore: [90, 60, 30, 14] },
  ];

  for (const rule of defaultRules) {
    await prisma.credentialExpirationRule.upsert({
      where: { credentialType: rule.credentialType },
      update: {},
      create: rule,
    });
  }
  console.log(`✓ Seeded ${defaultRules.length} credential expiration alert rules`);

  console.log('Seed completed successfully. Zero real provider data used.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

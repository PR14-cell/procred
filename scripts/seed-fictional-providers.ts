import { PrismaClient, UserRole } from '@prisma/client';
import crypto from 'crypto';
import { encrypt } from '../src/lib/encryption/aes';

const prisma = new PrismaClient();

function encryptSeed(plaintext: string): Buffer {
  return encrypt(plaintext, 'provider.ssn');
}

// 50 Fictional First & Last Names (Fictional Providers)
const FICTIONAL_FIRST_NAMES = [
  'Arthur', 'Beatrice', 'Charles', 'Diana', 'Edward', 'Fiona', 'George', 'Helena', 'Ian', 'Julia',
  'Kevin', 'Laura', 'Marcus', 'Nora', 'Oliver', 'Penelope', 'Quentin', 'Rachel', 'Samuel', 'Theresa',
  'Ulysses', 'Victoria', 'Walter', 'Xavier', 'Yvonne', 'Zachary', 'Amelia', 'Benjamin', 'Clara', 'Daniel',
  'Eleanor', 'Franklin', 'Grace', 'Henry', 'Isabel', 'Joseph', 'Katherine', 'Lucas', 'Margaret', 'Nathan',
  'Olivia', 'Patrick', 'Rose', 'Stephen', 'Timothy', 'Valerie', 'William', 'Zoe', 'Alexander', 'Charlotte'
];

const FICTIONAL_LAST_NAMES = [
  'Adams', 'Bennett', 'Campbell', 'Donovan', 'Evans', 'Fletcher', 'Gibson', 'Hayes', 'Ingram', 'Jenkins',
  'Knight', 'Lawson', 'Marshall', 'Nelson', 'Owens', 'Palmer', 'Quinn', 'Reynolds', 'Sinclair', 'Turner',
  'Underwood', 'Vance', 'Walsh', 'York', 'Zimmerman', 'Armstrong', 'Blackwood', 'Crawford', 'Davenport', 'Ellington',
  'Fairfax', 'Gallagher', 'Harrington', 'Irvine', 'Kensington', 'Livingston', 'Montgomery', 'Norwood', 'Pendleton', 'Radcliffe',
  'Sterling', 'Thornton', 'Vanderbilt', 'Winslow', 'Ainsworth', 'Braddock', 'Carrington', 'Ellsworth', 'Hawthorne', 'Mercer'
];

const STATES = ['TX', 'CA', 'FL', 'NY', 'IL', 'OH', 'PA', 'GA', 'NC', 'MI'];
const SPECIALTIES = [
  { code: '207Q00000X', name: 'Family Medicine', board: 'American Board of Family Medicine' },
  { code: '207R00000X', name: 'Internal Medicine', board: 'American Board of Internal Medicine' },
  { code: '207RC0000X', name: 'Cardiovascular Disease', board: 'American Board of Internal Medicine' },
  { code: '207N00000X', name: 'Dermatology', board: 'American Board of Dermatology' },
  { code: '363L00000X', name: 'Nurse Practitioner', board: 'American Academy of Nurse Practitioners' },
  { code: '363A00000X', name: 'Physician Assistant', board: 'National Commission on Certification of Physician Assistants' },
];

export async function generateFictionalProviders(count = 50) {
  console.log(`Starting generation of ${count} 100% fictional providers...`);

  // Ensure standard test payers exist
  const standardPayers = [
    { name: 'Medicare Part B Fictional', shortName: 'MED-B', payerType: 'medicare' },
    { name: 'Medicaid State Plan Fictional', shortName: 'MCD-ST', payerType: 'medicaid' },
    { name: 'Blue Cross Blue Shield Fictional', shortName: 'BCBS-FIC', payerType: 'commercial' },
    { name: 'Aetna Health Plan Fictional', shortName: 'AET-FIC', payerType: 'commercial' },
    { name: 'UnitedHealthcare Fictional', shortName: 'UHC-FIC', payerType: 'commercial' },
  ];

  const payers = [];
  for (const p of standardPayers) {
    const existing = await prisma.payer.findFirst({ where: { shortName: p.shortName } });
    if (existing) {
      payers.push(existing);
    } else {
      const created = await prisma.payer.create({ data: p });
      payers.push(created);
    }
  }

  const createdProviderIds: string[] = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const npiSuffix = String(i + 1).padStart(7, '0');
    const npiNumber = `999${npiSuffix}`; // 10 digits starting with 999
    const firstName = FICTIONAL_FIRST_NAMES[i % FICTIONAL_FIRST_NAMES.length];
    const lastName = FICTIONAL_LAST_NAMES[i % FICTIONAL_LAST_NAMES.length];
    const state = STATES[i % STATES.length];
    const spec = SPECIALTIES[i % SPECIALTIES.length];

    const fakeSsn = `999-${String(10 + (i % 80)).padStart(2, '0')}-${String(1000 + (i * 17) % 9000).padStart(4, '0')}`;
    const ssnEncrypted = encryptSeed(fakeSsn.replace(/\D/g, ''));

    const birthYear = 1965 + (i % 30);
    const dateOfBirth = new Date(birthYear, (i * 3) % 12, ((i * 5) % 27) + 1);

    // Create provider
    const provider = await prisma.provider.upsert({
      where: { npiNumber },
      update: {},
      create: {
        firstName,
        lastName,
        npiNumber,
        npiType: 1,
        status: 'active',
        credentialingStatus: i % 5 === 0 ? 'completed' : i % 7 === 0 ? 'needs_review' : 'in_progress',
        ssnEncrypted,
        dateOfBirth,
        gender: i % 2 === 0 ? 'Female' : 'Male',
        email: `dr.${firstName.toLowerCase()}.${lastName.toLowerCase()}@fictional-health.org`,
        phone: `555-01${String(10 + (i % 80)).padStart(2, '0')}`,
        primaryTaxonomy: spec.code,
        taxonomyDescription: spec.name,
        caqhId: `CAQH-${npiSuffix}`,
      },
    });

    createdProviderIds.push(provider.id);

    // 1. State License (varied expiration: some active, some expiring soon, some in future)
    const licenseExpOffsetDays = 20 + ((i * 45) % 400); // Between 20 days and 420 days
    await prisma.stateLicense.create({
      data: {
        providerId: provider.id,
        state,
        licenseNumber: `${state}-MD-${npiSuffix}`,
        status: licenseExpOffsetDays <= 30 ? 'expiring_soon' : 'active',
        issueDate: new Date(now - 730 * dayMs),
        expirationDate: new Date(now + licenseExpOffsetDays * dayMs),
        verified: true,
        verifiedAt: new Date(),
      },
    });

    // 2. DEA Registration
    const deaExpOffsetDays = 40 + ((i * 60) % 600);
    await prisma.deaRegistration.create({
      data: {
        providerId: provider.id,
        deaNumber: `BM${npiSuffix.slice(-7)}`,
        state,
        status: 'active',
        issueDate: new Date(now - 730 * dayMs),
        expirationDate: new Date(now + deaExpOffsetDays * dayMs),
        verified: true,
        verifiedAt: new Date(),
      },
    });

    // 3. Board Certification
    await prisma.boardCertification.create({
      data: {
        providerId: provider.id,
        boardName: spec.board,
        specialty: spec.name,
        certificationNumber: `BC-${npiSuffix}`,
        status: 'active',
        initialCertDate: new Date(now - 1460 * dayMs),
        expirationDate: new Date(now + (100 + (i * 30) % 700) * dayMs),
        verified: true,
      },
    });

    // 4. Malpractice Insurance
    await prisma.malpracticeInsurance.create({
      data: {
        providerId: provider.id,
        carrierName: 'The Doctors Company Fictional',
        policyNumber: `POL-${npiSuffix}`,
        coverageType: 'claims_made',
        perClaimAmount: 1000000,
        aggregateAmount: 3000000,
        effectiveDate: new Date(now - 180 * dayMs),
        expirationDate: new Date(now + (60 + (i * 25) % 300) * dayMs),
        status: 'active',
      },
    });

    // 5. CAQH Profile (120-day cycle)
    const lastAttestedDaysAgo = 30 + (i % 90);
    const nextAttestDaysOut = 120 - lastAttestedDaysAgo;
    await prisma.caqhProfile.create({
      data: {
        providerId: provider.id,
        caqhId: `CAQH-${npiSuffix}`,
        attestationStatus: 'attested',
        lastAttestationDate: new Date(now - lastAttestedDaysAgo * dayMs),
        nextAttestationDate: new Date(now + nextAttestDaysOut * dayMs),
      },
    });

    // 6. Payer Enrollments (2 enrollments per provider)
    const payer1 = payers[i % payers.length];
    const payer2 = payers[(i + 1) % payers.length];

    await prisma.payerEnrollment.create({
      data: {
        providerId: provider.id,
        payerId: payer1.id,
        enrollmentType: 'individual',
        status: i % 3 === 0 ? 'approved' : i % 3 === 1 ? 'submitted' : 'in_progress',
        effectiveDate: i % 3 === 0 ? new Date(now - 120 * dayMs) : null,
        revalidationDate: i % 3 === 0 ? new Date(now + (180 + (i * 20) % 500) * dayMs) : null,
        followUpDate: i % 3 === 1 ? new Date(now + 14 * dayMs) : null,
      },
    });

    await prisma.payerEnrollment.create({
      data: {
        providerId: provider.id,
        payerId: payer2.id,
        enrollmentType: 'individual',
        status: 'submitted',
        submittedDate: new Date(now - 10 * dayMs),
        followUpDate: new Date(now + 21 * dayMs),
      },
    });
  }

  console.log(`✓ Successfully seeded ${createdProviderIds.length} fictional providers with complete credentials & enrollments.`);
  return { count: createdProviderIds.length, providerIds: createdProviderIds };
}

if (require.main === module) {
  generateFictionalProviders(50)
    .then((res) => {
      console.log(`Fictional seed completed. Total: ${res.count}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fictional seed failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

import { prisma } from '../src/lib/db/prisma';
import { encrypt, decrypt } from '../src/lib/encryption/aes';

/**
 * scripts/re-encrypt-data.ts
 *
 * Migrates and re-encrypts database records to Version 2 ciphertext format
 * with bound Additional Authenticated Data (AAD) contexts:
 * - Provider SSN: "provider.ssn"
 * - Organization Tax ID: "organization.taxId"
 * - User TOTP Secret: "user.totp_secret"
 * - Credential Password: "credential.password"
 */
async function main() {
  console.log('--- Starting Data Re-Encryption Migration (Version 2 Ciphertext + AAD) ---');

  let providerCount = 0;
  let orgCount = 0;
  let userCount = 0;
  let credCount = 0;

  // 1. Re-encrypt Provider SSNs
  const providers = await prisma.provider.findMany({
    where: { ssnEncrypted: { not: null } },
    select: { id: true, ssnEncrypted: true },
  });

  for (const p of providers) {
    if (p.ssnEncrypted) {
      try {
        const raw = Buffer.from(p.ssnEncrypted);
        // Only re-encrypt if not already v2 or to ensure consistent context
        const plaintext = decrypt(raw, 'provider.ssn');
        const reEncrypted = encrypt(plaintext, 'provider.ssn');

        await prisma.provider.update({
          where: { id: p.id },
          data: { ssnEncrypted: reEncrypted },
        });
        providerCount++;
      } catch (err) {
        console.error(`Failed to re-encrypt provider ${p.id}:`, err);
      }
    }
  }

  // 2. Re-encrypt Organization Tax IDs
  const organizations = await prisma.organization.findMany({
    where: { taxIdEncrypted: { not: null } },
    select: { id: true, taxIdEncrypted: true },
  });

  for (const org of organizations) {
    if (org.taxIdEncrypted) {
      try {
        const raw = Buffer.from(org.taxIdEncrypted);
        const plaintext = decrypt(raw, 'organization.taxId');
        const reEncrypted = encrypt(plaintext, 'organization.taxId');

        await prisma.organization.update({
          where: { id: org.id },
          data: { taxIdEncrypted: reEncrypted },
        });
        orgCount++;
      } catch (err) {
        console.error(`Failed to re-encrypt organization ${org.id}:`, err);
      }
    }
  }

  // 3. Re-encrypt User MFA TOTP Secrets
  const users = await prisma.user.findMany({
    where: { totpSecretEncrypted: { not: null } },
    select: { id: true, totpSecretEncrypted: true },
  });

  for (const u of users) {
    if (u.totpSecretEncrypted) {
      try {
        const raw = Buffer.from(u.totpSecretEncrypted);
        const plaintext = decrypt(raw, 'user.totp_secret');
        const reEncrypted = encrypt(plaintext, 'user.totp_secret');

        await prisma.user.update({
          where: { id: u.id },
          data: { totpSecretEncrypted: reEncrypted },
        });
        userCount++;
      } catch (err) {
        console.error(`Failed to re-encrypt user ${u.id}:`, err);
      }
    }
  }

  // 4. Re-encrypt Credential Passwords (if any)
  const credentials = await prisma.credential.findMany({
    where: { passwordEncrypted: { not: null } },
    select: { id: true, passwordEncrypted: true },
  });

  for (const c of credentials) {
    if (c.passwordEncrypted) {
      try {
        const raw = Buffer.from(c.passwordEncrypted);
        const plaintext = decrypt(raw, 'credential.password');
        const reEncrypted = encrypt(plaintext, 'credential.password');

        await prisma.credential.update({
          where: { id: c.id },
          data: { passwordEncrypted: reEncrypted },
        });
        credCount++;
      } catch (err) {
        console.error(`Failed to re-encrypt credential ${c.id}:`, err);
      }
    }
  }

  console.log(`Re-encryption complete:`);
  console.log(`- Providers re-encrypted: ${providerCount}`);
  console.log(`- Organizations re-encrypted: ${orgCount}`);
  console.log(`- Users re-encrypted: ${userCount}`);
  console.log(`- Credentials re-encrypted: ${credCount}`);
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

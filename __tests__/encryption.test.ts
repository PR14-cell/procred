import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { encrypt, decrypt, getEncryptionKey } from '@/lib/encryption/aes';

describe('AES-256-GCM Encryption Foundation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should encrypt and decrypt a plaintext string successfully (round-trip)', () => {
    const sensitiveString = '123-45-6789'; // e.g. SSN or CAQH Password
    const encrypted = encrypt(sensitiveString);

    expect(encrypted).toBeInstanceOf(Buffer);
    expect(encrypted.length).toBeGreaterThan(sensitiveString.length);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(sensitiveString);
  });

  it('should generate different ciphertexts for the same plaintext due to random IV', () => {
    const text = 'test_secret_value';
    const encrypted1 = encrypt(text);
    const encrypted2 = encrypt(text);

    expect(encrypted1.equals(encrypted2)).toBe(false);
    expect(decrypt(encrypted1)).toBe(text);
    expect(decrypt(encrypted2)).toBe(text);
  });

  it('should fail decryption when ciphertext or authentication tag is tampered with', () => {
    const text = 'unaltered_message';
    const encrypted = encrypt(text);

    // Tamper with the last byte
    encrypted[encrypted.length - 1] ^= 0xff;

    expect(() => decrypt(encrypted)).toThrow();
  });

  describe('Section F: Ciphertext Versioning, Context Binding (AAD), and Key Rotation', () => {
    it('prepends version byte 0x02 to all newly encrypted ciphertexts', () => {
      const plaintext = 'sensitive_data';
      const encrypted = encrypt(plaintext, 'provider.ssn');

      expect(encrypted[0]).toBe(0x02);
      // Format: 1 byte version + 12 bytes IV + 16 bytes tag + ciphertext
      expect(encrypted.length).toBe(1 + 12 + 16 + Buffer.byteLength(plaintext));
    });

    it('binds ciphertext to context string as AAD and successfully decrypts with matching context', () => {
      const ssn = '987-65-4321';
      const encrypted = encrypt(ssn, 'provider.ssn');

      const decrypted = decrypt(encrypted, 'provider.ssn');
      expect(decrypted).toBe(ssn);
    });

    it('fails decryption when decrypted with a mismatched context string (AAD tampering prevention)', () => {
      const ssn = '987-65-4321';
      const encrypted = encrypt(ssn, 'provider.ssn');

      // Attempting to decrypt provider SSN as organization Tax ID must fail authentication
      expect(() => decrypt(encrypted, 'organization.taxId')).toThrow();
    });

    it('remains backward-compatible with legacy unversioned/v1 ciphertext without version byte or AAD', () => {
      // Craft a legacy unversioned AES-256-GCM ciphertext: [12-byte IV][16-byte Tag][Ciphertext]
      const key = getEncryptionKey();
      const iv = crypto.randomBytes(12);
      const plaintext = 'legacy_unversioned_tin_123456789';

      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
      const tag = cipher.getAuthTag();

      // Legacy packing: no version byte, no AAD
      const legacyCiphertext = Buffer.concat([iv, tag, enc]);
      expect(legacyCiphertext.length).toBe(12 + 16 + Buffer.byteLength(plaintext));

      // Decrypt using updated decrypt function with or without context
      const decryptedWithContext = decrypt(legacyCiphertext, 'organization.taxId');
      expect(decryptedWithContext).toBe(plaintext);

      const decryptedWithoutContext = decrypt(legacyCiphertext);
      expect(decryptedWithoutContext).toBe(plaintext);
    });

    it('supports key rotation via ENCRYPTION_KEY_PREVIOUS', () => {
      const oldKeyHex = '1111111111111111111111111111111111111111111111111111111111111112';
      const newKeyHex = '2222222222222222222222222222222222222222222222222222222222222223';

      // 1. Encrypt data using old key
      process.env.ENCRYPTION_KEY = oldKeyHex;
      delete process.env.ENCRYPTION_KEY_PREVIOUS;

      const secretData = 'confidential_payer_secret';
      const encryptedUnderOldKey = encrypt(secretData, 'credential.password');

      // 2. Rotate to new key, setting old key as ENCRYPTION_KEY_PREVIOUS
      process.env.ENCRYPTION_KEY = newKeyHex;
      process.env.ENCRYPTION_KEY_PREVIOUS = oldKeyHex;

      // 3. Decrypting data encrypted under old key must succeed via fallback
      const decrypted = decrypt(encryptedUnderOldKey, 'credential.password');
      expect(decrypted).toBe(secretData);

      // 4. Encrypting new data uses the new key
      const encryptedUnderNewKey = encrypt('new_data', 'credential.password');
      expect(decrypt(encryptedUnderNewKey, 'credential.password')).toBe('new_data');
    });
  });
});

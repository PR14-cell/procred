import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '@/lib/encryption/aes';

describe('AES-256-GCM Encryption Foundation', () => {
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
});

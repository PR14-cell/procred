import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16; // Standard 128-bit authentication tag
const VERSION_BYTE = 0x02; // Version 2 ciphertext format
const SEQUENTIAL_PLACEHOLDER = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export function validateEncryptionKey(keyString?: string): Buffer {
  if (arguments.length > 0 && (!keyString || typeof keyString !== 'string')) {
    throw new Error('ENCRYPTION_KEY environment variable is missing.');
  }

  const hexKey = arguments.length > 0 ? keyString : process.env.ENCRYPTION_KEY;
  if (!hexKey || typeof hexKey !== 'string') {
    throw new Error('ENCRYPTION_KEY environment variable is missing.');
  }

  const trimmed = hexKey.trim();
  if (trimmed.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(
      'ENCRYPTION_KEY environment variable must be a 64-character hex string (32 bytes).'
    );
  }

  if (trimmed.toLowerCase() === SEQUENTIAL_PLACEHOLDER) {
    throw new Error('ENCRYPTION_KEY cannot be the insecure sequential placeholder.');
  }

  if (/^(.)\1+$/.test(trimmed.toLowerCase())) {
    throw new Error('ENCRYPTION_KEY cannot be a single repeated character.');
  }

  return Buffer.from(trimmed, 'hex');
}

export function getEncryptionKey(): Buffer {
  return validateEncryptionKey();
}

export function getPreviousEncryptionKey(): Buffer | null {
  const prev = process.env.ENCRYPTION_KEY_PREVIOUS;
  if (!prev || typeof prev !== 'string' || !prev.trim()) {
    return null;
  }
  return validateEncryptionKey(prev.trim());
}

/**
 * Returns available decryption keys in order of precedence:
 * 1. Current ENCRYPTION_KEY
 * 2. Rotated ENCRYPTION_KEY_PREVIOUS (if configured)
 */
function getDecryptionKeys(): Buffer[] {
  const primary = getEncryptionKey();
  const keys = [primary];
  try {
    const prev = getPreviousEncryptionKey();
    if (prev && !prev.equals(primary)) {
      keys.push(prev);
    }
  } catch {}
  return keys;
}

/**
 * Encrypts a string or Buffer using AES-256-GCM with a 1-byte version prefix (0x02)
 * and optional context bound as Additional Authenticated Data (AAD).
 *
 * Packed format: [Version (1 byte: 0x02)][12-byte IV][16-byte Auth Tag][Ciphertext]
 */
export function encrypt(plaintext: string | Buffer, context?: string): Buffer {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  if (context) {
    cipher.setAAD(Buffer.from(context, 'utf8'));
  }

  const inputBuffer = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const encrypted = Buffer.concat([cipher.update(inputBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([Buffer.from([VERSION_BYTE]), iv, authTag, encrypted]);
}

const STANDARD_CONTEXTS = [
  'organization.taxId',
  'provider.ssn',
  'user.totp_secret',
  'credential.password',
];

/**
 * Decrypts an AES-256-GCM encrypted Buffer.
 * Supports:
 * - Version 2 (0x02) format with AAD context binding and key rotation (ENCRYPTION_KEY + ENCRYPTION_KEY_PREVIOUS).
 * - Automatic discovery among standard contexts when context parameter is omitted.
 * - Strict context verification when context parameter is provided.
 * - Legacy unversioned/v1 format: [12-byte IV][16-byte Auth Tag][Ciphertext] without AAD.
 */
export function decrypt(encryptedBuffer: Buffer, context?: string): string {
  if (!encryptedBuffer || encryptedBuffer.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted buffer format: too short.');
  }

  const keys = getDecryptionKeys();
  const isV2 = encryptedBuffer[0] === VERSION_BYTE && encryptedBuffer.length >= 1 + IV_LENGTH + AUTH_TAG_LENGTH;

  if (isV2) {
    const iv = encryptedBuffer.subarray(1, 1 + IV_LENGTH);
    const authTag = encryptedBuffer.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = encryptedBuffer.subarray(1 + IV_LENGTH + AUTH_TAG_LENGTH);

    // If context is explicitly provided, test that context first, then fall back to uncontexted.
    // If context is omitted, test without AAD first, then test standard known contexts.
    const contextsToTry: Array<string | undefined> =
      context !== undefined ? [context, undefined] : [undefined, ...STANDARD_CONTEXTS];

    for (const ctx of contextsToTry) {
      for (const key of keys) {
        try {
          const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
          decipher.setAuthTag(authTag);
          if (ctx) {
            decipher.setAAD(Buffer.from(ctx, 'utf8'));
          }
          const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
          return decrypted.toString('utf8');
        } catch {
          // Continue trying next key or context
        }
      }
    }
  }

  // Legacy fallback: unversioned format [12-byte IV][16-byte Auth Tag][Ciphertext] without AAD
  const legacyIv = encryptedBuffer.subarray(0, IV_LENGTH);
  const legacyAuthTag = encryptedBuffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const legacyCiphertext = encryptedBuffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  for (const key of keys) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, legacyIv);
      decipher.setAuthTag(legacyAuthTag);
      // Legacy format has no AAD
      const decrypted = Buffer.concat([decipher.update(legacyCiphertext), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      // Try next key
    }
  }

  throw new Error('Decryption failed: invalid ciphertext, wrong key, context mismatch, or authentication tag mismatch.');
}

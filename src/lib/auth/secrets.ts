/**
 * src/lib/auth/secrets.ts
 * Cryptographic secret loader and validator for NextAuth / JWT tokens.
 * Enforces minimum entropy and strictly rejects known insecure placeholders.
 */

const KNOWN_PLACEHOLDERS = [
  'fallback_secret_min_32_characters_long_for_dev',
  'fictional_demo_secret_key_change_in_production_min32chars',
  'change_me_to_a_strong_secret_key_32chars',
  'your_secret_key_here_must_be_32_chars',
  'your-nextauth-secret-here-at-least-32-chars-long',
  '01234567890123456789012345678901',
  'abcdefghijklmnopqrstuvwxyz123456',
  'secret',
  'changeme',
];

export function validateJwtSecret(secret?: string): string {
  if (arguments.length > 0 && (!secret || typeof secret !== 'string')) {
    throw new Error('NEXTAUTH_SECRET environment variable is missing.');
  }

  const s = arguments.length > 0 ? secret : process.env.NEXTAUTH_SECRET;
  if (!s || typeof s !== 'string') {
    throw new Error('NEXTAUTH_SECRET environment variable is missing.');
  }

  const trimmed = s.trim();
  if (trimmed.length < 32) {
    throw new Error('NEXTAUTH_SECRET must be at least 32 characters long.');
  }

  const normalized = trimmed.toLowerCase();
  for (const placeholder of KNOWN_PLACEHOLDERS) {
    if (
      normalized === placeholder.toLowerCase() ||
      normalized.includes('change_me') ||
      normalized.includes('fallback_secret') ||
      normalized.includes('fictional_demo') ||
      normalized.includes('your-nextauth-secret') ||
      normalized.includes('your_secret_key')
    ) {
      throw new Error(
        `NEXTAUTH_SECRET cannot be a known insecure placeholder ('${trimmed}'). Please configure a secure secret.`
      );
    }
  }

  // Reject single repeated character
  if (new Set(trimmed).size <= 2) {
    throw new Error('NEXTAUTH_SECRET cannot be a placeholder or repeated character.');
  }

  return trimmed;
}

export function getJwtSecret(): Uint8Array {
  const secret = validateJwtSecret();
  return new TextEncoder().encode(secret);
}

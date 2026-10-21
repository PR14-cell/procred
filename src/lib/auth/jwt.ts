import { SignJWT, jwtVerify } from 'jose';
import { UserRole } from '@prisma/client';

export interface UserSessionPayload {
  userId: string;
  email: string;
  role: UserRole;
  sessionId: string;
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET || 'fallback_secret_min_32_characters_long_for_dev';
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: UserSessionPayload, expiresIn = '8h'): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<UserSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as UserRole,
      sessionId: payload.sessionId as string,
    };
  } catch {
    return null;
  }
}

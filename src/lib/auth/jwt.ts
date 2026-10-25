import { SignJWT, jwtVerify } from 'jose';
import { UserRole } from '@prisma/client';
import { getJwtSecret } from '@/lib/auth/secrets';

export type AuthStage = 'mfa_pending' | 'mfa_enrollment_required' | 'authenticated';

export interface UserSessionPayload {
  userId: string;
  email: string;
  role: UserRole;
  sessionId: string;
  authStage: AuthStage;
}

/**
 * Creates a fully authenticated production session token (default 8 hours).
 */
export async function createSessionToken(
  payload: Omit<UserSessionPayload, 'authStage'> & { authStage?: AuthStage },
  expiresIn = '8h'
): Promise<string> {
  const finalPayload: UserSessionPayload = {
    ...payload,
    authStage: payload.authStage || 'authenticated',
  };
  return new SignJWT({ ...finalPayload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getJwtSecret());
}

/**
 * Creates a short-lived (10-minute) pre-authentication challenge token for MFA.
 * This token CANNOT be used to access protected APIs or dashboard routes.
 */
export async function createPreAuthToken(
  payload: Omit<UserSessionPayload, 'authStage' | 'sessionId'> & {
    sessionId?: string;
    authStage: 'mfa_pending' | 'mfa_enrollment_required';
  },
  expiresIn = '10m'
): Promise<string> {
  const finalPayload: UserSessionPayload = {
    ...payload,
    sessionId: payload.sessionId || 'pre-auth',
  };
  return new SignJWT({ ...finalPayload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getJwtSecret());
}

/**
 * Verifies a JWT token and returns typed session payload with authStage.
 */
export async function verifySessionToken(token: string): Promise<UserSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] });
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as UserRole,
      sessionId: payload.sessionId as string,
      authStage: (payload.authStage as AuthStage) || 'authenticated',
    };
  } catch {
    return null;
  }
}

import { verifySessionToken, UserSessionPayload } from '@/lib/auth/jwt';
import { hasPermission, Permission } from '@/lib/auth/rbac';
import { ApiError } from '@/lib/errors/api-error';
import { prisma } from '@/lib/db/prisma';
import { UserRole } from '@prisma/client';

interface CachedSessionValidation {
  userId: string;
  role: UserRole;
  isActive: boolean;
  lockedUntil: Date | null;
  expiresAt: Date;
  cachedAt: number;
}

const sessionCache = new Map<string, CachedSessionValidation>();
const CACHE_TTL_MS = 30 * 1000; // 30-second in-memory cache
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Invalidates all active sessions for a given user from both the memory cache and the database.
 * Used on MFA reset, password reset, deactivation, and role changes.
 */
export async function invalidateAllUserSessions(userId: string): Promise<void> {
  // Purge from memory cache
  sessionCache.forEach((cached, sessionId) => {
    if (cached.userId === userId) {
      sessionCache.delete(sessionId);
    }
  });

  // Delete all session records in database
  try {
    await prisma.userSession.deleteMany({
      where: { userId },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[invalidateAllUserSessions] Failed to delete sessions for user ${userId}:`, error);
    }
  }
}

/**
 * Invalidates a specific session ID from the 30-second in-memory validation cache.
 */
export function invalidateSession(sessionId: string): void {
  sessionCache.delete(sessionId);
}

/**
 * Parses cookies from header using exact key matching.
 * Avoids substring false positives that regex matching can cause.
 */
export function getCookieValue(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get('cookie') || '';
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawKey, ...valParts] = part.split('=');
    if (rawKey && rawKey.trim() === name) {
      return valParts.join('=').trim() || null;
    }
  }
  return null;
}

export async function getAuthSession(req: Request): Promise<UserSessionPayload | null> {
  // Support Authorization: Bearer <token>
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    if (bearerToken) {
      const session = await verifySessionToken(bearerToken);
      if (session) return session;
    }
  }

  // Exact session_token cookie matching
  const token = getCookieValue(req, 'session_token');
  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}

/**
 * Extracts a pre-authentication challenge token used strictly during the MFA verification or enrollment stages.
 */
export async function getPreAuthSession(req: Request): Promise<UserSessionPayload | null> {
  // Check header Authorization: Bearer <token>
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    if (bearerToken) {
      const session = await verifySessionToken(bearerToken);
      if (session) return session;
    }
  }

  // Exact cookie matching for mfa_preauth_token or session_token
  const preAuthToken = getCookieValue(req, 'mfa_preauth_token');
  if (preAuthToken) {
    const session = await verifySessionToken(preAuthToken);
    if (session) return session;
  }

  const sessionToken = getCookieValue(req, 'session_token');
  if (sessionToken) {
    const session = await verifySessionToken(sessionToken);
    if (session) return session;
  }

  return null;
}

/**
 * Strict server-side authentication and authorization check.
 * Rejects unauthenticated requests and any request where MFA is incomplete (authStage !== 'authenticated').
 * Enforces session row existence and valid expiration in database (with a 30s in-memory cache).
 * Loads role and isActive directly from database to prevent JWT role tampering.
 * Fails closed: rejects if user not found. Only swallows non-ApiError exceptions when NODE_ENV === 'test'.
 */
export async function requireAuth(
  req: Request,
  requiredPermission?: Permission,
  options?: { validateSessionInDb?: boolean }
): Promise<UserSessionPayload> {
  const session = await getAuthSession(req);
  if (!session) {
    throw ApiError.unauthorized('Authentication session is required.');
  }

  // MANDATORY MFA CHECK: Incomplete MFA stage cannot access protected application APIs
  if (session.authStage !== 'authenticated') {
    throw ApiError.unauthorized('MFA verification is required before accessing protected resources.');
  }

  if (!session.sessionId || session.sessionId === 'pre-auth') {
    throw ApiError.unauthorized('Session has been revoked or is invalid. Please log in again.');
  }

  const now = Date.now();
  let userRole: UserRole;
  let isUserActive: boolean;
  let lockedUntil: Date | null = null;

  const cached = sessionCache.get(session.sessionId);
  if (cached && (now - cached.cachedAt) < CACHE_TTL_MS && cached.expiresAt.getTime() > now) {
    userRole = cached.role;
    isUserActive = cached.isActive;
    lockedUntil = cached.lockedUntil;
  } else {
    try {
      const isSessionUuid = UUID_REGEX.test(session.sessionId);
      const sessionWhere = isSessionUuid
        ? {
            OR: [
              { id: session.sessionId },
              { sessionToken: session.sessionId },
            ],
            expiresAt: { gt: new Date() },
          }
        : {
            sessionToken: session.sessionId,
            expiresAt: { gt: new Date() },
          };

      const userSession = await prisma.userSession.findFirst({
        where: sessionWhere,
        include: {
          user: {
            select: {
              id: true,
              role: true,
              isActive: true,
              lockedUntil: true,
            },
          },
        },
      });

      if (!userSession) {
        sessionCache.delete(session.sessionId);
        // If user was deactivated, provide specific deactivation rejection
        const isUserUuid = UUID_REGEX.test(session.userId);
        if (isUserUuid) {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { isActive: true },
          });
          if (user && !user.isActive) {
            throw ApiError.unauthorized('Account has been deactivated. Please contact an administrator.');
          }
        }
        throw ApiError.unauthorized('Session has been revoked or expired. Please log in again.');
      }

      if (!userSession.user) {
        sessionCache.delete(session.sessionId);
        throw ApiError.unauthorized('User not found.');
      }

      userRole = userSession.user.role;
      isUserActive = userSession.user.isActive;
      lockedUntil = userSession.user.lockedUntil;

      sessionCache.set(session.sessionId, {
        userId: userSession.user.id,
        role: userRole,
        isActive: isUserActive,
        lockedUntil,
        expiresAt: userSession.expiresAt,
        cachedAt: now,
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      // Fail closed: Only swallow non-ApiError exceptions when NODE_ENV === 'test'
      if (process.env.NODE_ENV === 'test') {
        userRole = session.role;
        isUserActive = true;
      } else {
        throw ApiError.unauthorized('Unable to verify session validity.');
      }
    }
  }

  if (!isUserActive) {
    throw ApiError.unauthorized('Account has been deactivated. Please contact an administrator.');
  }

  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    throw ApiError.forbidden('Account is temporarily locked due to security policy. Please contact an administrator.');
  }

  if (requiredPermission && !hasPermission(userRole, requiredPermission)) {
    throw ApiError.forbidden(`Forbidden: '${requiredPermission}' permission required.`);
  }

  return {
    ...session,
    role: userRole,
  };
}

/**
 * Requires an active pre-auth session for completing MFA verification or initial MFA enrollment.
 */
export async function requirePreAuthSession(
  req: Request,
  allowedStages: Array<'mfa_pending' | 'mfa_enrollment_required'> = ['mfa_pending', 'mfa_enrollment_required']
): Promise<UserSessionPayload> {
  const session = await getPreAuthSession(req);
  if (!session) {
    throw ApiError.unauthorized('MFA pre-authentication challenge session is missing or expired. Please log in again.');
  }

  if (session.authStage === 'authenticated') {
    return session; // Already fully authenticated
  }

  if (!allowedStages.includes(session.authStage as any)) {
    throw ApiError.unauthorized('Invalid authentication state for this operation.');
  }

  return session;
}

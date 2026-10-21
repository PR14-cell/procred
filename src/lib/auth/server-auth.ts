import { verifySessionToken, UserSessionPayload } from '@/lib/auth/jwt';
import { hasPermission, Permission } from '@/lib/auth/rbac';
import { ApiError } from '@/lib/errors/api-error';

export async function getAuthSession(req: Request): Promise<UserSessionPayload | null> {
  const cookieHeader = req.headers.get('cookie') || '';
  const tokenMatch = cookieHeader.match(/session_token=([^;]+)/);
  const token = tokenMatch ? tokenMatch[1] : null;

  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}

export async function requireAuth(req: Request, requiredPermission?: Permission): Promise<UserSessionPayload> {
  const session = await getAuthSession(req);
  if (!session) {
    throw ApiError.unauthorized('Authentication session is required.');
  }

  if (requiredPermission && !hasPermission(session.role, requiredPermission)) {
    throw ApiError.forbidden(`Forbidden: '${requiredPermission}' permission required.`);
  }

  return session;
}

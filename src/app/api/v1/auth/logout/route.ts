import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { verifySessionToken } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db/prisma';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { invalidateSession, getCookieValue } from '@/lib/auth/server-auth';

export const POST = withErrorHandler(async (req: Request) => {
  const token = getCookieValue(req, 'session_token');

  if (token) {
    const session = await verifySessionToken(token);
    if (session) {
      if (session.sessionId) {
        invalidateSession(session.sessionId);
      }
      await prisma.userSession.deleteMany({
        where: {
          OR: [
            { id: session.sessionId },
            { sessionToken: session.sessionId },
            { sessionToken: token },
          ],
        },
      });

      await logAuditEvent({
        userId: session.userId,
        userEmail: session.email,
        action: 'logout',
        entityType: 'user',
        entityId: session.userId,
      });
    }
  }

  const response = NextResponse.json({ success: true, message: 'Logged out successfully.' });
  response.cookies.delete('session_token');
  response.cookies.delete('mfa_preauth_token');
  return response;
});

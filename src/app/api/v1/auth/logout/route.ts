import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { verifySessionToken } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db/prisma';
import { logAuditEvent } from '@/lib/audit/audit-logger';

export const POST = withErrorHandler(async (req: Request) => {
  const cookieHeader = req.headers.get('cookie') || '';
  const tokenMatch = cookieHeader.match(/session_token=([^;]+)/);
  const token = tokenMatch ? tokenMatch[1] : null;

  if (token) {
    const session = await verifySessionToken(token);
    if (session) {
      await prisma.userSession.deleteMany({
        where: { id: session.sessionId },
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
  return response;
});

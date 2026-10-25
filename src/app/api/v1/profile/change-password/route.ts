import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { prisma } from '@/lib/db/prisma';
import { changePasswordSchema } from '@/lib/validation/user';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { CacheService } from '@/lib/cache/redis-cache';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_PREFIX = 'rate_limit:pwd_change:';
const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 900; // 15 minutes

// POST /api/v1/profile/change-password - Change own password
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req);

  // 1. Rate Limiting Check
  const rateLimitKey = `${RATE_LIMIT_PREFIX}${session.userId}`;
  const attempts = (await CacheService.get<number>(rateLimitKey)) || 0;
  if (attempts >= MAX_ATTEMPTS) {
    throw ApiError.badRequest(
      'Too many failed password change attempts. Please try again after 15 minutes.'
    );
  }

  const body = await req.json();
  const data = changePasswordSchema.parse(body);

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
  });

  if (!user) {
    throw ApiError.notFound('User not found.');
  }

  // 2. Verify current password
  const isMatch = await bcrypt.compare(data.currentPassword, user.passwordHash);
  if (!isMatch) {
    await CacheService.set(rateLimitKey, attempts + 1, WINDOW_SECONDS);
    await logAuditEvent({
      userId: session.userId,
      userEmail: session.email,
      action: 'password_change_failed',
      entityType: 'user',
      entityId: session.userId,
      metadata: { reason: 'incorrect_current_password' },
    });
    throw ApiError.badRequest('Incorrect current password.');
  }

  // 3. Reset rate limit counter on success
  await CacheService.del(rateLimitKey);

  // 4. Hash new password
  const newPasswordHash = await bcrypt.hash(data.newPassword, 12);

  // 5. Update password in database
  await prisma.user.update({
    where: { id: session.userId },
    data: { passwordHash: newPasswordHash },
  });

  // 6. Invalidate all other sessions except current session
  await prisma.userSession.deleteMany({
    where: {
      userId: session.userId,
      id: { not: session.sessionId },
    },
  });

  // 7. Audit log (never log passwords or hashes)
  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'password_changed',
    entityType: 'user',
    entityId: session.userId,
  });

  return NextResponse.json({
    success: true,
    message: 'Password changed successfully. Other active sessions have been invalidated.',
  });
});

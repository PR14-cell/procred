import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server-auth';
import { withErrorHandler } from '@/lib/errors/api-error';
import { markAllNotificationsAsRead } from '@/lib/notifications/notification-service';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandler(async (request: Request) => {
  const session = await requireAuth(request);
  const result = await markAllNotificationsAsRead(session.userId);

  return NextResponse.json({ success: true, ...result });
});

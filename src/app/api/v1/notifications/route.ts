import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server-auth';
import { withErrorHandler } from '@/lib/errors/api-error';
import { getUserNotifications } from '@/lib/notifications/notification-service';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async (request: Request) => {
  const session = await requireAuth(request);
  const { searchParams } = new URL(request.url);

  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const unreadOnly = searchParams.get('unreadOnly') === 'true';
  const type = searchParams.get('type') || undefined;

  const result = await getUserNotifications({
    userId: session.userId,
    page,
    limit,
    unreadOnly,
    type,
  });

  return NextResponse.json(result);
});

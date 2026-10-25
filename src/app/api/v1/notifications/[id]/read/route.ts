import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server-auth';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { markNotificationAsRead } from '@/lib/notifications/notification-service';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

export const PATCH = withErrorHandler(
  async (request: Request, context?: RouteContext) => {
    const session = await requireAuth(request);
    const notificationId = context!.params.id;

    const updated = await markNotificationAsRead(notificationId, session.userId);
    if (!updated) {
      throw ApiError.notFound('Notification not found or access denied');
    }

    return NextResponse.json({ success: true, notification: updated });
  }
);

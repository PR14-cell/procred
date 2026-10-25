import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/server-auth';
import { withErrorHandler } from '@/lib/errors/api-error';
import {
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
} from '@/lib/notifications/notification-service';

export const dynamic = 'force-dynamic';

const preferencesSchema = z.object({
  emailEnabled: z.boolean().optional(),
  expirationAlerts: z.boolean().optional(),
  revalidationAlerts: z.boolean().optional(),
  taskAlerts: z.boolean().optional(),
  missingDocAlerts: z.boolean().optional(),
  dailyDigest: z.boolean().optional(),
});

export const GET = withErrorHandler(async (request: Request) => {
  const session = await requireAuth(request);
  const preferences = await getUserNotificationPreferences(session.userId);
  return NextResponse.json({ preferences });
});

export const PUT = withErrorHandler(async (request: Request) => {
  const session = await requireAuth(request);
  const body = await request.json();
  const validated = preferencesSchema.parse(body);

  const updated = await updateUserNotificationPreferences(session.userId, validated);
  return NextResponse.json({ success: true, preferences: updated });
});

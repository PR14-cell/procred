import { prisma } from '@/lib/db/prisma';

export interface DispatchNotificationParams {
  userId: string;
  type:
    | 'credential_expiring'
    | 'credential_expired'
    | 'task_assigned'
    | 'task_due'
    | 'caqh_attestation_due'
    | 'verification_needed'
    | 'enrollment_status_change'
    | 'enrollment_follow_up_due'
    | 'system_alert';
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
}

export async function dispatchNotification(params: DispatchNotificationParams) {
  try {
    // 1. Create In-App Notification in DB
    const notification = await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        entityType: params.entityType,
        entityId: params.entityId,
        isRead: false,
        emailSent: false, // In development, email dispatch is stubbed
      },
    });

    // 2. Structured log for development and audit observability
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[NotificationAdapter] Dispatched [${params.type}] to user ${params.userId}: ${params.title}`);
    }

    return notification;
  } catch (error) {
    console.error('[NotificationAdapterError] Failed to dispatch notification:', error);
    throw error;
  }
}

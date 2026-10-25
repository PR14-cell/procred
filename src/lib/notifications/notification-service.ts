import { prisma } from '@/lib/db/prisma';
import {
  sendEmail,
  buildCredentialExpirationEmail,
  buildRevalidationDueEmail,
  buildTaskAlertEmail,
} from '@/lib/email/email-service';

export interface GetNotificationsParams {
  userId: string;
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
  type?: string;
}

export async function getUserNotifications(params: GetNotificationsParams) {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = { userId: params.userId };
  if (params.unreadOnly) {
    where.isRead = false;
  }
  if (params.type) {
    where.type = params.type;
  }

  const [items, totalCount, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: params.userId, isRead: false } }),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit) || 1,
    },
    unreadCount,
  };
}

export async function markNotificationAsRead(notificationId: string, userId: string) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });

  if (!notification) {
    return null;
  }

  return await prisma.notification.update({
    where: { id: notificationId },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
}

export async function markAllNotificationsAsRead(userId: string) {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });

  return { updatedCount: result.count };
}

export async function getUserNotificationPreferences(userId: string) {
  let pref = await prisma.notificationPreference.findUnique({
    where: { userId },
  });

  if (!pref) {
    // Return default preferences
    pref = {
      id: 'default',
      userId,
      emailEnabled: true,
      expirationAlerts: true,
      revalidationAlerts: true,
      taskAlerts: true,
      missingDocAlerts: true,
      dailyDigest: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  return pref;
}

export async function updateUserNotificationPreferences(
  userId: string,
  data: {
    emailEnabled?: boolean;
    expirationAlerts?: boolean;
    revalidationAlerts?: boolean;
    taskAlerts?: boolean;
    missingDocAlerts?: boolean;
    dailyDigest?: boolean;
  }
) {
  return await prisma.notificationPreference.upsert({
    where: { userId },
    create: {
      userId,
      emailEnabled: data.emailEnabled ?? true,
      expirationAlerts: data.expirationAlerts ?? true,
      revalidationAlerts: data.revalidationAlerts ?? true,
      taskAlerts: data.taskAlerts ?? true,
      missingDocAlerts: data.missingDocAlerts ?? true,
      dailyDigest: data.dailyDigest ?? true,
    },
    update: {
      ...(data.emailEnabled !== undefined && { emailEnabled: data.emailEnabled }),
      ...(data.expirationAlerts !== undefined && { expirationAlerts: data.expirationAlerts }),
      ...(data.revalidationAlerts !== undefined && { revalidationAlerts: data.revalidationAlerts }),
      ...(data.taskAlerts !== undefined && { taskAlerts: data.taskAlerts }),
      ...(data.missingDocAlerts !== undefined && { missingDocAlerts: data.missingDocAlerts }),
      ...(data.dailyDigest !== undefined && { dailyDigest: data.dailyDigest }),
    },
  });
}

export interface DispatchParams {
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
    | 'missing_document'
    | 'system_alert';
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  emailDetails?: {
    daysRemaining?: number;
    providerName?: string;
    payerName?: string;
    identifier?: string;
    expirationDate?: string;
    revalidationDate?: string;
    priority?: string;
    dueDate?: string;
  };
}

export async function dispatchNotification(params: DispatchParams) {
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
      emailSent: false,
    },
  });

  // 2. Check User Email Notification Preferences
  try {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      include: { notificationPreference: true },
    });

    if (user && user.email) {
      const prefs = user.notificationPreference || {
        emailEnabled: true,
        expirationAlerts: true,
        revalidationAlerts: true,
        taskAlerts: true,
        missingDocAlerts: true,
      };

      let shouldSendEmail = prefs.emailEnabled;
      let emailContent: { subject: string; html: string } | null = null;

      if (shouldSendEmail) {
        if (params.type === 'credential_expiring' || params.type === 'credential_expired') {
          shouldSendEmail = prefs.expirationAlerts;
          if (shouldSendEmail && params.emailDetails) {
            emailContent = buildCredentialExpirationEmail({
              providerName: params.emailDetails.providerName || 'Provider',
              credentialTitle: params.title,
              identifier: params.emailDetails.identifier || 'N/A',
              expirationDate: params.emailDetails.expirationDate || 'N/A',
              daysRemaining: params.emailDetails.daysRemaining || 0,
              isExpired: params.type === 'credential_expired',
            });
          }
        } else if (params.type === 'enrollment_status_change' || params.type === 'enrollment_follow_up_due') {
          shouldSendEmail = prefs.revalidationAlerts;
          if (shouldSendEmail && params.emailDetails?.revalidationDate) {
            emailContent = buildRevalidationDueEmail({
              providerName: params.emailDetails.providerName || 'Provider',
              payerName: params.emailDetails.payerName || 'Payer',
              revalidationDate: params.emailDetails.revalidationDate,
              daysRemaining: params.emailDetails.daysRemaining || 0,
            });
          }
        } else if (params.type === 'task_assigned' || params.type === 'task_due') {
          shouldSendEmail = prefs.taskAlerts;
          if (shouldSendEmail) {
            emailContent = buildTaskAlertEmail({
              title: params.title,
              description: params.message,
              priority: params.emailDetails?.priority || 'medium',
              dueDate: params.emailDetails?.dueDate || 'Today',
              isOverdue: params.type === 'task_due' && params.message.includes('overdue'),
            });
          }
        }

        // Fallback email content if specific template wasn't triggered
        if (shouldSendEmail && !emailContent) {
          emailContent = {
            subject: params.title,
            html: `<div style="font-family: sans-serif; padding: 20px;"><h3>${params.title}</h3><p>${params.message}</p></div>`,
          };
        }

        if (shouldSendEmail && emailContent) {
          const emailResult = await sendEmail({
            to: user.email,
            subject: emailContent.subject,
            html: emailContent.html,
          });

          if (emailResult.success) {
            await prisma.notification.update({
              where: { id: notification.id },
              data: {
                emailSent: true,
                emailSentAt: new Date(),
              },
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[NotificationService] Email delivery attempt failed:', err);
  }

  return notification;
}

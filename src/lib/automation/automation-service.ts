import { prisma } from '@/lib/db/prisma';
import { dispatchNotification } from '@/lib/notifications/notification-service';
import { sendEmail, buildDailyDigestEmail, DailyDigestItem } from '@/lib/email/email-service';

/**
 * Returns UTC Date object reset to midnight (00:00:00.000Z)
 */
export function getUtcMidnight(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function getDaysBetween(targetDate: Date, baseDate = new Date()): number {
  const targetMidnight = getUtcMidnight(targetDate);
  const baseMidnight = getUtcMidnight(baseDate);
  return Math.round((targetMidnight.getTime() - baseMidnight.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * 1. CREDENTIAL EXPIRATION SCANNER
 * Scans State Licenses, DEA Registrations, Board Certifications, and Malpractice Insurance
 * at 90, 60, 30, and 14 days thresholds + expired.
 */
export async function runCredentialExpirationScanner() {
  const today = getUtcMidnight();
  const ninetyDaysOut = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

  // Default notification recipient (first active admin or credentialing specialist)
  const defaultRecipient = await prisma.user.findFirst({
    where: {
      role: { in: ['super_admin', 'admin', 'credentialing_specialist'] },
      isActive: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  let scannedCount = 0;
  let expiringCount = 0;
  let expiredCount = 0;
  let tasksCreated = 0;
  let notificationsSent = 0;

  // Process a credential entry with idempotent task and notification creation
  async function processCredential(item: {
    id: string;
    type: 'state_license' | 'dea_registration' | 'board_certification' | 'malpractice_insurance';
    title: string;
    identifier: string;
    expirationDate: Date | null;
    status: string;
    providerId: string;
    providerName: string;
  }) {
    if (!item.expirationDate) return;

    scannedCount++;
    const daysRemaining = getDaysBetween(item.expirationDate, today);

    // Check thresholds: <= 90 days or already expired
    if (daysRemaining > 90) return;

    const isExpired = daysRemaining < 0;
    if (isExpired) {
      expiredCount++;
    } else {
      expiringCount++;
    }

    // Determine target status
    const targetStatus = isExpired ? 'expired' : 'expiring_soon';

    // 1. Idempotently update credential record status if needed
    if (item.status !== targetStatus && item.status !== 'inactive' && item.status !== 'revoked') {
      if (item.type === 'state_license') {
        await prisma.stateLicense.update({ where: { id: item.id }, data: { status: targetStatus } });
      } else if (item.type === 'dea_registration') {
        await prisma.deaRegistration.update({ where: { id: item.id }, data: { status: targetStatus } });
      } else if (item.type === 'board_certification') {
        await prisma.boardCertification.update({ where: { id: item.id }, data: { status: targetStatus } });
      } else if (item.type === 'malpractice_insurance') {
        await prisma.malpracticeInsurance.update({ where: { id: item.id }, data: { status: targetStatus } });
      }
    }

    // Determine priority
    let priority = 'low';
    if (isExpired || daysRemaining <= 14) {
      priority = 'urgent';
    } else if (daysRemaining <= 30) {
      priority = 'high';
    } else if (daysRemaining <= 60) {
      priority = 'medium';
    }

    // 2. Idempotent Task Creation: Check if active task already exists for this credential entity
    const existingTask = await prisma.task.findFirst({
      where: {
        entityType: item.type,
        entityId: item.id,
        status: { in: ['pending', 'in_progress', 'open'] },
      },
    });

    if (!existingTask) {
      await prisma.task.create({
        data: {
          title: `Renew ${item.title} for ${item.providerName}`,
          description: `Credential ${item.identifier} (${item.title}) expires on ${item.expirationDate.toISOString().slice(0, 10)}. Days remaining: ${daysRemaining}. Immediate renewal or re-verification required.`,
          entityType: item.type,
          entityId: item.id,
          priority,
          status: 'pending',
          dueDate: item.expirationDate,
          providerId: item.providerId,
          assignedToId: defaultRecipient?.id || null,
        },
      });
      tasksCreated++;
    }

    // 3. Idempotent Notification Dispatch: Avoid sending duplicate notifications on the same calendar day
    if (defaultRecipient) {
      const alreadyNotifiedToday = await prisma.notification.findFirst({
        where: {
          userId: defaultRecipient.id,
          entityType: item.type,
          entityId: item.id,
          createdAt: { gte: today },
        },
      });

      if (!alreadyNotifiedToday) {
        await dispatchNotification({
          userId: defaultRecipient.id,
          type: isExpired ? 'credential_expired' : 'credential_expiring',
          title: `Expiration Alert: ${item.title}`,
          message: `${item.title} (${item.identifier}) for ${item.providerName} is ${
            isExpired ? 'EXPIRED' : `expiring in ${daysRemaining} days`
          }.`,
          entityType: item.type,
          entityId: item.id,
          emailDetails: {
            providerName: item.providerName,
            identifier: item.identifier,
            expirationDate: item.expirationDate.toISOString().slice(0, 10),
            daysRemaining,
          },
        });
        notificationsSent++;
      }
    }
  }

  // Fetch licenses
  const licenses = await prisma.stateLicense.findMany({
    where: { expirationDate: { lte: ninetyDaysOut }, status: { notIn: ['inactive', 'revoked'] } },
    include: { provider: true },
  });
  for (const l of licenses) {
    await processCredential({
      id: l.id,
      type: 'state_license',
      title: `${l.state} State Medical License`,
      identifier: l.licenseNumber,
      expirationDate: l.expirationDate,
      status: l.status,
      providerId: l.providerId,
      providerName: `${l.provider.firstName} ${l.provider.lastName}`,
    });
  }

  // Fetch DEA
  const deas = await prisma.deaRegistration.findMany({
    where: { expirationDate: { lte: ninetyDaysOut }, status: { notIn: ['inactive', 'revoked'] } },
    include: { provider: true },
  });
  for (const d of deas) {
    await processCredential({
      id: d.id,
      type: 'dea_registration',
      title: `DEA Registration (${d.state || 'National'})`,
      identifier: d.deaNumber,
      expirationDate: d.expirationDate,
      status: d.status,
      providerId: d.providerId,
      providerName: `${d.provider.firstName} ${d.provider.lastName}`,
    });
  }

  // Fetch Boards
  const boards = await prisma.boardCertification.findMany({
    where: { expirationDate: { lte: ninetyDaysOut }, status: { notIn: ['inactive', 'revoked'] } },
    include: { provider: true },
  });
  for (const b of boards) {
    await processCredential({
      id: b.id,
      type: 'board_certification',
      title: `Board Certification - ${b.boardName}`,
      identifier: b.certificationNumber || b.specialty,
      expirationDate: b.expirationDate,
      status: b.status,
      providerId: b.providerId,
      providerName: `${b.provider.firstName} ${b.provider.lastName}`,
    });
  }

  // Fetch Malpractice
  const malpractices = await prisma.malpracticeInsurance.findMany({
    where: { expirationDate: { lte: ninetyDaysOut }, status: { notIn: ['inactive', 'cancelled'] } },
    include: { provider: true },
  });
  for (const m of malpractices) {
    await processCredential({
      id: m.id,
      type: 'malpractice_insurance',
      title: `Malpractice Insurance (${m.carrierName})`,
      identifier: m.policyNumber || 'Policy',
      expirationDate: m.expirationDate,
      status: m.status,
      providerId: m.providerId,
      providerName: `${m.provider.firstName} ${m.provider.lastName}`,
    });
  }

  return {
    scannedCount,
    expiringCount,
    expiredCount,
    tasksCreated,
    notificationsSent,
  };
}

/**
 * 2. CAQH ATTESTATION SCANNER (120-Day Cycle)
 * Scans CAQH profiles for required 120-day re-attestation deadlines.
 */
export async function runCaqhAttestationScanner() {
  const today = getUtcMidnight();
  const thirtyDaysOut = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  const defaultRecipient = await prisma.user.findFirst({
    where: { role: { in: ['super_admin', 'admin', 'credentialing_specialist'] }, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  const caqhProfiles = await prisma.caqhProfile.findMany({
    include: { provider: true },
  });

  let scannedCount = 0;
  let dueCount = 0;
  let tasksCreated = 0;
  let notificationsSent = 0;

  for (const caqh of caqhProfiles) {
    scannedCount++;

    // Calculate next attestation date: use nextAttestationDate if available, or lastAttestationDate + 120 days
    let nextDue: Date | null = caqh.nextAttestationDate;
    if (!nextDue && caqh.lastAttestationDate) {
      nextDue = new Date(caqh.lastAttestationDate.getTime() + 120 * 24 * 60 * 60 * 1000);
    }

    if (!nextDue) continue;

    const daysRemaining = getDaysBetween(nextDue, today);

    // Alert if within 30 days or overdue
    if (daysRemaining <= 30) {
      dueCount++;
      const isOverdue = daysRemaining < 0;
      const priority = isOverdue || daysRemaining <= 14 ? 'urgent' : 'high';

      // Idempotent Task
      const existingTask = await prisma.task.findFirst({
        where: {
          entityType: 'caqh_profile',
          entityId: caqh.id,
          status: { in: ['pending', 'in_progress', 'open'] },
        },
      });

      if (!existingTask) {
        await prisma.task.create({
          data: {
            title: `CAQH Attestation Due for ${caqh.provider.firstName} ${caqh.provider.lastName}`,
            description: `CAQH Profile (${caqh.caqhId}) re-attestation is ${
              isOverdue ? 'OVERDUE' : `due in ${daysRemaining} days`
            } on ${nextDue.toISOString().slice(0, 10)}. 120-day cycle compliance required.`,
            entityType: 'caqh_profile',
            entityId: caqh.id,
            priority,
            status: 'pending',
            dueDate: nextDue,
            providerId: caqh.providerId,
            assignedToId: defaultRecipient?.id || null,
          },
        });
        tasksCreated++;
      }

      // Idempotent Notification
      if (defaultRecipient) {
        const notifiedToday = await prisma.notification.findFirst({
          where: {
            userId: defaultRecipient.id,
            entityType: 'caqh_profile',
            entityId: caqh.id,
            createdAt: { gte: today },
          },
        });

        if (!notifiedToday) {
          await dispatchNotification({
            userId: defaultRecipient.id,
            type: 'caqh_attestation_due',
            title: `CAQH Attestation Alert: ${caqh.provider.firstName} ${caqh.provider.lastName}`,
            message: `CAQH re-attestation for CAQH ID ${caqh.caqhId} is ${
              isOverdue ? 'OVERDUE' : `due in ${daysRemaining} days`
            }.`,
            entityType: 'caqh_profile',
            entityId: caqh.id,
            emailDetails: {
              providerName: `${caqh.provider.firstName} ${caqh.provider.lastName}`,
              identifier: caqh.caqhId,
              dueDate: nextDue.toISOString().slice(0, 10),
              daysRemaining,
            },
          });
          notificationsSent++;
        }
      }
    }
  }

  return { scannedCount, dueCount, tasksCreated, notificationsSent };
}

/**
 * 3. PAYER ENROLLMENT REVALIDATION & FOLLOW-UP SCANNER
 * Scans revalidations at 90/60/30 days and overdue follow-up dates.
 */
export async function runEnrollmentRevalidationScanner() {
  const today = getUtcMidnight();
  const ninetyDaysOut = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

  const defaultRecipient = await prisma.user.findFirst({
    where: { role: { in: ['super_admin', 'admin', 'enrollment_specialist'] }, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  let revalidationsScanned = 0;
  let revalidationsDue = 0;
  let followUpsOverdue = 0;
  let tasksCreated = 0;
  let notificationsSent = 0;

  // 1. Revalidations Due (<= 90 days)
  const enrollments = await prisma.payerEnrollment.findMany({
    where: {
      status: { notIn: ['terminated', 'denied'] },
      revalidationDate: { lte: ninetyDaysOut },
    },
    include: { provider: true, payer: true, assignedTo: true },
  });

  revalidationsScanned = enrollments.length;

  for (const enrl of enrollments) {
    if (!enrl.revalidationDate) continue;

    const daysRemaining = getDaysBetween(enrl.revalidationDate, today);
    revalidationsDue++;

    const isOverdue = daysRemaining < 0;
    const recipientId = enrl.assignedToId || defaultRecipient?.id;

    // Idempotent Task
    const existingTask = await prisma.task.findFirst({
      where: {
        entityType: 'payer_enrollment',
        entityId: enrl.id,
        status: { in: ['pending', 'in_progress', 'open'] },
        title: { contains: 'Revalidation' },
      },
    });

    if (!existingTask) {
      await prisma.task.create({
        data: {
          title: `Revalidation Due: ${enrl.payer.name} for ${enrl.provider.firstName} ${enrl.provider.lastName}`,
          description: `Payer enrollment with ${enrl.payer.name} is due for revalidation on ${enrl.revalidationDate.toISOString().slice(0, 10)}. Days remaining: ${daysRemaining}.`,
          entityType: 'payer_enrollment',
          entityId: enrl.id,
          priority: isOverdue || daysRemaining <= 30 ? 'high' : 'medium',
          status: 'pending',
          dueDate: enrl.revalidationDate,
          providerId: enrl.providerId,
          assignedToId: recipientId || null,
        },
      });
      tasksCreated++;
    }

    // Idempotent Notification
    if (recipientId) {
      const notifiedToday = await prisma.notification.findFirst({
        where: {
          userId: recipientId,
          entityType: 'payer_enrollment',
          entityId: enrl.id,
          type: 'enrollment_status_change',
          createdAt: { gte: today },
        },
      });

      if (!notifiedToday) {
        await dispatchNotification({
          userId: recipientId,
          type: 'enrollment_status_change',
          title: `Revalidation Due: ${enrl.payer.name}`,
          message: `Revalidation for ${enrl.provider.firstName} ${enrl.provider.lastName} with ${enrl.payer.name} is due on ${enrl.revalidationDate.toISOString().slice(0, 10)}.`,
          entityType: 'payer_enrollment',
          entityId: enrl.id,
          emailDetails: {
            providerName: `${enrl.provider.firstName} ${enrl.provider.lastName}`,
            payerName: enrl.payer.name,
            revalidationDate: enrl.revalidationDate.toISOString().slice(0, 10),
            daysRemaining,
          },
        });
        notificationsSent++;
      }
    }
  }

  // 2. Overdue Follow-ups
  const overdueFollowUps = await prisma.payerEnrollment.findMany({
    where: {
      followUpDate: { lt: today },
      status: { notIn: ['approved', 'active', 'terminated'] },
    },
    include: { provider: true, payer: true, assignedTo: true },
  });

  followUpsOverdue = overdueFollowUps.length;

  for (const enrl of overdueFollowUps) {
    const recipientId = enrl.assignedToId || defaultRecipient?.id;
    if (recipientId) {
      const notifiedToday = await prisma.notification.findFirst({
        where: {
          userId: recipientId,
          entityType: 'payer_enrollment',
          entityId: enrl.id,
          type: 'enrollment_follow_up_due',
          createdAt: { gte: today },
        },
      });

      if (!notifiedToday) {
        await dispatchNotification({
          userId: recipientId,
          type: 'enrollment_follow_up_due',
          title: `Follow-Up Overdue: ${enrl.payer.name}`,
          message: `Enrollment follow-up for ${enrl.provider.firstName} ${enrl.provider.lastName} with ${enrl.payer.name} was due on ${enrl.followUpDate?.toISOString().slice(0, 10)}. Status: ${enrl.status.toUpperCase()}.`,
          entityType: 'payer_enrollment',
          entityId: enrl.id,
        });
        notificationsSent++;
      }
    }
  }

  return {
    revalidationsScanned,
    revalidationsDue,
    followUpsOverdue,
    tasksCreated,
    notificationsSent,
  };
}

/**
 * 4. OVERDUE TASK SCANNER
 * Flags tasks past due date and alerts assignees.
 */
export async function runOverdueTaskScanner() {
  const today = getUtcMidnight();

  const overdueTasks = await prisma.task.findMany({
    where: {
      status: { notIn: ['completed', 'cancelled'] },
      dueDate: { lt: today },
      assignedToId: { not: null },
    },
    include: {
      assignedTo: true,
      provider: true,
    },
  });

  let notificationsSent = 0;

  for (const task of overdueTasks) {
    if (!task.assignedToId) continue;

    // Idempotent: Send at most 1 reminder per day per overdue task
    const alreadyNotified = await prisma.notification.findFirst({
      where: {
        userId: task.assignedToId,
        entityType: 'task',
        entityId: task.id,
        createdAt: { gte: today },
      },
    });

    if (!alreadyNotified) {
      await dispatchNotification({
        userId: task.assignedToId,
        type: 'task_due',
        title: 'Overdue Task Alert',
        message: `Task is past due (Due: ${task.dueDate?.toISOString().slice(0, 10)}). Priority: ${task.priority.toUpperCase()}.`,
        entityType: 'task',
        entityId: task.id,
        emailDetails: {
          priority: task.priority,
          dueDate: task.dueDate?.toISOString().slice(0, 10),
        },
      });
      notificationsSent++;
    }
  }

  return {
    overdueFound: overdueTasks.length,
    notificationsSent,
  };
}

/**
 * 5. MISSING DOCUMENT SCANNER
 * Identifies enrollments or providers missing essential compliance documents.
 */
export async function runMissingDocumentScanner() {
  const defaultRecipient = await prisma.user.findFirst({
    where: { role: { in: ['super_admin', 'admin', 'credentialing_specialist'] }, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  // Providers with active status
  const activeProviders = await prisma.provider.findMany({
    where: { status: 'active' },
    include: {
      documents: { where: { status: { notIn: ['rejected', 'superseded'] } } },
      stateLicenses: { where: { status: { in: ['active', 'expiring_soon'] } } },
    },
  });

  let providersChecked = 0;
  let missingDocAlerts = 0;

  for (const prov of activeProviders) {
    providersChecked++;
    const hasLicense = prov.stateLicenses.length > 0;
    const hasLicenseDoc = prov.documents.some((d) => d.documentType === 'medical_license');

    if (hasLicense && !hasLicenseDoc && defaultRecipient) {
      // Check if already notified recently
      const alreadyNotified = await prisma.notification.findFirst({
        where: {
          userId: defaultRecipient.id,
          entityType: 'provider',
          entityId: prov.id,
          type: 'missing_document',
          createdAt: { gte: getUtcMidnight() },
        },
      });

      if (!alreadyNotified) {
        await dispatchNotification({
          userId: defaultRecipient.id,
          type: 'missing_document',
          title: `Missing Document: Medical License for ${prov.firstName} ${prov.lastName}`,
          message: `Provider has active license records but no verified medical license document copy uploaded.`,
          entityType: 'provider',
          entityId: prov.id,
        });
        missingDocAlerts++;
      }
    }
  }

  return {
    providersChecked,
    missingDocAlerts,
  };
}

/**
 * 6. DAILY DIGEST GENERATOR
 * Generates and dispatches daily operational digests to specialists and admins.
 */
export async function runDailyDigestGenerator() {
  const today = getUtcMidnight();
  const dateString = today.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Find all active specialists and admins with daily digest enabled
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: ['super_admin', 'admin', 'credentialing_specialist', 'enrollment_specialist'] },
    },
    include: { notificationPreference: true },
  });

  let digestsSent = 0;

  for (const user of users) {
    const prefs = user.notificationPreference;
    if (prefs && !prefs.dailyDigest) {
      // User opted out of daily digest
      continue;
    }

    const items: DailyDigestItem[] = [];

    // 1. Open/Overdue tasks assigned to this user
    const tasks = await prisma.task.findMany({
      where: {
        assignedToId: user.id,
        status: { notIn: ['completed', 'cancelled'] },
      },
      orderBy: { dueDate: 'asc' },
      take: 5,
    });

    for (const t of tasks) {
      const isOverdue = t.dueDate && getUtcMidnight(t.dueDate) < today;
      items.push({
        type: 'Task',
        title: t.title,
        detail: `Priority: ${t.priority.toUpperCase()} | Due: ${t.dueDate ? t.dueDate.toISOString().slice(0, 10) : 'None'}${
          isOverdue ? ' (OVERDUE)' : ''
        }`,
        urgency: isOverdue ? 'critical' : t.priority === 'urgent' ? 'critical' : 'high',
      });
    }

    // 2. Unread notifications for this user
    const unreadNotifications = await prisma.notification.findMany({
      where: { userId: user.id, isRead: false },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    for (const n of unreadNotifications) {
      items.push({
        type: 'Alert',
        title: n.title,
        detail: n.message,
        urgency: n.type.includes('expired') || n.type.includes('overdue') ? 'critical' : 'high',
      });
    }

    // Send digest email
    const emailData = buildDailyDigestEmail({
      recipientName: `${user.firstName} ${user.lastName}`,
      items,
      dateString,
    });

    const result = await sendEmail({
      to: user.email,
      subject: emailData.subject,
      html: emailData.html,
    });

    if (result.success) {
      digestsSent++;
    }
  }

  return { usersChecked: users.length, digestsSent };
}

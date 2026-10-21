import { prisma } from '@/lib/db/prisma';
import { CredentialType } from '@/lib/validation/credential';
import { dispatchNotification } from '@/lib/notifications/notification-adapter';

export type ComputedStatus = 'active' | 'expiring_soon' | 'expired' | 'pending_verification' | 'inactive';
export type AlertWindow = '14_days' | '30_days' | '60_days' | '90_days' | 'expired' | null;

export interface UnifiedCredential {
  id: string;
  providerId: string;
  providerName: string;
  providerNpi: string | null;
  credentialType: CredentialType;
  identifier: string;
  title: string;
  state: string | null;
  issueDate: Date | null;
  expirationDate: Date | null;
  status: string;
  computedStatus: ComputedStatus;
  daysUntilExpiration: number | null;
  alertWindow: AlertWindow;
  verified: boolean;
  verifiedAt: Date | null;
  verifiedById: string | null;
  verifiedByName: string | null;
  details: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CredentialFilterOptions {
  search?: string;
  providerId?: string;
  credentialType?: CredentialType | 'all';
  state?: string;
  status?: string;
  expirationWindow?: '14_days' | '30_days' | '60_days' | '90_days' | 'expired' | 'pending_verification' | 'all';
  page?: number;
  limit?: number;
  sortBy?: 'expirationDate' | 'providerName' | 'status' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Timezone-safe expiration and status calculation.
 * Compares UTC midnight of expiration date with UTC midnight of reference date (today).
 */
export function calculateExpirationStatus(
  expirationDate: Date | string | null | undefined,
  verified: boolean = true,
  baseStatus: string = 'active'
): {
  computedStatus: ComputedStatus;
  daysUntilExpiration: number | null;
  alertWindow: AlertWindow;
} {
  const inactiveStatuses = ['inactive', 'revoked', 'suspended', 'cancelled'];
  if (inactiveStatuses.includes(baseStatus.toLowerCase())) {
    return {
      computedStatus: 'inactive',
      daysUntilExpiration: null,
      alertWindow: null,
    };
  }

  if (!expirationDate) {
    return {
      computedStatus: !verified ? 'pending_verification' : 'active',
      daysUntilExpiration: null,
      alertWindow: null,
    };
  }

  const exp = new Date(expirationDate);
  const now = new Date();

  // Normalize to UTC midnight for timezone independence
  const expUtc = Date.UTC(exp.getUTCFullYear(), exp.getUTCMonth(), exp.getUTCDate());
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const diffMs = expUtc - nowUtc;
  const daysUntilExpiration = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (daysUntilExpiration < 0) {
    return {
      computedStatus: 'expired',
      daysUntilExpiration,
      alertWindow: 'expired',
    };
  }

  if (daysUntilExpiration <= 14) {
    return {
      computedStatus: 'expiring_soon',
      daysUntilExpiration,
      alertWindow: '14_days',
    };
  }

  if (daysUntilExpiration <= 30) {
    return {
      computedStatus: 'expiring_soon',
      daysUntilExpiration,
      alertWindow: '30_days',
    };
  }

  if (daysUntilExpiration <= 60) {
    return {
      computedStatus: 'expiring_soon',
      daysUntilExpiration,
      alertWindow: '60_days',
    };
  }

  if (daysUntilExpiration <= 90) {
    return {
      computedStatus: 'expiring_soon',
      daysUntilExpiration,
      alertWindow: '90_days',
    };
  }

  if (!verified) {
    return {
      computedStatus: 'pending_verification',
      daysUntilExpiration,
      alertWindow: null,
    };
  }

  return {
    computedStatus: 'active',
    daysUntilExpiration,
    alertWindow: null,
  };
}

/**
 * Fetch and unify credentials across all 5 credential models.
 * Calculates live real-database counts and applies filters.
 */
export async function getUnifiedCredentials(options: CredentialFilterOptions = {}) {
  const {
    search,
    providerId,
    credentialType = 'all',
    state,
    status,
    expirationWindow = 'all',
    page = 1,
    limit = 20,
    sortBy = 'expirationDate',
    sortOrder = 'asc',
  } = options;

  const providerWhere: Record<string, unknown> = {};
  if (providerId) {
    providerWhere.id = providerId;
  }

  // 1. Query State Licenses
  const shouldFetchLicenses = credentialType === 'all' || credentialType === 'state_license';
  const stateLicensesPromise = shouldFetchLicenses
    ? prisma.stateLicense.findMany({
        where: {
          providerId: providerId || undefined,
          state: state ? state.toUpperCase() : undefined,
        },
        include: {
          provider: { select: { id: true, firstName: true, lastName: true, npiNumber: true } },
          verifiedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      })
    : Promise.resolve([]);

  // 2. Query DEA Registrations
  const shouldFetchDea = credentialType === 'all' || credentialType === 'dea_registration';
  const deaPromise = shouldFetchDea
    ? prisma.deaRegistration.findMany({
        where: {
          providerId: providerId || undefined,
          state: state ? state.toUpperCase() : undefined,
        },
        include: {
          provider: { select: { id: true, firstName: true, lastName: true, npiNumber: true } },
          verifiedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      })
    : Promise.resolve([]);

  // 3. Query Board Certifications
  const shouldFetchBoards = credentialType === 'all' || credentialType === 'board_certification';
  const boardPromise = shouldFetchBoards
    ? prisma.boardCertification.findMany({
        where: {
          providerId: providerId || undefined,
        },
        include: {
          provider: { select: { id: true, firstName: true, lastName: true, npiNumber: true } },
          verifiedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      })
    : Promise.resolve([]);

  // 4. Query Malpractice Policies
  const shouldFetchMalpractice = credentialType === 'all' || credentialType === 'malpractice_insurance';
  const malpracticePromise = shouldFetchMalpractice
    ? prisma.malpracticeInsurance.findMany({
        where: {
          providerId: providerId || undefined,
        },
        include: {
          provider: { select: { id: true, firstName: true, lastName: true, npiNumber: true } },
          verifiedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      })
    : Promise.resolve([]);

  // 5. Query CAQH Profiles
  const shouldFetchCaqh = credentialType === 'all' || credentialType === 'caqh_profile';
  const caqhPromise = shouldFetchCaqh
    ? prisma.caqhProfile.findMany({
        where: {
          providerId: providerId || undefined,
        },
        include: {
          provider: { select: { id: true, firstName: true, lastName: true, npiNumber: true } },
        },
      })
    : Promise.resolve([]);

  const [licenses, deas, boards, malpractices, caqhs] = await Promise.all([
    stateLicensesPromise,
    deaPromise,
    boardPromise,
    malpracticePromise,
    caqhPromise,
  ]);

  const unifiedList: UnifiedCredential[] = [];

  // Transform State Licenses
  for (const lic of licenses) {
    const { computedStatus, daysUntilExpiration, alertWindow } = calculateExpirationStatus(
      lic.expirationDate,
      lic.verified,
      lic.status
    );
    unifiedList.push({
      id: lic.id,
      providerId: lic.providerId,
      providerName: `Dr. ${lic.provider.firstName} ${lic.provider.lastName}`,
      providerNpi: lic.provider.npiNumber,
      credentialType: 'state_license',
      identifier: lic.licenseNumber,
      title: `${lic.state} State Medical License (${lic.licenseType || 'MD/DO'})`,
      state: lic.state,
      issueDate: lic.issueDate,
      expirationDate: lic.expirationDate,
      status: lic.status,
      computedStatus,
      daysUntilExpiration,
      alertWindow,
      verified: lic.verified,
      verifiedAt: lic.verifiedAt,
      verifiedById: lic.verifiedById,
      verifiedByName: lic.verifiedBy ? `${lic.verifiedBy.firstName} ${lic.verifiedBy.lastName}` : null,
      details: { licenseType: lic.licenseType },
      createdAt: lic.createdAt,
      updatedAt: lic.updatedAt,
    });
  }

  // Transform DEA
  for (const dea of deas) {
    const { computedStatus, daysUntilExpiration, alertWindow } = calculateExpirationStatus(
      dea.expirationDate,
      dea.verified,
      dea.status
    );
    unifiedList.push({
      id: dea.id,
      providerId: dea.providerId,
      providerName: `Dr. ${dea.provider.firstName} ${dea.provider.lastName}`,
      providerNpi: dea.provider.npiNumber,
      credentialType: 'dea_registration',
      identifier: dea.deaNumber,
      title: `DEA Registration (${dea.schedule || 'Schedules 2-5'})`,
      state: dea.state,
      issueDate: dea.issueDate,
      expirationDate: dea.expirationDate,
      status: dea.status,
      computedStatus,
      daysUntilExpiration,
      alertWindow,
      verified: dea.verified,
      verifiedAt: dea.verifiedAt,
      verifiedById: dea.verifiedById,
      verifiedByName: dea.verifiedBy ? `${dea.verifiedBy.firstName} ${dea.verifiedBy.lastName}` : null,
      details: { schedule: dea.schedule },
      createdAt: dea.createdAt,
      updatedAt: dea.updatedAt,
    });
  }

  // Transform Board Certs
  for (const b of boards) {
    const { computedStatus, daysUntilExpiration, alertWindow } = calculateExpirationStatus(
      b.expirationDate,
      b.verified,
      b.status
    );
    unifiedList.push({
      id: b.id,
      providerId: b.providerId,
      providerName: `Dr. ${b.provider.firstName} ${b.provider.lastName}`,
      providerNpi: b.provider.npiNumber,
      credentialType: 'board_certification',
      identifier: b.certificationNumber || 'Cert on file',
      title: `${b.boardName} - ${b.specialty}`,
      state: null,
      issueDate: b.initialCertDate,
      expirationDate: b.expirationDate,
      status: b.status,
      computedStatus,
      daysUntilExpiration,
      alertWindow,
      verified: b.verified,
      verifiedAt: b.verifiedAt,
      verifiedById: b.verifiedById,
      verifiedByName: b.verifiedBy ? `${b.verifiedBy.firstName} ${b.verifiedBy.lastName}` : null,
      details: { boardName: b.boardName, specialty: b.specialty },
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    });
  }

  // Transform Malpractice
  for (const m of malpractices) {
    const { computedStatus, daysUntilExpiration, alertWindow } = calculateExpirationStatus(
      m.expirationDate,
      m.verified,
      m.status
    );
    unifiedList.push({
      id: m.id,
      providerId: m.providerId,
      providerName: `Dr. ${m.provider.firstName} ${m.provider.lastName}`,
      providerNpi: m.provider.npiNumber,
      credentialType: 'malpractice_insurance',
      identifier: m.policyNumber || 'Policy on file',
      title: `${m.carrierName} (${m.coverageType || 'Occurrence'})`,
      state: null,
      issueDate: m.effectiveDate,
      expirationDate: m.expirationDate,
      status: m.status,
      computedStatus,
      daysUntilExpiration,
      alertWindow,
      verified: m.verified,
      verifiedAt: m.verifiedAt,
      verifiedById: m.verifiedById,
      verifiedByName: m.verifiedBy ? `${m.verifiedBy.firstName} ${m.verifiedBy.lastName}` : null,
      details: {
        carrierName: m.carrierName,
        coverageType: m.coverageType,
        perClaimAmount: m.perClaimAmount ? Number(m.perClaimAmount) : null,
        aggregateAmount: m.aggregateAmount ? Number(m.aggregateAmount) : null,
      },
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    });
  }

  // Transform CAQH
  for (const c of caqhs) {
    const { computedStatus, daysUntilExpiration, alertWindow } = calculateExpirationStatus(
      c.nextAttestationDate,
      c.attestationStatus === 'current',
      'active'
    );
    unifiedList.push({
      id: c.id,
      providerId: c.providerId,
      providerName: `Dr. ${c.provider.firstName} ${c.provider.lastName}`,
      providerNpi: c.provider.npiNumber,
      credentialType: 'caqh_profile',
      identifier: c.caqhId,
      title: `CAQH ProView Profile (${c.caqhId})`,
      state: null,
      issueDate: c.lastAttestationDate,
      expirationDate: c.nextAttestationDate,
      status: c.attestationStatus,
      computedStatus,
      daysUntilExpiration,
      alertWindow,
      verified: c.attestationStatus === 'current',
      verifiedAt: c.lastAttestationDate,
      verifiedById: null,
      verifiedByName: null,
      details: {
        username: c.username,
        reauthorizationDate: c.reauthorizationDate,
      },
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    });
  }

  // Calculate global summary counts across ALL loaded credentials
  const summaryCounts = {
    totalCount: unifiedList.length,
    expiredCount: unifiedList.filter((c) => c.alertWindow === 'expired').length,
    within14DaysCount: unifiedList.filter((c) => c.alertWindow === '14_days').length,
    within30DaysCount: unifiedList.filter((c) => c.alertWindow === '30_days' || c.alertWindow === '14_days').length,
    within60DaysCount: unifiedList.filter(
      (c) => c.alertWindow === '60_days' || c.alertWindow === '30_days' || c.alertWindow === '14_days'
    ).length,
    within90DaysCount: unifiedList.filter(
      (c) =>
        c.alertWindow === '90_days' ||
        c.alertWindow === '60_days' ||
        c.alertWindow === '30_days' ||
        c.alertWindow === '14_days'
    ).length,
    pendingVerificationCount: unifiedList.filter((c) => !c.verified && c.computedStatus !== 'expired').length,
  };

  // Filter unified list
  let filtered = unifiedList;

  if (search && search.trim() !== '') {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(
      (c) =>
        c.providerName.toLowerCase().includes(q) ||
        (c.providerNpi && c.providerNpi.includes(q)) ||
        c.identifier.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        (c.state && c.state.toLowerCase().includes(q))
    );
  }

  if (status && status !== 'all') {
    filtered = filtered.filter((c) => c.computedStatus === status || c.status.toLowerCase() === status.toLowerCase());
  }

  if (expirationWindow && expirationWindow !== 'all') {
    if (expirationWindow === 'expired') {
      filtered = filtered.filter((c) => c.alertWindow === 'expired');
    } else if (expirationWindow === '14_days') {
      filtered = filtered.filter((c) => c.alertWindow === '14_days');
    } else if (expirationWindow === '30_days') {
      filtered = filtered.filter((c) => c.alertWindow === '14_days' || c.alertWindow === '30_days');
    } else if (expirationWindow === '60_days') {
      filtered = filtered.filter(
        (c) => c.alertWindow === '14_days' || c.alertWindow === '30_days' || c.alertWindow === '60_days'
      );
    } else if (expirationWindow === '90_days') {
      filtered = filtered.filter(
        (c) =>
          c.alertWindow === '14_days' ||
          c.alertWindow === '30_days' ||
          c.alertWindow === '60_days' ||
          c.alertWindow === '90_days'
      );
    } else if (expirationWindow === 'pending_verification') {
      filtered = filtered.filter((c) => !c.verified);
    }
  }

  // Sort
  filtered.sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'expirationDate') {
      const aTime = a.expirationDate ? new Date(a.expirationDate).getTime() : 9999999999999;
      const bTime = b.expirationDate ? new Date(b.expirationDate).getTime() : 9999999999999;
      comparison = aTime - bTime;
    } else if (sortBy === 'providerName') {
      comparison = a.providerName.localeCompare(b.providerName);
    } else if (sortBy === 'status') {
      comparison = a.computedStatus.localeCompare(b.computedStatus);
    } else if (sortBy === 'createdAt') {
      comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  // Paginate
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const paginatedItems = filtered.slice((currentPage - 1) * limit, currentPage * limit);

  return {
    items: paginatedItems,
    pagination: {
      page: currentPage,
      limit,
      totalItems,
      totalPages,
    },
    summaryCounts,
  };
}

/**
 * Idempotent expiration scanner:
 * Finds credentials approaching expiration (<= 90 days or expired) and creates work tasks.
 * Avoids duplicate tasks by checking if an open/in_progress task already exists for the entity.
 */
export async function scanUpcomingExpirationsAndCreateTasks() {
  const result = await getUnifiedCredentials({ expirationWindow: 'all' });
  const expiringCredentials = result.items.filter(
    (c) => c.alertWindow !== null // expired, 14_days, 30_days, 60_days, 90_days
  );

  let tasksCreated = 0;
  let notificationsDispatched = 0;

  // Find a default assignee (first admin or credentialing specialist)
  const defaultAssignee = await prisma.user.findFirst({
    where: {
      role: { in: ['super_admin', 'admin', 'credentialing_specialist'] },
      isActive: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  for (const cred of expiringCredentials) {
    // 1. Check if an active task already exists for this credential entity
    const existingTask = await prisma.task.findFirst({
      where: {
        entityType: cred.credentialType,
        entityId: cred.id,
        status: { in: ['pending', 'in_progress', 'open'] },
      },
    });

    if (existingTask) {
      // Avoid duplicate task creation
      continue;
    }

    // Determine priority based on window
    let priority = 'medium';
    if (cred.alertWindow === 'expired' || cred.alertWindow === '14_days') {
      priority = 'urgent';
    } else if (cred.alertWindow === '30_days') {
      priority = 'high';
    } else if (cred.alertWindow === '60_days') {
      priority = 'medium';
    } else {
      priority = 'low';
    }

    const dueDate = cred.expirationDate ? new Date(cred.expirationDate) : new Date();

    // 2. Create the task idempotently
    const newTask = await prisma.task.create({
      data: {
        title: `Renew ${cred.title} for ${cred.providerName}`,
        description: `Credential ${cred.identifier} expires on ${
          cred.expirationDate ? new Date(cred.expirationDate).toLocaleDateString() : 'Unknown'
        }. Days remaining: ${cred.daysUntilExpiration ?? 0}. Immediate renewal or re-verification required.`,
        entityType: cred.credentialType,
        entityId: cred.id,
        priority,
        status: 'pending',
        dueDate,
        assignedToId: defaultAssignee ? defaultAssignee.id : null,
      },
    });

    tasksCreated++;

    // 3. Dispatch in-app notification if assignee exists
    if (defaultAssignee) {
      await dispatchNotification({
        userId: defaultAssignee.id,
        type: cred.alertWindow === 'expired' ? 'credential_expired' : 'credential_expiring',
        title: `Expiration Alert: ${cred.title}`,
        message: `${cred.title} (${cred.identifier}) for ${cred.providerName} is ${
          cred.alertWindow === 'expired'
            ? 'EXPIRED'
            : `expiring in ${cred.daysUntilExpiration} days`
        }.`,
        entityType: cred.credentialType,
        entityId: cred.id,
      });
      notificationsDispatched++;
    }
  }

  return {
    scannedCount: result.summaryCounts.totalCount,
    expiringFound: expiringCredentials.length,
    tasksCreated,
    notificationsDispatched,
  };
}

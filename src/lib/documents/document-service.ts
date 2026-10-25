import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/errors/api-error';
import {
  S3_BUCKETS,
  validateDocumentPayload,
  generateStorageKey,
  computeSha256,
  uploadToS3,
  deleteFromS3,
} from '@/lib/storage/s3';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { dispatchNotification } from '@/lib/notifications/notification-adapter';

export interface DocumentFilterOptions {
  search?: string;
  providerId?: string;
  entityType?: string;
  entityId?: string;
  documentType?: string;
  status?: string;
  isExpiringSoon?: boolean;
  isExpired?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'expirationDate' | 'title' | 'status';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Determine the appropriate S3 bucket based on entity type.
 */
export function resolveBucketForEntity(entityType: string): string {
  if (entityType === 'payer_enrollment' || entityType === 'payer') {
    return S3_BUCKETS.ENROLLMENTS;
  }
  if (entityType === 'credential' || entityType === 'provider') {
    return S3_BUCKETS.CREDENTIALS;
  }
  return S3_BUCKETS.GENERAL;
}

/**
 * Query documents with full filtering, sorting, pagination, and real database summary counts.
 */
export async function getDocuments(options: DocumentFilterOptions = {}) {
  const {
    search,
    providerId,
    entityType,
    entityId,
    documentType,
    status,
    isExpiringSoon,
    isExpired,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = options;

  const now = new Date();
  const todayDateOnly = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const thirtyDaysOut = new Date(todayDateOnly.getTime() + 30 * 24 * 60 * 60 * 1000);

  const where: Record<string, unknown> = {};

  if (providerId) where.providerId = providerId;
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (documentType && documentType !== 'all') where.documentType = documentType;
  if (status && status !== 'all') where.status = status;

  if (isExpired) {
    where.expirationDate = { lt: todayDateOnly };
  } else if (isExpiringSoon) {
    where.expirationDate = {
      gte: todayDateOnly,
      lte: thirtyDaysOut,
    };
  }

  if (search && search.trim() !== '') {
    const q = search.trim();
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { documentType: { contains: q, mode: 'insensitive' } },
      {
        provider: {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { npiNumber: { contains: q } },
          ],
        },
      },
    ];
  }

  const [totalItems, documents] = await Promise.all([
    prisma.document.count({ where }),
    prisma.document.findMany({
      where,
      include: {
        currentVersion: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true,
            versionNumber: true,
            fileName: true,
            fileSize: true,
            mimeType: true,
            checksumSha256: true,
            createdAt: true,
            uploadedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        uploadedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        verifiedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        provider: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            npiNumber: true,
            primaryTaxonomy: true,
          },
        },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  // Global database summary counts across all documents
  const allDocs = await prisma.document.findMany({
    select: {
      status: true,
      expirationDate: true,
    },
  });

  const summaryCounts = {
    totalCount: allDocs.length,
    pendingReviewCount: allDocs.filter((d) => d.status === 'pending_review' || d.status === 'uploaded').length,
    verifiedCount: allDocs.filter((d) => d.status === 'verified').length,
    rejectedCount: allDocs.filter((d) => d.status === 'rejected').length,
    expiringSoonCount: allDocs.filter((d) => {
      if (!d.expirationDate) return false;
      const exp = new Date(d.expirationDate);
      return exp >= todayDateOnly && exp <= thirtyDaysOut;
    }).length,
    expiredCount: allDocs.filter((d) => {
      if (!d.expirationDate) return false;
      return new Date(d.expirationDate) < todayDateOnly;
    }).length,
  };

  const totalPages = Math.max(1, Math.ceil(totalItems / limit));

  // Serialize BigInt fileSize to number for JSON response
  const serializedDocs = documents.map((doc) => ({
    ...doc,
    currentVersion: doc.currentVersion
      ? {
          ...doc.currentVersion,
          fileSize: Number(doc.currentVersion.fileSize),
        }
      : null,
    versions: doc.versions.map((v) => ({
      ...v,
      fileSize: Number(v.fileSize),
    })),
  }));

  return {
    documents: serializedDocs,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
    },
    summaryCounts,
  };
}

/**
 * Fetch a single document with complete version history and relations.
 */
export async function getDocumentById(id: string) {
  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      currentVersion: true,
      versions: {
        orderBy: { versionNumber: 'desc' },
        include: {
          uploadedBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      },
      uploadedBy: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      verifiedBy: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      provider: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          npiNumber: true,
          primaryTaxonomy: true,
        },
      },
    },
  });

  if (!doc) return null;

  return {
    ...doc,
    currentVersion: doc.currentVersion
      ? {
          ...doc.currentVersion,
          fileSize: Number(doc.currentVersion.fileSize),
        }
      : null,
    versions: doc.versions.map((v) => ({
      ...v,
      fileSize: Number(v.fileSize),
    })),
  };
}

/**
 * Upload a new document and initial version in an atomic transaction with storage reconciliation.
 */
export async function createDocumentWithVersion(params: {
  entityType: string;
  entityId: string;
  providerId?: string | null;
  documentType: string;
  title: string;
  description?: string | null;
  issueDate?: string | null;
  expirationDate?: string | null;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  uploadedById: string;
  userEmail?: string;
}) {
  const {
    entityType,
    entityId,
    providerId,
    documentType,
    title,
    description,
    issueDate,
    expirationDate,
    fileBuffer,
    fileName,
    mimeType,
    uploadedById,
    userEmail,
  } = params;

  // 1. Validate file payload
  const validation = validateDocumentPayload(fileBuffer, fileName, mimeType);
  if (!validation.isValid) {
    throw ApiError.badRequest(validation.error || 'Invalid file upload.');
  }

  // 2. Resolve bucket and safe S3 storage key
  const bucket = resolveBucketForEntity(entityType);
  const s3Key = generateStorageKey(entityType, entityId, fileName);
  const checksumSha256 = computeSha256(fileBuffer);

  // 3. Upload to S3/MinIO first
  await uploadToS3({
    bucket,
    key: s3Key,
    body: fileBuffer,
    mimeType,
  });

  // 4. Atomic database transaction with compensation
  try {
    const document = await prisma.$transaction(async (tx) => {
      // Create Document header
      const doc = await tx.document.create({
        data: {
          entityType,
          entityId,
          providerId: providerId || (entityType === 'provider' ? entityId : null),
          documentType,
          title,
          description: description || null,
          status: 'pending_review',
          issueDate: issueDate ? new Date(issueDate) : null,
          expirationDate: expirationDate ? new Date(expirationDate) : null,
          uploadedById,
        },
      });

      // Create Version 1
      const version = await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: 1,
          s3Bucket: bucket,
          s3Key,
          fileName,
          fileSize: BigInt(fileBuffer.length),
          mimeType,
          checksumSha256,
          uploadedById,
        },
      });

      // Link currentVersionId
      const updatedDoc = await tx.document.update({
        where: { id: doc.id },
        data: { currentVersionId: version.id },
        include: { currentVersion: true },
      });

      return {
        ...updatedDoc,
        currentVersion: {
          ...version,
          fileSize: Number(version.fileSize),
        },
      };
    });

    // 5. Audit Log
    await logAuditEvent({
      userId: uploadedById,
      userEmail,
      action: 'DOCUMENT_UPLOADED',
      entityType: 'document',
      entityId: document.id,
      changes: {
        title,
        documentType,
        fileName,
        fileSize: fileBuffer.length,
        entityType,
        entityId,
        providerId: document.providerId,
        versionNumber: 1,
      },
    });

    return document;
  } catch (dbError) {
    // Reconciliation: cleanup orphaned S3 object if database write failed
    console.error('[DocumentService] DB transaction failed, cleaning up S3 object:', s3Key);
    await deleteFromS3({ bucket, key: s3Key });
    throw dbError;
  }
}

/**
 * Add a revised version to an existing document preserving previous versions.
 */
export async function addDocumentVersion(params: {
  documentId: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  uploadedById: string;
  userEmail?: string;
  notes?: string | null;
}) {
  const { documentId, fileBuffer, fileName, mimeType, uploadedById, userEmail, notes } = params;

  const existing = await prisma.document.findUnique({
    where: { id: documentId },
    include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
  });

  if (!existing) {
    throw new Error('Document not found.');
  }

  // 1. Validate file payload
  const validation = validateDocumentPayload(fileBuffer, fileName, mimeType);
  if (!validation.isValid) {
    throw ApiError.badRequest(validation.error || 'Invalid file upload.');
  }

  const latestVersionNumber = existing.versions[0]?.versionNumber || 0;
  const newVersionNumber = latestVersionNumber + 1;

  // 2. Resolve bucket & storage key
  const bucket = resolveBucketForEntity(existing.entityType);
  const s3Key = generateStorageKey(existing.entityType, existing.entityId, fileName);
  const checksumSha256 = computeSha256(fileBuffer);

  // 3. Upload to S3/MinIO
  await uploadToS3({
    bucket,
    key: s3Key,
    body: fileBuffer,
    mimeType,
  });

  // 4. Atomic database update with compensation
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Create new version
      const newVersion = await tx.documentVersion.create({
        data: {
          documentId,
          versionNumber: newVersionNumber,
          s3Bucket: bucket,
          s3Key,
          fileName,
          fileSize: BigInt(fileBuffer.length),
          mimeType,
          checksumSha256,
          uploadedById,
        },
      });

      // Update document to point to new version and reset status to pending_review
      const updatedDoc = await tx.document.update({
        where: { id: documentId },
        data: {
          currentVersionId: newVersion.id,
          status: 'pending_review',
          verifiedById: null,
          verifiedAt: null,
          rejectionReason: null,
          verificationNotes: notes ? `Revised version: ${notes}` : null,
          updatedAt: new Date(),
        },
        include: {
          currentVersion: true,
          provider: true,
        },
      });

      return {
        document: updatedDoc,
        version: {
          ...newVersion,
          fileSize: Number(newVersion.fileSize),
        },
      };
    });

    // 5. Audit Log
    await logAuditEvent({
      userId: uploadedById,
      userEmail,
      action: 'DOCUMENT_VERSION_CREATED',
      entityType: 'document',
      entityId: documentId,
      changes: {
        documentId,
        newVersionNumber,
        fileName,
        fileSize: fileBuffer.length,
        notes,
      },
    });

    return result;
  } catch (dbError) {
    console.error('[DocumentService] DB transaction failed, cleaning up S3 version:', s3Key);
    await deleteFromS3({ bucket, key: s3Key });
    throw dbError;
  }
}

/**
 * Verify or Reject document with explicit review audit trail.
 */
export async function verifyDocument(params: {
  documentId: string;
  status: 'verified' | 'rejected' | 'pending_review';
  reviewerId: string;
  userEmail?: string;
  verificationNotes?: string | null;
  rejectionReason?: string | null;
}) {
  const { documentId, status, reviewerId, userEmail, verificationNotes, rejectionReason } = params;

  const existing = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      provider: true,
      uploadedBy: true,
    },
  });

  if (!existing) {
    throw new Error('Document not found.');
  }

  const previousStatus = existing.status;

  // Update document status & review metadata
  const updated = await prisma.document.update({
    where: { id: documentId },
    data: {
      status,
      verifiedById: status === 'pending_review' ? null : reviewerId,
      verifiedAt: status === 'pending_review' ? null : new Date(),
      verificationNotes: verificationNotes || null,
      rejectionReason: status === 'rejected' ? rejectionReason : null,
      updatedAt: new Date(),
    },
    include: {
      currentVersion: true,
      verifiedBy: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  });

  // Audit log
  await logAuditEvent({
    userId: reviewerId,
    userEmail,
    action: status === 'verified' ? 'DOCUMENT_VERIFIED' : (status === 'rejected' ? 'DOCUMENT_REJECTED' : 'DOCUMENT_REVIEW_UPDATED'),
    entityType: 'document',
    entityId: documentId,
    changes: {
      previousStatus,
      newStatus: status,
      verificationNotes,
      rejectionReason,
      documentTitle: existing.title,
      providerId: existing.providerId,
    },
  });

  // In-app notification to document uploader if rejected or verified
  if (existing.uploadedById && existing.uploadedById !== reviewerId) {
    await dispatchNotification({
      userId: existing.uploadedById,
      type: status === 'rejected' ? 'verification_needed' : 'system_alert',
      title: `Document ${status.toUpperCase()}: ${existing.title}`,
      message:
        status === 'rejected'
          ? `Document "${existing.title}" was rejected. Reason: ${rejectionReason || 'Please review.'}`
          : `Document "${existing.title}" was verified and approved.`,
      entityType: 'document',
      entityId: documentId,
    });
  }

  return {
    ...updated,
    currentVersion: updated.currentVersion
      ? {
          ...updated.currentVersion,
          fileSize: Number(updated.currentVersion.fileSize),
        }
      : null,
  };
}

/**
 * Idempotent background scanner for document review backlog and expiring documents.
 */
export async function scanDocumentExpirationsAndPendingReview() {
  const now = new Date();
  const todayDateOnly = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const thirtyDaysOut = new Date(todayDateOnly.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(todayDateOnly.getTime() - 7 * 24 * 60 * 60 * 1000);

  // 1. Documents expiring soon (&le; 30 days)
  const expiringDocs = await prisma.document.findMany({
    where: {
      expirationDate: {
        gte: todayDateOnly,
        lte: thirtyDaysOut,
      },
      status: { notIn: ['expired', 'superseded'] },
    },
    include: { provider: true },
  });

  // 2. Documents expired (< today)
  const expiredDocs = await prisma.document.findMany({
    where: {
      expirationDate: { lt: todayDateOnly },
      status: { notIn: ['expired', 'superseded'] },
    },
    include: { provider: true },
  });

  // 3. Documents pending review for > 7 days
  const pendingBacklog = await prisma.document.findMany({
    where: {
      status: 'pending_review',
      createdAt: { lt: sevenDaysAgo },
    },
    include: { provider: true },
  });

  // Fallback assignee
  const defaultAssignee = await prisma.user.findFirst({
    where: {
      role: { in: ['super_admin', 'admin', 'credentialing_specialist'] },
      isActive: true,
    },
  });

  let expiringTasksCreated = 0;
  let expiredTasksCreated = 0;
  let reviewTasksCreated = 0;

  // Process expiring soon
  for (const doc of expiringDocs) {
    const existingTask = await prisma.task.findFirst({
      where: {
        entityType: 'document',
        entityId: doc.id,
        title: { startsWith: 'Document Expiring Soon:' },
        status: { in: ['pending', 'in_progress', 'open'] },
      },
    });

    if (!existingTask) {
      await prisma.task.create({
        data: {
          title: `Document Expiring Soon: ${doc.title}`,
          description: `Document expires on ${
            doc.expirationDate ? new Date(doc.expirationDate).toLocaleDateString() : 'Unknown'
          }. Provider: ${doc.provider ? `${doc.provider.firstName} ${doc.provider.lastName}` : 'N/A'}.`,
          entityType: 'document',
          entityId: doc.id,
          priority: 'high',
          status: 'pending',
          dueDate: doc.expirationDate ? new Date(doc.expirationDate) : new Date(),
          assignedToId: defaultAssignee?.id || null,
        },
      });
      expiringTasksCreated++;
    }
  }

  // Process expired
  for (const doc of expiredDocs) {
    const existingTask = await prisma.task.findFirst({
      where: {
        entityType: 'document',
        entityId: doc.id,
        title: { startsWith: 'Expired Document Action:' },
        status: { in: ['pending', 'in_progress', 'open'] },
      },
    });

    if (!existingTask) {
      await prisma.task.create({
        data: {
          title: `Expired Document Action: ${doc.title}`,
          description: `Document expired on ${
            doc.expirationDate ? new Date(doc.expirationDate).toLocaleDateString() : 'Unknown'
          }. Update with revised document version.`,
          entityType: 'document',
          entityId: doc.id,
          priority: 'urgent',
          status: 'pending',
          dueDate: new Date(),
          assignedToId: defaultAssignee?.id || null,
        },
      });
      expiredTasksCreated++;
    }
  }

  // Process pending review backlog
  for (const doc of pendingBacklog) {
    const existingTask = await prisma.task.findFirst({
      where: {
        entityType: 'document',
        entityId: doc.id,
        title: { startsWith: 'Review Document Backlog:' },
        status: { in: ['pending', 'in_progress', 'open'] },
      },
    });

    if (!existingTask) {
      await prisma.task.create({
        data: {
          title: `Review Document Backlog: ${doc.title}`,
          description: `Document has been awaiting review since ${new Date(doc.createdAt).toLocaleDateString()}.`,
          entityType: 'document',
          entityId: doc.id,
          priority: 'medium',
          status: 'pending',
          dueDate: new Date(),
          assignedToId: defaultAssignee?.id || null,
        },
      });
      reviewTasksCreated++;
    }
  }

  return {
    expiringDocsScanned: expiringDocs.length,
    expiredDocsScanned: expiredDocs.length,
    pendingBacklogScanned: pendingBacklog.length,
    expiringTasksCreated,
    expiredTasksCreated,
    reviewTasksCreated,
  };
}

/**
 * Delete a document and all its versions from S3, clean up associated tasks, and log an immutable audit event.
 * Only authorized administrators are permitted to perform this operation.
 */
export async function deleteDocument(params: {
  documentId: string;
  actorId: string;
  actorEmail?: string;
  actorRole?: string;
}) {
  const { documentId, actorId, actorEmail, actorRole } = params;

  const existing = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      versions: true,
      provider: {
        select: { id: true, firstName: true, lastName: true, npiNumber: true },
      },
    },
  });

  if (!existing) {
    throw ApiError.notFound('Document not found.');
  }

  // 1. Delete all version objects from S3 / MinIO
  for (const v of existing.versions) {
    await deleteFromS3({ bucket: v.s3Bucket, key: v.s3Key });
  }

  // 2. Clean up any open scanner or operational tasks associated with this document
  await prisma.task.deleteMany({
    where: { entityType: 'document', entityId: documentId },
  });

  // 3. Delete document record (cascades to document_versions)
  await prisma.document.delete({
    where: { id: documentId },
  });

  // 4. Record immutable audit log
  await logAuditEvent({
    userId: actorId,
    userEmail: actorEmail,
    action: 'DOCUMENT_DELETED',
    entityType: 'document',
    entityId: documentId,
    changes: {
      title: existing.title,
      documentType: existing.documentType,
      providerId: existing.providerId,
      providerName: existing.provider
        ? `${existing.provider.firstName} ${existing.provider.lastName}`
        : null,
      versionCount: existing.versions.length,
      versions: existing.versions.map((v) => ({
        versionNumber: v.versionNumber,
        fileName: v.fileName,
        fileSize: Number(v.fileSize),
        s3Key: v.s3Key,
        checksumSha256: v.checksumSha256,
      })),
      deletedAt: new Date().toISOString(),
      deletedByRole: actorRole || 'admin',
    },
  });

  return { success: true };
}

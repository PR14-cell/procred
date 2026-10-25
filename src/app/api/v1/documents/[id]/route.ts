import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { getDocumentById, deleteDocument } from '@/lib/documents/document-service';
import { updateDocumentMetadataSchema } from '@/lib/validation/document';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// GET /api/v1/documents/[id] - Get document details with version history
export const GET = withErrorHandler(async (req: Request, context?: RouteContext) => {
  await requireAuth(req, 'documents:read');
  const documentId = context!.params.id;

  const doc = await getDocumentById(documentId);
  if (!doc) {
    throw ApiError.notFound('Document not found.');
  }

  return NextResponse.json({ document: doc });
});

// PATCH /api/v1/documents/[id] - Update document metadata
export const PATCH = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'documents:write');
  const documentId = context!.params.id;
  const body = await req.json();

  const data = updateDocumentMetadataSchema.parse(body);

  const existing = await prisma.document.findUnique({ where: { id: documentId } });
  if (!existing) {
    throw ApiError.notFound('Document not found.');
  }

  const updated = await prisma.document.update({
    where: { id: documentId },
    data: {
      title: data.title ?? existing.title,
      description: data.description !== undefined ? data.description : existing.description,
      documentType: data.documentType ?? existing.documentType,
      issueDate: data.issueDate ? new Date(data.issueDate) : (data.issueDate === null ? null : existing.issueDate),
      expirationDate: data.expirationDate ? new Date(data.expirationDate) : (data.expirationDate === null ? null : existing.expirationDate),
      updatedAt: new Date(),
    },
    include: {
      currentVersion: true,
      provider: true,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'DOCUMENT_METADATA_UPDATED',
    entityType: 'document',
    entityId: documentId,
    changes: body,
  });

  return NextResponse.json({
    message: 'Document metadata updated successfully',
    document: {
      ...updated,
      currentVersion: updated.currentVersion
        ? {
            ...updated.currentVersion,
            fileSize: Number(updated.currentVersion.fileSize),
          }
        : null,
    },
  });
});

// DELETE /api/v1/documents/[id] - Delete document and all its versions (Admin only)
export const DELETE = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'documents:delete');
  const documentId = context!.params.id;

  await deleteDocument({
    documentId,
    actorId: session.userId,
    actorEmail: session.email,
    actorRole: session.role,
  });

  return NextResponse.json({
    message: 'Document and version files deleted successfully',
  });
});

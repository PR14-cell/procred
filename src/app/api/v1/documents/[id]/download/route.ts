import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { downloadFromS3 } from '@/lib/storage/s3';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { Readable } from 'stream';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// GET /api/v1/documents/[id]/download - Secure streaming download of current or specified version
export const GET = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'documents:read');
  const documentId = context!.params.id;

  const { searchParams } = new URL(req.url);
  const versionId = searchParams.get('versionId');
  const versionNumberStr = searchParams.get('versionNumber');

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      currentVersion: true,
      versions: true,
    },
  });

  if (!document) {
    throw ApiError.notFound('Document not found.');
  }

  // Determine which version to download
  let targetVersion = document.currentVersion;

  if (versionId) {
    const found = document.versions.find((v) => v.id === versionId);
    if (!found) {
      throw ApiError.notFound(`Document version "${versionId}" not found.`);
    }
    targetVersion = found;
  } else if (versionNumberStr) {
    const num = parseInt(versionNumberStr, 10);
    const found = document.versions.find((v) => v.versionNumber === num);
    if (!found) {
      throw ApiError.notFound(`Document version ${num} not found.`);
    }
    targetVersion = found;
  }

  if (!targetVersion) {
    throw ApiError.notFound('No file version found for this document.');
  }

  // Stream file from MinIO
  const s3Response = await downloadFromS3({
    bucket: targetVersion.s3Bucket,
    key: targetVersion.s3Key,
  });

  if (!s3Response.body) {
    throw ApiError.internal('Unable to retrieve file stream from storage.');
  }

  // Convert AWS SDK stream to Web ReadableStream
  let webStream: ReadableStream;
  if (s3Response.body instanceof Readable) {
    webStream = Readable.toWeb(s3Response.body) as ReadableStream;
  } else {
    webStream = s3Response.body as unknown as ReadableStream;
  }

  // Log download audit event
  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'DOCUMENT_DOWNLOADED',
    entityType: 'document',
    entityId: documentId,
    changes: {
      documentId,
      versionId: targetVersion.id,
      versionNumber: targetVersion.versionNumber,
      fileName: targetVersion.fileName,
      fileSize: Number(targetVersion.fileSize),
    },
  });

  const encodedFileName = encodeURIComponent(targetVersion.fileName).replace(/['()]/g, escape);
  const headers = new Headers();
  headers.set('Content-Type', targetVersion.mimeType || 'application/octet-stream');
  if (s3Response.contentLength) {
    headers.set('Content-Length', s3Response.contentLength.toString());
  }
  headers.set(
    'Content-Disposition',
    `attachment; filename="${targetVersion.fileName}"; filename*=UTF-8''${encodedFileName}`
  );
  headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');

  return new NextResponse(webStream, {
    status: 200,
    headers,
  });
});

import { NextResponse } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { addDocumentVersion } from '@/lib/documents/document-service';
import { addDocumentVersionSchema } from '@/lib/validation/document';
import { ensureBucketsExist } from '@/lib/storage/s3';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// POST /api/v1/documents/[id]/versions - Upload a revised version
export const POST = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'documents:write');
  await ensureBucketsExist();
  const documentId = context!.params.id;

  const body = await req.json();
  const data = addDocumentVersionSchema.parse(body);

  const fileBuffer = Buffer.from(data.fileBase64, 'base64');
  if (fileBuffer.length === 0) {
    throw ApiError.badRequest('Decoded file buffer is empty.');
  }

  const result = await addDocumentVersion({
    documentId,
    fileBuffer,
    fileName: data.fileName,
    mimeType: data.mimeType,
    uploadedById: session.userId,
    userEmail: session.email,
    notes: data.notes,
  });

  return NextResponse.json(
    {
      message: `Version ${result.version.versionNumber} uploaded successfully`,
      version: result.version,
      document: {
        ...result.document,
        currentVersion: {
          ...result.document.currentVersion!,
          fileSize: Number(result.document.currentVersion!.fileSize),
        },
      },
    },
    { status: 201 }
  );
});

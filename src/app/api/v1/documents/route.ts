import { NextResponse } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { prisma } from '@/lib/db/prisma';
import {
  getDocuments,
  createDocumentWithVersion,
  DocumentFilterOptions,
} from '@/lib/documents/document-service';
import { createDocumentSchema } from '@/lib/validation/document';
import { ensureBucketsExist } from '@/lib/storage/s3';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

// GET /api/v1/documents - Global document repository query
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'documents:read');

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || undefined;
  const providerId = searchParams.get('providerId') || undefined;
  const entityType = searchParams.get('entityType') || undefined;
  const entityId = searchParams.get('entityId') || undefined;
  const documentType = searchParams.get('documentType') || undefined;
  const status = searchParams.get('status') || undefined;
  const isExpiringSoon = searchParams.get('isExpiringSoon') === 'true';
  const isExpired = searchParams.get('isExpired') === 'true';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const sortBy = (searchParams.get('sortBy') as DocumentFilterOptions['sortBy']) || 'createdAt';
  const sortOrder = (searchParams.get('sortOrder') as DocumentFilterOptions['sortOrder']) || 'desc';

  const result = await getDocuments({
    search,
    providerId,
    entityType,
    entityId,
    documentType,
    status,
    isExpiringSoon,
    isExpired,
    page,
    limit,
    sortBy,
    sortOrder,
  });

  return NextResponse.json(result);
});

// POST /api/v1/documents - Upload document with initial version
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'documents:write');
  await ensureBucketsExist();

  const body = await req.json();
  const data = createDocumentSchema.parse(body);

  // If a provider ID is supplied, verify the provider exists in the database
  if (data.providerId) {
    const provider = await prisma.provider.findUnique({
      where: { id: data.providerId },
      select: { id: true },
    });
    if (!provider) {
      throw ApiError.badRequest('The selected provider does not exist.');
    }
  }

  // Convert base64 to buffer
  const fileBuffer = Buffer.from(data.fileBase64, 'base64');

  if (fileBuffer.length === 0) {
    throw ApiError.badRequest('Decoded file buffer is empty.');
  }

  if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
    throw ApiError.badRequest(
      `File size exceeds the 25MB limit (received ${(fileBuffer.length / (1024 * 1024)).toFixed(2)}MB).`
    );
  }

  // Resolve polymorphic entity association
  const entityType = data.providerId ? 'provider' : (data.entityType || 'general');
  const entityId = data.providerId || data.entityId || crypto.randomUUID();

  const document = await createDocumentWithVersion({
    entityType,
    entityId,
    providerId: data.providerId || null,
    documentType: data.documentType,
    title: data.title,
    description: data.description,
    issueDate: data.issueDate,
    expirationDate: data.expirationDate,
    fileBuffer,
    fileName: data.fileName,
    mimeType: data.mimeType,
    uploadedById: session.userId,
    userEmail: session.email,
  });

  return NextResponse.json(
    {
      message: 'Document uploaded successfully',
      document,
    },
    { status: 201 }
  );
});

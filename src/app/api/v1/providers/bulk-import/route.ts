import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/server-auth';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { BulkService } from '@/lib/bulk/bulk-service';

export const dynamic = 'force-dynamic';

const bulkImportSchema = z.object({
  csvText: z.string().min(1, 'CSV content is required'),
  preview: z.boolean().default(false),
});

export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'providers:write');

  const body = await req.json().catch(() => null);
  if (!body) {
    throw ApiError.badRequest('Invalid JSON request body');
  }

  const { csvText, preview } = bulkImportSchema.parse(body);

  if (preview) {
    const previewResult = await BulkService.previewProviderImport(csvText);
    return NextResponse.json({
      success: true,
      mode: 'preview',
      ...previewResult,
    });
  }

  const commitResult = await BulkService.commitProviderImport({
    csvText,
    userId: session.userId,
    userEmail: session.email,
  });

  return NextResponse.json({
    mode: 'commit',
    ...commitResult,
  });
});

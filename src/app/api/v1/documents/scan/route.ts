import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { scanDocumentExpirationsAndPendingReview } from '@/lib/documents/document-service';

export const dynamic = 'force-dynamic';

// POST /api/v1/documents/scan - Trigger document expiration and pending-review scan
export const POST = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'documents:write');

  const result = await scanDocumentExpirationsAndPendingReview();

  return NextResponse.json({
    message: 'Document scan completed successfully',
    result,
  });
});

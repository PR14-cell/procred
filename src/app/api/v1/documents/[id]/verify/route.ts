import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { verifyDocument } from '@/lib/documents/document-service';
import { verifyDocumentSchema } from '@/lib/validation/document';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// POST /api/v1/documents/[id]/verify - Verify or reject a document
export const POST = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'documents:write');
  const documentId = context!.params.id;

  const body = await req.json();
  const data = verifyDocumentSchema.parse(body);

  const updatedDoc = await verifyDocument({
    documentId,
    status: data.status,
    reviewerId: session.userId,
    userEmail: session.email,
    verificationNotes: data.verificationNotes,
    rejectionReason: data.rejectionReason,
  });

  return NextResponse.json({
    message: `Document status updated to ${data.status}`,
    document: updatedDoc,
  });
});

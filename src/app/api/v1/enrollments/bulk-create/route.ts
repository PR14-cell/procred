import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/server-auth';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { BulkService } from '@/lib/bulk/bulk-service';

export const dynamic = 'force-dynamic';

const bulkEnrollmentSchema = z.object({
  providerIds: z.array(z.string().uuid()).min(1, 'At least one provider ID is required'),
  payerIds: z.array(z.string().uuid()).min(1, 'At least one payer ID is required'),
  enrollmentType: z.enum(['individual', 'group']).default('individual'),
  status: z.string().default('initial_application'),
  groupNpi: z.string().trim().optional().nullable(),
  groupNumber: z.string().trim().optional().nullable(),
  assignedToId: z.string().uuid().optional().nullable(),
  followUpDate: z.string().optional().nullable(),
  effectiveDate: z.string().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'enrollments:write');

  const body = await req.json().catch(() => null);
  if (!body) {
    throw ApiError.badRequest('Invalid JSON request body');
  }

  const validated = bulkEnrollmentSchema.parse(body);

  const result = await BulkService.createBulkEnrollments({
    input: validated,
    userId: session.userId,
    userEmail: session.email,
  });

  return NextResponse.json({
    ...result,
  });
});

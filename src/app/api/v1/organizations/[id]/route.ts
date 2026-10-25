import { NextResponse } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { hasPermission } from '@/lib/auth/rbac';
import { updateOrganizationSchema } from '@/lib/validation/organization';
import { OrganizationService } from '@/lib/organizations/organization-service';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// GET /api/v1/organizations/[id] - Get organization details
export const GET = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'organizations:read');
  const id = context?.params.id;
  if (!id) throw ApiError.badRequest('Organization ID is required.');

  const { searchParams } = new URL(req.url);
  // Only users with 'pii:reveal' permission can reveal the full unmasked Tax ID
  const canReveal = hasPermission(session.role, 'pii:reveal');
  const revealTaxId = canReveal && searchParams.get('revealTaxId') === 'true';

  const org = await OrganizationService.getOrganizationById(id, {
    revealTaxId,
    actor: { userId: session.userId, userEmail: session.email },
  });

  return NextResponse.json({ organization: org });
});

// PATCH /api/v1/organizations/[id] - Update organization details
export const PATCH = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'organizations:write');
  const id = context?.params.id;
  if (!id) throw ApiError.badRequest('Organization ID is required.');

  const body = await req.json();
  const parsed = updateOrganizationSchema.parse(body);

  const updated = await OrganizationService.updateOrganization(id, parsed, {
    userId: session.userId,
    userEmail: session.email,
  });

  return NextResponse.json({
    message: 'Organization updated successfully.',
    organization: updated,
  });
});

// DELETE /api/v1/organizations/[id] - Archive or hard-delete organization
export const DELETE = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'organizations:write');
  const id = context?.params.id;
  if (!id) throw ApiError.badRequest('Organization ID is required.');

  const { searchParams } = new URL(req.url);
  const hard = searchParams.get('hard') === 'true' || searchParams.get('hardDelete') === 'true';

  const result = await OrganizationService.archiveOrDelete(id, { hard }, {
    userId: session.userId,
    userEmail: session.email,
  });

  return NextResponse.json(result);
});

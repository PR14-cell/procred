import { NextResponse } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { associateProviderSchema, disassociateProviderSchema } from '@/lib/validation/organization';
import { OrganizationService } from '@/lib/organizations/organization-service';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// POST /api/v1/organizations/[id]/providers - Associate provider with organization
export const POST = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'organizations:write');
  const organizationId = context?.params.id;
  if (!organizationId) throw ApiError.badRequest('Organization ID is required.');

  const body = await req.json();
  const parsed = associateProviderSchema.parse(body);

  const affiliation = await OrganizationService.associateProvider(
    organizationId,
    parsed,
    {
      userId: session.userId,
      userEmail: session.email,
    }
  );

  return NextResponse.json(
    {
      message: 'Provider associated with organization successfully.',
      affiliation,
    },
    { status: 201 }
  );
});

// DELETE /api/v1/organizations/[id]/providers - Remove provider affiliation from organization
export const DELETE = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'organizations:write');
  const organizationId = context?.params.id;
  if (!organizationId) throw ApiError.badRequest('Organization ID is required.');

  const { searchParams } = new URL(req.url);
  const providerIdParam = searchParams.get('providerId');

  let providerId = providerIdParam;
  if (!providerId) {
    try {
      const body = await req.json();
      const parsed = disassociateProviderSchema.parse(body);
      providerId = parsed.providerId;
    } catch {
      throw ApiError.badRequest('Valid providerId is required in query params or JSON body.');
    }
  }

  const result = await OrganizationService.disassociateProvider(
    organizationId,
    providerId,
    {
      userId: session.userId,
      userEmail: session.email,
    }
  );

  return NextResponse.json(result);
});

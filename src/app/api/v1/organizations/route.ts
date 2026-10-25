import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { createOrganizationSchema } from '@/lib/validation/organization';
import { OrganizationService } from '@/lib/organizations/organization-service';

export const dynamic = 'force-dynamic';

// GET /api/v1/organizations - List & search organizations
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'organizations:read');

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || undefined;
  const status = searchParams.get('status') || undefined;
  const organizationType = searchParams.get('organizationType') || undefined;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const sortBy = (searchParams.get('sortBy') as any) || 'name';
  const sortOrder = (searchParams.get('sortOrder') as any) || 'asc';

  const result = await OrganizationService.listOrganizations({
    search,
    status,
    organizationType,
    page,
    limit,
    sortBy,
    sortOrder,
  });

  return NextResponse.json(result);
});

// POST /api/v1/organizations - Create new organization
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'organizations:write');

  const body = await req.json();
  const parsed = createOrganizationSchema.parse(body);

  const org = await OrganizationService.createOrganization(parsed, {
    userId: session.userId,
    userEmail: session.email,
  });

  return NextResponse.json(
    {
      message: 'Organization created successfully.',
      organization: org,
    },
    { status: 201 }
  );
});

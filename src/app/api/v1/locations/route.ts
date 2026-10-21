import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { createLocationSchema } from '@/lib/validation/provider';
import { logAuditEvent } from '@/lib/audit/audit-logger';

export const dynamic = 'force-dynamic';

// GET /api/v1/locations - List Locations
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'providers:read');

  const locations = await prisma.location.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: {
          providers: true,
          enrollments: true,
        },
      },
    },
  });

  return NextResponse.json({ locations });
});

// POST /api/v1/locations - Create Location
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'providers:write');

  const body = await req.json();
  const parsed = createLocationSchema.parse(body);

  const location = await prisma.location.create({
    data: {
      name: parsed.name,
      address1: parsed.address1,
      address2: parsed.address2 || null,
      city: parsed.city,
      state: parsed.state,
      zipCode: parsed.zipCode,
      phone: parsed.phone || null,
      fax: parsed.fax || null,
      isActive: parsed.isActive,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'create_location',
    entityType: 'location',
    entityId: location.id,
    changes: {
      name: { new: location.name },
      city: { new: location.city },
      state: { new: location.state },
    },
  });

  return NextResponse.json(
    {
      location,
      message: 'Location created successfully.',
    },
    { status: 201 }
  );
});

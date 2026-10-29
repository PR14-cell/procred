import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { linkLocationSchema } from '@/lib/validation/provider';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { resolveRouteParamId, type RouteParamsContext } from '@/lib/http/route-params';

export const dynamic = 'force-dynamic';

interface RouteContext extends RouteParamsContext {}

// POST /api/v1/providers/[id]/locations - Link Practice Location
export const POST = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'providers:write');
  const providerId = await resolveRouteParamId(req, context, 1);

  if (!providerId) {
    throw ApiError.badRequest('Provider ID is required.');
  }

  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
  });
  if (!provider) {
    throw ApiError.notFound('Provider not found.');
  }

  const body = await req.json();
  const parsed = linkLocationSchema.parse(body);

  const { location, locationLink } = await prisma.$transaction(async (tx) => {
    const location = parsed.newLocation
      ? await tx.location.create({
          data: {
            ...parsed.newLocation,
            address2: parsed.newLocation.address2 || null,
            phone: parsed.newLocation.phone || null,
            fax: parsed.newLocation.fax || null,
          },
        })
      : await tx.location.findUnique({
          where: { id: parsed.locationId! },
        });

    if (!location) {
      throw ApiError.notFound('Location not found.');
    }

    const existingLink = await tx.providerLocation.findUnique({
      where: {
        providerId_locationId: {
          providerId,
          locationId: location.id,
        },
      },
    });
    if (existingLink) {
      throw ApiError.conflict('This practice location is already linked to the provider.');
    }

    if (parsed.isPrimary) {
      await tx.providerLocation.updateMany({
        where: { providerId },
        data: { isPrimary: false },
      });
    }

    const locationLink = await tx.providerLocation.create({
      data: {
        providerId,
        locationId: location.id,
        isPrimary: parsed.isPrimary,
      },
      include: {
        location: true,
      },
    });

    return { location, locationLink };
  });

  if (parsed.newLocation) {
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
  }

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'link_location',
    entityType: 'provider',
    entityId: providerId,
    changes: {
      locationId: { new: location.id },
      locationName: { new: location.name },
      isPrimary: { new: parsed.isPrimary },
    },
  });

  return NextResponse.json(
    {
      locationLink,
      message: parsed.newLocation
        ? 'Location created and linked to provider successfully.'
        : 'Location linked to provider successfully.',
    },
    { status: 201 }
  );
});

// DELETE /api/v1/providers/[id]/locations - Unlink Location
export const DELETE = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'providers:write');
  const providerId = await resolveRouteParamId(req, context, 1);

  if (!providerId) {
    throw ApiError.badRequest('Provider ID is required.');
  }

  const { searchParams } = new URL(req.url);
  const locationId = searchParams.get('locationId');

  if (!locationId) {
    throw ApiError.badRequest('locationId query parameter is required.');
  }

  const link = await prisma.providerLocation.findUnique({
    where: {
      providerId_locationId: {
        providerId,
        locationId,
      },
    },
  });

  if (!link) {
    throw ApiError.notFound('Location link not found for this provider.');
  }

  await prisma.providerLocation.delete({
    where: {
      providerId_locationId: {
        providerId,
        locationId,
      },
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'unlink_location',
    entityType: 'provider',
    entityId: providerId,
    changes: {
      locationId: { old: locationId, new: null },
    },
  });

  return NextResponse.json({
    success: true,
    message: 'Location unlinked successfully.',
  });
});

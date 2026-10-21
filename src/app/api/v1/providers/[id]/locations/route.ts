import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { linkLocationSchema } from '@/lib/validation/provider';
import { logAuditEvent } from '@/lib/audit/audit-logger';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// POST /api/v1/providers/[id]/locations - Link Practice Location
export const POST = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'providers:write');
  const providerId = context?.params.id;

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

  // Verify location exists
  const location = await prisma.location.findUnique({
    where: { id: parsed.locationId },
  });
  if (!location) {
    throw ApiError.notFound('Location not found.');
  }

  // Check if already linked
  const existingLink = await prisma.providerLocation.findUnique({
    where: {
      providerId_locationId: {
        providerId,
        locationId: parsed.locationId,
      },
    },
  });
  if (existingLink) {
    throw ApiError.conflict('This practice location is already linked to the provider.');
  }

  // If marked primary, unset primary flag on existing locations
  if (parsed.isPrimary) {
    await prisma.providerLocation.updateMany({
      where: { providerId },
      data: { isPrimary: false },
    });
  }

  const newLink = await prisma.providerLocation.create({
    data: {
      providerId,
      locationId: parsed.locationId,
      isPrimary: parsed.isPrimary,
    },
    include: {
      location: true,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'link_location',
    entityType: 'provider',
    entityId: providerId,
    changes: {
      locationId: { new: parsed.locationId },
      locationName: { new: location.name },
      isPrimary: { new: parsed.isPrimary },
    },
  });

  return NextResponse.json(
    {
      locationLink: newLink,
      message: 'Location linked to provider successfully.',
    },
    { status: 201 }
  );
});

// DELETE /api/v1/providers/[id]/locations - Unlink Location
export const DELETE = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'providers:write');
  const providerId = context?.params.id;

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

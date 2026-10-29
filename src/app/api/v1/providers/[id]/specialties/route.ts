import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { addSpecialtySchema } from '@/lib/validation/provider';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { resolveRouteParamId, type RouteParamsContext } from '@/lib/http/route-params';

export const dynamic = 'force-dynamic';

interface RouteContext extends RouteParamsContext {}

// POST /api/v1/providers/[id]/specialties - Add Specialty
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
  const parsed = addSpecialtySchema.parse(body);

  let taxonomyCode: string;

  if (parsed.specialtyName) {
    const customClassification = 'Custom Specialty';
    const existingCustomTaxonomy = await prisma.taxonomyCode.findFirst({
      where: {
        classification: customClassification,
        specialization: { equals: parsed.specialtyName, mode: 'insensitive' },
      },
    });

    const taxonomy = existingCustomTaxonomy || await prisma.taxonomyCode.create({
      data: {
        code: `CUSTOM-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
        classification: customClassification,
        specialization: parsed.specialtyName,
      },
    });
    taxonomyCode = taxonomy.code;
  } else {
    if (!parsed.taxonomyCode) {
      throw ApiError.badRequest('A taxonomy code or custom specialty name is required.');
    }
    taxonomyCode = parsed.taxonomyCode;
    const taxonomy = await prisma.taxonomyCode.findUnique({
      where: { code: taxonomyCode },
    });
    if (!taxonomy) {
      throw ApiError.notFound(`Taxonomy code ${taxonomyCode} not found in directory.`);
    }
  }

  // Check if already linked
  const existingLink = await prisma.providerSpecialty.findUnique({
    where: {
      providerId_taxonomyCode: {
        providerId,
        taxonomyCode,
      },
    },
  });
  if (existingLink) {
    throw ApiError.conflict('This specialty is already linked to the provider.');
  }

  // If marked primary, unset primary flag on existing specialties
  if (parsed.isPrimary) {
    await prisma.providerSpecialty.updateMany({
      where: { providerId },
      data: { isPrimary: false },
    });
  }

  const newSpecialty = await prisma.providerSpecialty.create({
    data: {
      providerId,
      taxonomyCode,
      isPrimary: parsed.isPrimary,
    },
    include: {
      taxonomy: true,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'add_specialty',
    entityType: 'provider',
    entityId: providerId,
    changes: {
      taxonomyCode: { new: taxonomyCode },
      ...(parsed.specialtyName ? { specialtyName: { new: parsed.specialtyName } } : {}),
      isPrimary: { new: parsed.isPrimary },
    },
  });

  return NextResponse.json(
    {
      specialty: newSpecialty,
      message: 'Specialty linked to provider successfully.',
    },
    { status: 201 }
  );
});

// DELETE /api/v1/providers/[id]/specialties - Remove Specialty
export const DELETE = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'providers:write');
  const providerId = await resolveRouteParamId(req, context, 1);

  if (!providerId) {
    throw ApiError.badRequest('Provider ID is required.');
  }

  const { searchParams } = new URL(req.url);
  const taxonomyCode = searchParams.get('taxonomyCode');

  if (!taxonomyCode) {
    throw ApiError.badRequest('taxonomyCode query parameter is required.');
  }

  const specialty = await prisma.providerSpecialty.findUnique({
    where: {
      providerId_taxonomyCode: {
        providerId,
        taxonomyCode,
      },
    },
  });

  if (!specialty) {
    throw ApiError.notFound('Specialty link not found on this provider.');
  }

  await prisma.providerSpecialty.delete({
    where: {
      providerId_taxonomyCode: {
        providerId,
        taxonomyCode,
      },
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'remove_specialty',
    entityType: 'provider',
    entityId: providerId,
    changes: {
      taxonomyCode: { old: taxonomyCode, new: null },
    },
  });

  return NextResponse.json({
    success: true,
    message: 'Specialty unlinked successfully.',
  });
});

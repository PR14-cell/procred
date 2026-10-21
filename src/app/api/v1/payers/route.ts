import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { createPayerSchema } from '@/lib/validation/enrollment';

export const dynamic = 'force-dynamic';

// GET /api/v1/payers - List payers with search and filters
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'payers:read');

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || undefined;
  const payerType = searchParams.get('payerType') || undefined;
  const state = searchParams.get('state') || undefined;
  const isActive = searchParams.get('isActive') !== null ? searchParams.get('isActive') === 'true' : undefined;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  const where: Record<string, unknown> = {};
  if (isActive !== undefined) where.isActive = isActive;
  if (payerType && payerType !== 'all') where.payerType = payerType;
  if (state) where.state = state.toUpperCase();

  if (search && search.trim() !== '') {
    where.OR = [
      { name: { contains: search.trim(), mode: 'insensitive' } },
      { shortName: { contains: search.trim(), mode: 'insensitive' } },
    ];
  }

  const [totalItems, payers] = await Promise.all([
    prisma.payer.count({ where }),
    prisma.payer.findMany({
      where,
      include: {
        _count: {
          select: { enrollments: true },
        },
      },
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalItems / limit));

  return NextResponse.json({
    payers,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
    },
  });
});

// POST /api/v1/payers - Create new payer in directory
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'payers:write');
  const body = await req.json();

  const data = createPayerSchema.parse(body);

  const payer = await prisma.payer.create({
    data: {
      name: data.name,
      shortName: data.shortName,
      payerType: data.payerType,
      state: data.state,
      website: data.website || null,
      phone: data.phone,
      enrollmentPortalUrl: data.enrollmentPortalUrl || null,
      requiredDocumentTypes: data.requiredDocumentTypes,
      notes: data.notes,
      isActive: data.isActive,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'PAYER_CREATED',
    entityType: 'payer',
    entityId: payer.id,
    changes: {
      name: payer.name,
      payerType: payer.payerType,
      state: payer.state,
    },
  });

  return NextResponse.json(
    {
      message: 'Payer created successfully',
      payer,
    },
    { status: 201 }
  );
});

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';

export const dynamic = 'force-dynamic';

const createManualTaxonomySchema = z.object({
  code: z.string().trim().min(1).max(20).optional(),
  classification: z.string().trim().min(1).max(255).default('Custom'),
  specialization: z.string().trim().min(1).max(255),
});

export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'providers:read');

  const taxonomyCodes = await prisma.taxonomyCode.findMany({
    where: { isActive: true },
    orderBy: { specialization: 'asc' },
  });

  return NextResponse.json({ taxonomyCodes });
});

export const POST = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'providers:write');

  const data = createManualTaxonomySchema.parse(await req.json());
  const code = data.code?.toUpperCase();

  if (code) {
    const existingByCode = await prisma.taxonomyCode.findUnique({ where: { code } });
    if (existingByCode) {
      return NextResponse.json({ taxonomyCode: existingByCode, reused: true });
    }
  } else {
    const existingByName = await prisma.taxonomyCode.findFirst({
      where: {
        specialization: { equals: data.specialization, mode: 'insensitive' },
      },
    });
    if (existingByName) {
      return NextResponse.json({ taxonomyCode: existingByName, reused: true });
    }
  }

  const resolvedCode = code || `CUSTOM-${createHash('sha256')
    .update(data.specialization.toLowerCase())
    .digest('hex')
    .slice(0, 12)
    .toUpperCase()}`;
  const taxonomyCode = await prisma.taxonomyCode.upsert({
    where: { code: resolvedCode },
    update: {},
    create: {
      code: resolvedCode,
      classification: data.classification,
      specialization: data.specialization,
    },
  });

  return NextResponse.json({ taxonomyCode, reused: false }, { status: 201 });
});

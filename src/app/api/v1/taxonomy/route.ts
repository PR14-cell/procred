import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'providers:read');

  const taxonomyCodes = await prisma.taxonomyCode.findMany({
    where: { isActive: true },
    orderBy: { specialization: 'asc' },
  });

  return NextResponse.json({ taxonomyCodes });
});

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';

export const dynamic = 'force-dynamic';

// GET /api/v1/users - List active staff members for task assignment & mentions
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req);

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  return NextResponse.json({ users });
});

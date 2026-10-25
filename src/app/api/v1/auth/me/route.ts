import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

// GET /api/v1/auth/me - Retrieve current authenticated session identity & role
export const GET = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req);

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  });

  return NextResponse.json({
    user: user || {
      id: session.userId,
      email: session.email,
      role: session.role,
    },
  });
});

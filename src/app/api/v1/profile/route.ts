import { NextResponse } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { prisma } from '@/lib/db/prisma';
import { updateProfileSchema } from '@/lib/validation/user';
import { logAuditEvent } from '@/lib/audit/audit-logger';

export const dynamic = 'force-dynamic';

// GET /api/v1/profile - Get current user profile
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
      isActive: true,
      mfaEnabled: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw ApiError.notFound('User profile not found.');
  }

  return NextResponse.json({ user });
});

// PATCH /api/v1/profile - Update current user profile (first/last name only; role and status immutable)
export const PATCH = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req);

  const body = await req.json();
  const data = updateProfileSchema.parse(body);

  const updatedUser = await prisma.user.update({
    where: { id: session.userId },
    data: {
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      mfaEnabled: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'profile_updated',
    entityType: 'user',
    entityId: session.userId,
    changes: {
      firstName: { new: updatedUser.firstName },
      lastName: { new: updatedUser.lastName },
    },
  });

  return NextResponse.json({
    success: true,
    message: 'Profile updated successfully.',
    user: updatedUser,
  });
});

import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { ApiError, withErrorHandler } from '@/lib/errors/api-error';
import { verifySessionToken } from '@/lib/auth/jwt';
import { hasPermission } from '@/lib/auth/rbac';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { UserRole } from '@prisma/client';

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  role: z.nativeEnum(UserRole).default('viewer'),
});

async function requireAdminAuth(req: Request) {
  const cookieHeader = req.headers.get('cookie') || '';
  const tokenMatch = cookieHeader.match(/session_token=([^;]+)/);
  const token = tokenMatch ? tokenMatch[1] : null;

  if (!token) {
    throw ApiError.unauthorized('Authentication session is required.');
  }

  const session = await verifySessionToken(token);
  if (!session) {
    throw ApiError.unauthorized('Invalid or expired session.');
  }

  if (!hasPermission(session.role, 'users:manage')) {
    throw ApiError.forbidden('Forbidden: admin or super_admin role required.');
  }

  return session;
}

// GET /api/v1/admin/users - List users
export const GET = withErrorHandler(async (req: Request) => {
  await requireAdminAuth(req);

  const users = await prisma.user.findMany({
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
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ users });
});

// POST /api/v1/admin/users - Create user
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAdminAuth(req);
  const body = await req.json();
  const data = createUserSchema.parse(body);

  const passwordHash = await bcrypt.hash(data.password, 12);

  const newUser = await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'create_user',
    entityType: 'user',
    entityId: newUser.id,
    changes: {
      email: { new: newUser.email },
      role: { new: newUser.role },
    },
  });

  return NextResponse.json({ user: newUser }, { status: 201 });
});

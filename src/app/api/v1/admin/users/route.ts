import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { createUserSchema } from '@/lib/validation/user';
import { UserRole, Prisma } from '@prisma/client';
import { assertFreshTotp } from '@/lib/auth/totp-challenge';

export const dynamic = 'force-dynamic';

// GET /api/v1/admin/users - List and search users with pagination
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'users:manage');

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search')?.trim() || '';
  const roleParam = searchParams.get('role')?.trim() || '';
  const statusParam = searchParams.get('status')?.trim() || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
  const skip = (page - 1) * limit;

  const whereClause: Prisma.UserWhereInput = {};

  if (search) {
    whereClause.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (roleParam && Object.values(UserRole).includes(roleParam as UserRole)) {
    whereClause.role = roleParam as UserRole;
  }

  if (statusParam === 'active') {
    whereClause.isActive = true;
  } else if (statusParam === 'inactive') {
    whereClause.isActive = false;
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where: whereClause }),
    prisma.user.findMany({
      where: whereClause,
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
      skip,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    users,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  });
});

// POST /api/v1/admin/users - Create staff user
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'users:manage');
  const body = await req.json();
  const data = createUserSchema.parse(body);

  // Privilege escalation check: only super_admin can create another super_admin
  if (data.role === UserRole.super_admin) {
    if (session.role !== UserRole.super_admin) {
      throw ApiError.forbidden('Only a super_admin can create another super_admin account.');
    }
    await assertFreshTotp(req, session.userId, data);
  }

  // Check email uniqueness
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase() },
  });
  if (existingUser) {
    throw ApiError.badRequest('A user with this email address already exists.');
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const newUser = await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      passwordHash,
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      role: data.role,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      mfaEnabled: true,
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

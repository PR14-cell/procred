import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { ApiError, withErrorHandler } from '@/lib/errors/api-error';
import { createSessionToken } from '@/lib/auth/jwt';
import { logAuditEvent } from '@/lib/audit/audit-logger';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const POST = withErrorHandler(async (req: Request) => {
  const body = await req.json();
  const { email, password } = loginSchema.parse(body);

  const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
  const userAgent = req.headers.get('user-agent') || 'unknown';

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Invalid email or password.');
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    await logAuditEvent({
      userId: user.id,
      userEmail: user.email,
      action: 'login_failed',
      entityType: 'user',
      entityId: user.id,
      metadata: { ipAddress, userAgent },
    });
    throw ApiError.unauthorized('Invalid email or password.');
  }

  // If MFA is enabled, return requirement for TOTP verification step
  if (user.mfaEnabled) {
    return NextResponse.json({
      mfaRequired: true,
      userId: user.id,
      email: user.email,
      message: 'MFA verification required.',
    });
  }

  // Create active session in database (with IP and user_agent tracking)
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours
  const sessionRecord = await prisma.userSession.create({
    data: {
      userId: user.id,
      sessionToken: crypto.randomUUID(),
      expiresAt,
      ipAddress,
      userAgent,
    },
  });

  const jwtToken = await createSessionToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    sessionId: sessionRecord.id,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await logAuditEvent({
    userId: user.id,
    userEmail: user.email,
    action: 'login_success',
    entityType: 'user',
    entityId: user.id,
    metadata: { ipAddress, userAgent },
  });

  const response = NextResponse.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  });

  // Set secure HTTP-only cookie
  response.cookies.set('session_token', jwtToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return response;
});

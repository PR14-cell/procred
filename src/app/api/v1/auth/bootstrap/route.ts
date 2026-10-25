import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { UserRole } from '@prisma/client';
import { ApiError, withErrorHandler } from '@/lib/errors/api-error';
import { createPreAuthToken } from '@/lib/auth/jwt';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { getSessionCookieOptions } from '@/lib/auth/cookies';
import { getClientIp, assertRateLimit } from '@/lib/auth/rate-limiter';

const bootstrapSchema = z.object({
  setupToken: z.string().min(8, 'Setup token is required'),
  email: z.string().email(),
  password: z.string().min(12, 'Administrator password must be at least 12 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
});

/**
 * GET /api/v1/auth/bootstrap - Check if initial bootstrap is available.
 */
export const GET = withErrorHandler(async () => {
  const existingSuperAdmin = await prisma.user.findFirst({
    where: { role: UserRole.super_admin, isActive: true },
  });

  const bootstrapSetting = await prisma.systemSetting.findUnique({
    where: { key: 'bootstrap_completed' },
  });

  const isBootstrapAvailable = !existingSuperAdmin && (!bootstrapSetting || bootstrapSetting.value !== 'true');

  return NextResponse.json({
    available: isBootstrapAvailable,
    message: isBootstrapAvailable
      ? 'Initial administrator setup is available.'
      : 'Initial administrator setup has already been completed.',
  });
});

/**
 * POST /api/v1/auth/bootstrap - Provision initial administrator.
 * Requires INITIAL_SETUP_TOKEN from server environment. Permanently seals upon completion.
 * Enforces timing-safe token verification, IP rate limiting, and Serializable transaction isolation.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const ipAddress = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || 'unknown';

  // Rate limit to 5 attempts per 15 minutes per IP
  await assertRateLimit({
    keyPrefix: 'bootstrap_attempts',
    identifier: ipAddress,
    maxAttempts: 5,
    windowSeconds: 15 * 60,
    errorMessage: 'Too many bootstrap attempts from this IP address. Please wait 15 minutes.',
  });

  const body = await req.json();
  const { setupToken, email, password, firstName, lastName } = bootstrapSchema.parse(body);

  // Compare setup token using crypto.timingSafeEqual on SHA-256 hashes of both values
  const expectedToken = process.env.INITIAL_SETUP_TOKEN || process.env.SETUP_TOKEN || '';
  const expectedHash = crypto.createHash('sha256').update(expectedToken).digest();
  const inputHash = crypto.createHash('sha256').update(setupToken).digest();
  const isTokenValid = expectedToken.length > 0 && crypto.timingSafeEqual(expectedHash, inputHash);

  if (!isTokenValid) {
    await logAuditEvent({
      action: 'bootstrap_failed',
      entityType: 'system',
      entityId: 'bootstrap',
      metadata: { ipAddress, userAgent, reason: 'invalid_setup_token' },
    });
    throw ApiError.forbidden('Invalid or missing initial setup token.');
  }

  const normalizedEmail = email.toLowerCase().trim();
  const passwordHash = await bcrypt.hash(password, 12);

  // Check already bootstrapped & create user in a single transaction with Serializable isolation
  let adminUser;
  try {
    adminUser = await prisma.$transaction(
      async (tx) => {
        const existingSuperAdmin = await tx.user.findFirst({
          where: { role: UserRole.super_admin, isActive: true },
        });

        const bootstrapSetting = await tx.systemSetting.findUnique({
          where: { key: 'bootstrap_completed' },
        });

        if (existingSuperAdmin || (bootstrapSetting && bootstrapSetting.value === 'true')) {
          throw ApiError.forbidden('Initial administrator setup has already been completed. This endpoint is permanently sealed.');
        }

        const existingEmail = await tx.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (existingEmail) {
          throw ApiError.conflict('A user with this email address already exists.');
        }

        const newUser = await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            firstName,
            lastName,
            role: UserRole.super_admin,
            isActive: true,
            mfaEnabled: false,
          },
        });

        await tx.systemSetting.upsert({
          where: { key: 'bootstrap_completed' },
          update: { value: 'true' },
          create: { key: 'bootstrap_completed', value: 'true' },
        });

        return newUser;
      },
      {
        isolationLevel: 'Serializable',
      }
    );
  } catch (err) {
    if (err instanceof ApiError) {
      await logAuditEvent({
        action: 'bootstrap_failed',
        entityType: 'system',
        entityId: 'bootstrap',
        metadata: { ipAddress, userAgent, reason: err.message },
      });
    }
    throw err;
  }

  await logAuditEvent({
    userId: adminUser.id,
    userEmail: adminUser.email,
    action: 'initial_administrator_bootstrapped',
    entityType: 'user',
    entityId: adminUser.id,
    metadata: { ipAddress, userAgent },
  });

  // Issue pre-auth token requiring mandatory MFA enrollment before any application access
  const preAuthToken = await createPreAuthToken(
    {
      userId: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      authStage: 'mfa_enrollment_required',
    },
    '20m'
  );

  const response = NextResponse.json({
    success: true,
    message: 'Initial administrator created successfully. You must now enroll in Two-Factor Authentication.',
    userId: adminUser.id,
    email: adminUser.email,
    authStage: 'mfa_enrollment_required',
    preAuthToken,
  });

  const cookieExpires = new Date(Date.now() + 20 * 60 * 1000);
  response.cookies.set('mfa_preauth_token', preAuthToken, getSessionCookieOptions(req, cookieExpires));

  return response;
});

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth, invalidateAllUserSessions } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { updateUserAdminSchema } from '@/lib/validation/user';
import { UserRole } from '@prisma/client';
import { assertFreshTotp } from '@/lib/auth/totp-challenge';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// GET /api/v1/admin/users/[id] - Get user details
export const GET = withErrorHandler(
  async (req: Request, context?: RouteContext) => {
    await requireAuth(req, 'users:manage');
    const targetUserId = context?.params.id;

    if (!targetUserId) {
      throw ApiError.badRequest('User ID is required.');
    }

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
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
        updatedAt: true,
        _count: {
          select: {
            sessions: true,
            assignedTasks: true,
            assignedEnrollments: true,
          },
        },
      },
    });

    if (!user) {
      throw ApiError.notFound('User not found.');
    }

    return NextResponse.json({ user });
  }
);

// PATCH /api/v1/admin/users/[id] - Update user profile, role, or active status
export const PATCH = withErrorHandler(
  async (req: Request, context?: RouteContext) => {
    const session = await requireAuth(req, 'users:manage');
    const targetUserId = context?.params.id;

    if (!targetUserId) {
      throw ApiError.badRequest('User ID is required.');
    }

    const body = await req.json();
    const data = updateUserAdminSchema.parse(body);

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      throw ApiError.notFound('User not found.');
    }

    // Protection: Non-super_admin cannot modify, demote, or deactivate a super_admin user
    if (targetUser.role === UserRole.super_admin && session.role !== UserRole.super_admin) {
      throw ApiError.forbidden('Only a super_admin can modify another super_admin account.');
    }

    // 1. Prevent self-role modification (prevent self-promotion or locking out)
    if (data.role !== undefined && data.role !== targetUser.role) {
      if (session.userId === targetUserId) {
        throw ApiError.badRequest('Administrators cannot modify their own role.');
      }
      // Only super_admin can promote an account to super_admin
      if (data.role === UserRole.super_admin && session.role !== UserRole.super_admin) {
        throw ApiError.forbidden('Only a super_admin can promote an account to super_admin.');
      }
      // Require fresh TOTP verification when changing anyone's role to or from super_admin
      if (data.role === UserRole.super_admin || targetUser.role === UserRole.super_admin) {
        await assertFreshTotp(req, session.userId, data);
      }
    }

    // 2. Last Active Administrator Protection
    const isTargetAdmin =
      targetUser.isActive &&
      (targetUser.role === UserRole.super_admin || targetUser.role === UserRole.admin);

    const willBeInactive = data.isActive === false;
    const willBeDemoted =
      data.role !== undefined &&
      data.role !== UserRole.super_admin &&
      data.role !== UserRole.admin;

    if (isTargetAdmin && (willBeInactive || willBeDemoted)) {
      const otherActiveAdmins = await prisma.user.count({
        where: {
          role: { in: [UserRole.super_admin, UserRole.admin] },
          isActive: true,
          id: { not: targetUserId },
        },
      });

      if (otherActiveAdmins === 0) {
        throw ApiError.badRequest(
          'Action rejected: Cannot deactivate or demote the last active administrator.'
        );
      }
    }

    // 3. Prepare update data
    const updateData: any = {};
    const changes: Record<string, { old: any; new: any }> = {};

    if (data.firstName !== undefined && data.firstName.trim() !== targetUser.firstName) {
      updateData.firstName = data.firstName.trim();
      changes.firstName = { old: targetUser.firstName, new: updateData.firstName };
    }

    if (data.lastName !== undefined && data.lastName.trim() !== targetUser.lastName) {
      updateData.lastName = data.lastName.trim();
      changes.lastName = { old: targetUser.lastName, new: updateData.lastName };
    }

    if (data.role !== undefined && data.role !== targetUser.role) {
      updateData.role = data.role;
      changes.role = { old: targetUser.role, new: data.role };
    }

    if (data.isActive !== undefined && data.isActive !== targetUser.isActive) {
      updateData.isActive = data.isActive;
      changes.isActive = { old: targetUser.isActive, new: data.isActive };
    }

    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        mfaEnabled: true,
        lastLoginAt: true,
        updatedAt: true,
      },
    });

    // 4. Invalidate all active sessions on deactivation or role change
    const isDeactivated = data.isActive === false && targetUser.isActive;
    const isRoleChanged = data.role !== undefined && data.role !== targetUser.role;
    if (isDeactivated || isRoleChanged) {
      await invalidateAllUserSessions(targetUserId);
    }

    // 5. Audit Logging
    let action = 'user_updated';
    if (data.isActive === false && targetUser.isActive) {
      action = 'user_deactivated';
    } else if (data.isActive === true && !targetUser.isActive) {
      action = 'user_reactivated';
    }

    await logAuditEvent({
      userId: session.userId,
      userEmail: session.email,
      action,
      entityType: 'user',
      entityId: targetUserId,
      changes: Object.keys(changes).length > 0 ? changes : undefined,
    });

    return NextResponse.json({
      success: true,
      message: 'User updated successfully.',
      user: updatedUser,
    });
  }
);

import { z } from 'zod';
import { UserRole } from '@prisma/client';

export const passwordPolicySchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long.')
  .regex(/[a-z]/, 'Password must include at least one lowercase letter.')
  .regex(/[A-Z]/, 'Password must include at least one uppercase letter.')
  .regex(/[0-9]/, 'Password must include at least one number.');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required.'),
    newPassword: passwordPolicySchema,
    confirmPassword: z.string().min(1, 'Password confirmation is required.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'New password and confirmation do not match.',
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password.',
    path: ['newPassword'],
  });

export const updateProfileSchema = z.object({
  firstName: z.string().min(1, 'First name is required.').max(100),
  lastName: z.string().min(1, 'Last name is required.').max(100),
});

export const createUserSchema = z.object({
  email: z.string().email('Valid email address is required.').max(255),
  password: passwordPolicySchema,
  firstName: z.string().min(1, 'First name is required.').max(100),
  lastName: z.string().min(1, 'Last name is required.').max(100),
  role: z.nativeEnum(UserRole).default(UserRole.viewer),
});

export const updateUserAdminSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  role: z.nativeEnum(UserRole).optional(),
  isActive: z.boolean().optional(),
});

export const adminResetPasswordSchema = z.object({
  temporaryPassword: passwordPolicySchema.optional(),
});

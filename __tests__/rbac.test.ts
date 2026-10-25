import { describe, it, expect } from 'vitest';
import { hasPermission, hasRole } from '@/lib/auth/rbac';
import { UserRole } from '@prisma/client';

describe('RBAC Middleware & Permissions Foundation', () => {
  it('should grant super_admin full permissions including users:manage and system:settings', () => {
    expect(hasPermission(UserRole.super_admin, 'users:manage')).toBe(true);
    expect(hasPermission(UserRole.super_admin, 'system:settings')).toBe(true);
    expect(hasPermission(UserRole.super_admin, 'providers:write')).toBe(true);
    expect(hasPermission(UserRole.super_admin, 'documents:delete')).toBe(true);
    expect(hasPermission(UserRole.super_admin, 'audit:read')).toBe(true);
  });

  it('should prevent credentialing_specialist from managing users or altering payer enrollments directly', () => {
    expect(hasPermission(UserRole.credentialing_specialist, 'users:manage')).toBe(false);
    expect(hasPermission(UserRole.credentialing_specialist, 'enrollments:read')).toBe(true);
    expect(hasPermission(UserRole.credentialing_specialist, 'enrollments:write')).toBe(false);
    expect(hasPermission(UserRole.credentialing_specialist, 'payers:read')).toBe(true);
    expect(hasPermission(UserRole.credentialing_specialist, 'documents:delete')).toBe(false);
    expect(hasPermission(UserRole.credentialing_specialist, 'credentials:write')).toBe(true);
    expect(hasPermission(UserRole.credentialing_specialist, 'providers:read')).toBe(true);
    expect(hasPermission(UserRole.credentialing_specialist, 'jobs:manage')).toBe(false);
    expect(hasPermission(UserRole.credentialing_specialist, 'system:backup')).toBe(false);
  });

  it('should restrict viewer to read-only permissions across all resources', () => {
    expect(hasPermission(UserRole.viewer, 'providers:read')).toBe(true);
    expect(hasPermission(UserRole.viewer, 'credentials:read')).toBe(true);
    expect(hasPermission(UserRole.viewer, 'enrollments:read')).toBe(true);
    expect(hasPermission(UserRole.viewer, 'providers:write')).toBe(false);
    expect(hasPermission(UserRole.viewer, 'credentials:write')).toBe(false);
    expect(hasPermission(UserRole.viewer, 'documents:delete')).toBe(false);
    expect(hasPermission(UserRole.viewer, 'users:manage')).toBe(false);
  });

  it('should grant admin document deletion permission but deny to specialists', () => {
    expect(hasPermission(UserRole.admin, 'documents:delete')).toBe(true);
    expect(hasPermission(UserRole.enrollment_specialist, 'documents:delete')).toBe(false);
  });

  it('should verify hasRole check correctly', () => {
    expect(hasRole(UserRole.admin, [UserRole.super_admin, UserRole.admin])).toBe(true);
    expect(hasRole(UserRole.viewer, [UserRole.super_admin, UserRole.admin])).toBe(false);
  });
});

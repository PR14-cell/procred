import { UserRole } from '@prisma/client';

export type Permission =
  | 'users:manage'
  | 'system:settings'
  | 'providers:read'
  | 'providers:write'
  | 'credentials:read'
  | 'credentials:write'
  | 'enrollments:read'
  | 'enrollments:write'
  | 'payers:read'
  | 'payers:write'
  | 'documents:read'
  | 'documents:write'
  | 'tasks:read'
  | 'tasks:write'
  | 'notes:read'
  | 'notes:write'
  | 'audit:read'
  | 'reports:read'
  | 'reports:export';

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: [
    'users:manage',
    'system:settings',
    'providers:read',
    'providers:write',
    'credentials:read',
    'credentials:write',
    'enrollments:read',
    'enrollments:write',
    'payers:read',
    'payers:write',
    'documents:read',
    'documents:write',
    'tasks:read',
    'tasks:write',
    'notes:read',
    'notes:write',
    'audit:read',
    'reports:read',
    'reports:export',
  ],
  admin: [
    'users:manage',
    'providers:read',
    'providers:write',
    'credentials:read',
    'credentials:write',
    'enrollments:read',
    'enrollments:write',
    'payers:read',
    'payers:write',
    'documents:read',
    'documents:write',
    'tasks:read',
    'tasks:write',
    'notes:read',
    'notes:write',
    'audit:read',
    'reports:read',
    'reports:export',
  ],
  credentialing_specialist: [
    'providers:read',
    'providers:write',
    'credentials:read',
    'credentials:write',
    'documents:read',
    'documents:write',
    'tasks:read',
    'tasks:write',
    'notes:read',
    'notes:write',
    'reports:read',
    'reports:export',
  ],
  enrollment_specialist: [
    'providers:read',
    'credentials:read',
    'enrollments:read',
    'enrollments:write',
    'payers:read',
    'payers:write',
    'documents:read',
    'documents:write',
    'tasks:read',
    'tasks:write',
    'notes:read',
    'notes:write',
    'reports:read',
    'reports:export',
  ],
  viewer: [
    'providers:read',
    'credentials:read',
    'enrollments:read',
    'payers:read',
    'documents:read',
    'tasks:read',
    'notes:read',
    'reports:read',
  ],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes(permission);
}

export function hasRole(currentRole: UserRole, requiredRoles: UserRole[]): boolean {
  return requiredRoles.includes(currentRole);
}

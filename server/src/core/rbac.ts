export type Role = 'super_admin' | 'admin' | 'facility_manager' | 'resident' | 'guard';

/**
 * Permission matrix. Society-level roles are always evaluated together with the
 * session's society_id (tenant isolation is enforced separately in every query).
 */
const matrix: Record<string, Role[]> = {
  'platform:manage': ['super_admin'],

  'society:configure': ['admin'],
  'society:view': ['admin', 'facility_manager'],
  'structure:manage': ['admin', 'facility_manager'],
  'residents:manage': ['admin', 'facility_manager'],
  'guards:manage': ['admin', 'facility_manager'],
  'dashboard:view': ['admin', 'facility_manager'],
  'audit:view': ['admin'],

  'visitors:invite': ['resident'],
  'visitors:respond': ['resident'],
  'visitors:view_all': ['admin', 'facility_manager'],
  'gate:operate': ['guard'],

  'complaints:raise': ['resident'],
  'complaints:manage': ['admin', 'facility_manager'],

  'facilities:book': ['resident'],
  'facilities:manage': ['admin', 'facility_manager'],

  'announcements:read': ['resident', 'admin', 'facility_manager', 'guard'],
  'announcements:manage': ['admin', 'facility_manager'],
  'emergency:read': ['resident', 'admin', 'facility_manager', 'guard'],
  'emergency:manage': ['admin', 'facility_manager'],
};

export type Permission = keyof typeof matrix;

export function can(role: Role, permission: Permission): boolean {
  return matrix[permission]?.includes(role) ?? false;
}

export const ADMIN_ROLES: Role[] = ['admin', 'facility_manager'];

/** Which interface each role lands on after login. */
export const homeFor: Record<Role, string> = {
  super_admin: '/platform',
  admin: '/admin',
  facility_manager: '/admin',
  resident: '/app',
  guard: '/guard',
};

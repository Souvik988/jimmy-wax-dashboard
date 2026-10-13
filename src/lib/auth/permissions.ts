export const roles = ['admin', 'support', 'catalog', 'fulfillment', 'finance', 'designer'] as const;
export type Role = (typeof roles)[number];

export const permissions = [
  'orders:read', 'orders:fulfil', 'orders:cancel', 'customers:read', 'customers:write', 'customers:export',
  'reviews:moderate', 'catalog:read', 'catalog:write', 'inventory:read', 'inventory:write', 'media:read', 'media:write',
  'shipping:read', 'shipping:write', 'payments:read', 'refunds:write', 'audit:read', 'coupons:read', 'coupons:write',
  'analytics:read', 'experience:read', 'experience:write', 'experience:publish', 'settings:read', 'settings:write',
  'ops:read', 'ops:replay', 'team:manage', 'integrations:read', 'integrations:manage', 'flags:manage',
] as const;
export type Permission = (typeof permissions)[number];

export const rolePermissions: Readonly<Record<Role, readonly Permission[] | 'all'>> = {
  admin: 'all',
  support: ['orders:read', 'customers:read', 'customers:write', 'reviews:moderate', 'media:read', 'shipping:read'],
  catalog: ['catalog:read', 'catalog:write', 'inventory:read', 'media:read', 'media:write', 'experience:read'],
  fulfillment: ['orders:read', 'orders:fulfil', 'orders:cancel', 'inventory:read', 'inventory:write', 'customers:read', 'shipping:read', 'shipping:write', 'analytics:read'],
  finance: ['orders:read', 'payments:read', 'refunds:write', 'audit:read', 'coupons:read', 'analytics:read', 'shipping:read'],
  designer: ['catalog:read', 'media:read', 'media:write', 'experience:read', 'experience:write'],
};

export type SafeOperator = { userId: string; role: Role; permissions: Permission[]; mfa: boolean; aal: 'aal1' | 'aal2' };

export function isRole(value: string): value is Role { return (roles as readonly string[]).includes(value); }
export function isPermission(value: string): value is Permission { return (permissions as readonly string[]).includes(value); }
export function can(user: Pick<SafeOperator, 'permissions'>, permission: Permission): boolean { return user.permissions.includes(permission); }
export function canRole(role: Role, permission: Permission): boolean { const allowed = rolePermissions[role]; return allowed === 'all' || allowed.includes(permission); }

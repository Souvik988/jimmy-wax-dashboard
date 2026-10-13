import type { ReactNode } from 'react';

import { can, type Permission, type SafeOperator } from '@/lib/auth/permissions';

export function Can({ operator, permission, children, fallback = null }: { operator: SafeOperator | null; permission: Permission; children: ReactNode; fallback?: ReactNode }): ReactNode {
  return operator && can(operator, permission) ? children : fallback;
}

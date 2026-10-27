import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { ReturnsRefunds } from '@/features/shipping/returns-refunds';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Returns & refunds | Jimmy & Wax operator' };

export default async function ReturnsPage(): Promise<React.ReactNode> {
  const operator = await requirePermission('orders:read', '/shipping/returns');
  return <AppShell breadcrumbs={['Orders & Fulfilment', 'Shipping centre', 'Returns & refunds']}>
    <ReturnsRefunds
      canDecideReturns={can(operator, 'orders:fulfil')}
      canReceiveReturns={can(operator, 'orders:fulfil') && can(operator, 'inventory:write')}
      canViewRefunds={can(operator, 'payments:read')}
      canProcessRefunds={can(operator, 'refunds:write')}
      canViewReturnPolicy={can(operator, 'settings:read')}
    />
  </AppShell>;
}

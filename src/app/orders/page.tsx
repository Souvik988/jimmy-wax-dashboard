import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { OrdersReference } from '@/features/orders/orders-reference';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Orders | Jimmy & Wax operator' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }): Promise<React.ReactNode> {
  const operator = await requirePermission('orders:read', '/orders');
  const params = await searchParams;
  const rawStatus = typeof params.status === 'string' ? params.status : '';
  const rawQuery = typeof params.q === 'string' ? params.q.trim().slice(0, 40) : '';
  const validStatuses = new Set(['pending_payment', 'placed', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'expired', 'returned']);
  const initialFilters = {
    ...(validStatuses.has(rawStatus) ? { status: rawStatus } : {}),
    ...(rawQuery ? { q: rawQuery } : {}),
  };
  return <AppShell breadcrumbs={['Orders']}><OrdersReference initialFilters={initialFilters} operatorId={operator.userId} /></AppShell>;
}

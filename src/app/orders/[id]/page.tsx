import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { OrderDetail } from '@/features/orders/order-detail';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Order | Jimmy & Wax operator' };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactNode> {
  const operator = await requirePermission('orders:read', '/orders');
  const { id } = await params;
  return <AppShell breadcrumbs={['Orders', 'Order record']}><OrderDetail id={id} operator={operator} /></AppShell>;
}

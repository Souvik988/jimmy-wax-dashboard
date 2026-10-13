import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { PackingSlipView } from '@/features/orders/packing-slip';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Packing slip | Jimmy & Wax operator' };

export default async function PackingSlipPage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactNode> {
  await requirePermission('orders:fulfil', '/orders');
  const { id } = await params;
  return <AppShell breadcrumbs={['Orders', 'Packing slip']}><PackingSlipView id={id} /></AppShell>;
}

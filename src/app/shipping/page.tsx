import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { ShippingCenter } from '@/features/shipping/shipping-center';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Shipping centre | Jimmy & Wax operator' };

export default async function ShippingPage(): Promise<React.ReactNode> {
  const operator = await requirePermission('shipping:read', '/shipping');
  return <AppShell breadcrumbs={['Orders & Fulfilment', 'Shipping centre']}><ShippingCenter
    canFulfilOrders={can(operator, 'orders:fulfil')}
    canWriteShippingSettings={can(operator, 'shipping:write')}
    canWriteDeliveryAreas={can(operator, 'settings:write')}
  /></AppShell>;
}

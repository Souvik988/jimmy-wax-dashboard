import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { AppShell } from '@/components/layout/app-shell';
import { ShipmentCancel } from '@/features/shipping/shipment-cancel';
import { ShipmentDetail } from '@/features/shipping/shipment-detail';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Shipment tracking | Jimmy & Wax operator' };

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactNode> {
  const operator = await requirePermission('shipping:read', '/shipping/shipments');
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  return <AppShell breadcrumbs={['Orders & Fulfilment', 'Shipping centre', 'Shipment register', 'Tracking']}>
    <ShipmentDetail shipmentId={id} canFulfilOrders={can(operator, 'orders:fulfil')} />
    <ShipmentCancel shipmentId={id} canCancel={can(operator, 'shipping:write')} />
  </AppShell>;
}

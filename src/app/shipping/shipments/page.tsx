import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { ShipmentsList } from '@/features/shipping/shipments-list';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Shipments | Jimmy & Wax operator' };

export default async function ShipmentsPage(): Promise<React.ReactNode> {
  await requirePermission('shipping:read', '/shipping/shipments');
  return <AppShell breadcrumbs={['Orders & Fulfilment', 'Shipping centre', 'Shipment register']}><ShipmentsList /></AppShell>;
}

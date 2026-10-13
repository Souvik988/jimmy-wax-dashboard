import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { InventoryQueue } from '@/features/catalog/inventory-queue';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Inventory | Jimmy & Wax operator' };

export default async function InventoryPage(): Promise<React.ReactNode> {
  const operator = await requirePermission('inventory:read', '/inventory');
  return <AppShell breadcrumbs={['Catalogue', 'Inventory']}><InventoryQueue canAdjust={can(operator, 'inventory:write')} /></AppShell>;
}

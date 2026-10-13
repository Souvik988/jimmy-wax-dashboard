import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { CustomersPanel } from '@/features/people/people';
import { can } from '@/lib/auth/permissions';
 import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Customers | Jimmy & Wax operator' };

export default async function Page(): Promise<React.ReactNode> {
  const operator = await requirePermission('customers:read', '/customers');
  void operator;
  return <AppShell breadcrumbs={['Customers', 'All customers']}><CustomersPanel canWrite={can(operator, 'customers:write')} canExport={can(operator, 'customers:export')} /></AppShell>;
}

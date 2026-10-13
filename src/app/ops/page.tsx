import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { OpsPanel } from '@/features/insights/insights';
import { can } from '@/lib/auth/permissions';
 import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Operations | Jimmy & Wax operator' };

export default async function Page(): Promise<React.ReactNode> {
  const operator = await requirePermission('ops:read', '/ops');
  void operator;
  return <AppShell breadcrumbs={['Insights', 'Operations']}><OpsPanel canReplay={can(operator, 'ops:replay')} /></AppShell>;
}

import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { AnalyticsPanel } from '@/features/insights/insights';
 import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Analytics | Jimmy & Wax operator' };

export default async function Page(): Promise<React.ReactNode> {
  const operator = await requirePermission('analytics:read', '/analytics');
  void operator;
  return <AppShell breadcrumbs={['Insights', 'Analytics']}><AnalyticsPanel /></AppShell>;
}

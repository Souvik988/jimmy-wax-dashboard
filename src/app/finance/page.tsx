import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { FinancePanel } from '@/features/insights/insights';
 import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'GST and finance | Jimmy & Wax operator' };

export default async function Page(): Promise<React.ReactNode> {
  const operator = await requirePermission('analytics:read', '/finance');
  void operator;
  return <AppShell breadcrumbs={['Insights', 'GST & finance']}><FinancePanel /></AppShell>;
}

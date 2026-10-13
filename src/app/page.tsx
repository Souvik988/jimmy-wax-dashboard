import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { OverviewWorkspace } from '@/features/overview/overview';
import { requireOperator } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Overview | Jimmy & Wax Operator Console' };

export default async function OverviewPage(): Promise<React.ReactNode> {
  const operator = await requireOperator('/');
  return <AppShell breadcrumbs={['Overview']}><OverviewWorkspace operator={operator} /></AppShell>;
}

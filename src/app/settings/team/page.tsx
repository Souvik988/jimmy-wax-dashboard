import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { TeamPanel } from '@/features/platform/platform';
 import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Team | Jimmy & Wax operator' };

export default async function Page(): Promise<React.ReactNode> {
  const operator = await requirePermission('team:manage', '/settings/team');
  void operator;
  return <AppShell breadcrumbs={['Settings', 'Team']}><TeamPanel /></AppShell>;
}

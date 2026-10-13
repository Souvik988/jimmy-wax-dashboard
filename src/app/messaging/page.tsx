import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { MessagingPanel } from '@/features/marketing/marketing';
import { can } from '@/lib/auth/permissions';
 import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Message templates | Jimmy & Wax operator' };

export default async function Page(): Promise<React.ReactNode> {
  const operator = await requirePermission('settings:read', '/messaging');
  void operator;
  return <AppShell breadcrumbs={['Marketing', 'Message templates']}><MessagingPanel canWrite={can(operator, 'settings:write')} canOps={can(operator, 'ops:read')} /></AppShell>;
}

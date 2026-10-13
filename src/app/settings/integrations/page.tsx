import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { IntegrationsPanel } from '@/features/platform/platform';
import { can } from '@/lib/auth/permissions';
 import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Integrations | Jimmy & Wax operator' };

export default async function Page(): Promise<React.ReactNode> {
  const operator = await requirePermission('integrations:read', '/settings/integrations');
  void operator;
  return <AppShell breadcrumbs={['Settings', 'Integrations']}><IntegrationsPanel canManage={can(operator, 'integrations:manage')} /></AppShell>;
}

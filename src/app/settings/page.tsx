import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { SettingsPanel } from '@/features/platform/platform';
import { can } from '@/lib/auth/permissions';
 import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Store settings | Jimmy & Wax operator' };

export default async function Page(): Promise<React.ReactNode> {
  const operator = await requirePermission('settings:read', '/settings');
  void operator;
  return <AppShell breadcrumbs={['Settings', 'Store settings']}><SettingsPanel canWrite={can(operator, 'settings:write')} /></AppShell>;
}

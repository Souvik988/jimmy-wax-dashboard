import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { PlatformPanel } from '@/features/platform/platform';
import { can } from '@/lib/auth/permissions';
 import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Flags and versions | Jimmy & Wax operator' };

export default async function Page(): Promise<React.ReactNode> {
  const operator = await requirePermission('settings:read', '/settings/platform');
  void operator;
  return <AppShell breadcrumbs={['Settings', 'Flags & versions']}><PlatformPanel canFlags={can(operator, 'flags:manage')} canWrite={can(operator, 'settings:write')} /></AppShell>;
}

import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { ReleasesPanel } from '@/features/studio/releases-panel';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Releases | Jimmy & Wax operator' };

export default async function ReleasesPage(): Promise<React.ReactNode> {
  const operator = await requirePermission('experience:read', '/studio/releases');
  return <AppShell breadcrumbs={['Studio', 'Releases & publishing']}>
    <ReleasesPanel canPublish={can(operator, 'experience:publish')} isAdmin={operator.role === 'admin'} />
  </AppShell>;
}

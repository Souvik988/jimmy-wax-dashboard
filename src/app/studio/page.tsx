import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { StudioWorkspace } from '@/features/studio/studio-workspace';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Experience Studio | Jimmy & Wax operator' };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ channel?: string }> }): Promise<React.ReactNode> {
  const { channel } = await searchParams;
  const operator = await requirePermission('experience:read', '/studio');
  return <AppShell breadcrumbs={['Studio', 'Experience Studio']}>
    <StudioWorkspace channel={channel === 'web' ? 'web' : 'app'} canPublish={can(operator, 'experience:publish')} />
  </AppShell>;
}

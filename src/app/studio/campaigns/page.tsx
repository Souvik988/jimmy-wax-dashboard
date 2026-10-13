import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { CampaignsPanel } from '@/features/studio/campaigns-panel';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Campaigns | Jimmy & Wax operator' };

export default async function CampaignsPage(): Promise<React.ReactNode> {
  const operator = await requirePermission('experience:read', '/studio/campaigns');
  return <AppShell breadcrumbs={['Studio', 'Campaigns']}><CampaignsPanel canWrite={can(operator, 'experience:write')} /></AppShell>;
}

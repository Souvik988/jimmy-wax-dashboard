import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { MediaLibrary } from '@/features/media/media-library';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Media library | Jimmy & Wax operator' };

export default async function MediaPage(): Promise<React.ReactNode> {
  const operator = await requirePermission('media:read', '/media');
  return <AppShell breadcrumbs={['Catalogue', 'Media library']}>
    <MediaLibrary canWrite={can(operator, 'media:write')} canReview={operator.role === 'admin'} />
  </AppShell>;
}

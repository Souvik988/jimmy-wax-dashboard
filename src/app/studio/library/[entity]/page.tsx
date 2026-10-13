import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';
import { LibraryPanel } from '@/features/studio/library-panel';
import { libraryEntities, type LibraryEntity } from '@/lib/api/resources/studio';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Content library | Jimmy & Wax operator' };

export default async function LibraryPage({ params }: { params: Promise<{ entity: string }> }): Promise<React.ReactNode> {
  const { entity } = await params;
  if (!(libraryEntities as readonly string[]).includes(entity)) notFound();
  const operator = await requirePermission('experience:read', `/studio/library/${entity}`);
  return <AppShell breadcrumbs={['Studio', 'Content library']}><LibraryPanel entity={entity as LibraryEntity} canWrite={can(operator, 'experience:write')} /></AppShell>;
}

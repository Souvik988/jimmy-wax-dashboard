import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { CatalogTaxonomy } from '@/features/catalog/catalog-taxonomy';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Categories & collections | Jimmy & Wax operator' };

export default async function CataloguePage(): Promise<React.ReactNode> {
  const operator = await requirePermission('catalog:read', '/catalogue');
  return <AppShell breadcrumbs={['Catalogue', 'Categories & collections']}>
    <CatalogTaxonomy canWrite={can(operator, 'catalog:write')} />
  </AppShell>;
}

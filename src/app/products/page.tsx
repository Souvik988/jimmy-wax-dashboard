import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { ProductsQueue, type ProductInitialFilters } from '@/features/catalog/products-queue';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Products | Jimmy & Wax operator' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }): Promise<React.ReactNode> {
  const operator = await requirePermission('catalog:read', '/products');
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const rawStatus = value('status');
  const rawStock = value('stock');
  const q = value('q').trim().slice(0, 100);
  const rawCategory = value('categoryId');
  const initialFilters: ProductInitialFilters = {
    ...(q ? { q } : {}),
    ...( /^[a-z0-9-]{1,100}$/u.test(rawCategory) ? { categoryId: rawCategory } : {}),
    ...(['active', 'inactive', 'archived'].includes(rawStatus) ? { status: rawStatus as NonNullable<ProductInitialFilters['status']> } : {}),
    ...(['low', 'out'].includes(rawStock) ? { stock: rawStock as NonNullable<ProductInitialFilters['stock']> } : {}),
  };

  return <AppShell breadcrumbs={['Catalogue', 'Products']}><ProductsQueue initialFilters={initialFilters} canWrite={can(operator, 'catalog:write')} /></AppShell>;
}

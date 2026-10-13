import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { ProductCreate } from '@/features/catalog/product-create';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Create product | Jimmy & Wax operator' };

export default async function NewProductPage(): Promise<React.ReactNode> {
  const operator = await requirePermission('catalog:write', '/products/new');
  return <AppShell breadcrumbs={['Catalogue', 'Products', 'Create product']}>
    <ProductCreate canWrite={can(operator, 'catalog:write')} canViewCost={operator.role === 'admin'} />
  </AppShell>;
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';
import { ProductEditor } from '@/features/catalog/product-editor';
import { ProductExtras } from '@/features/catalog/product-extras';
import { VariantDetailsEditor } from '@/features/catalog/variant-details-editor';
import { can, type SafeOperator } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Product record | Jimmy & Wax operator' };

const productIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export default async function ProductRecordPage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactNode> {
  const { id } = await params;
  if (id.length > 100 || !productIdPattern.test(id)) notFound();
  const operator: SafeOperator = await requirePermission('catalog:read', `/products/${id}`);

  return <AppShell breadcrumbs={['Catalogue', 'Products', 'Product record']}>
    <ProductEditor id={id} operatorId={operator.userId} canWrite={can(operator, 'catalog:write')} canViewCost={operator.role === 'admin'} />
    <VariantDetailsEditor productId={id} canWrite={can(operator, 'catalog:write')} canEditCost={operator.role === 'admin'} />
    <ProductExtras id={id} canWrite={can(operator, 'catalog:write')} />
  </AppShell>;
}

import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { PoliciesPanel } from '@/features/platform/policies';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Policy documents | Jimmy & Wax operator' };

export default async function PoliciesPage(): Promise<React.ReactNode> {
  const operator = await requirePermission('catalog:read', '/settings/policies');
  return <AppShell breadcrumbs={['Settings', 'Policy documents']}><PoliciesPanel canWrite={can(operator, 'catalog:write')} /></AppShell>;
}

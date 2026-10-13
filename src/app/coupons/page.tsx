import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { CouponsPanel } from '@/features/marketing/marketing';
import { can } from '@/lib/auth/permissions';
 import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Coupons | Jimmy & Wax operator' };

export default async function Page(): Promise<React.ReactNode> {
  const operator = await requirePermission('coupons:read', '/coupons');
  void operator;
  return <AppShell breadcrumbs={['Marketing', 'Coupons']}><CouponsPanel canWrite={can(operator, 'coupons:write')} /></AppShell>;
}

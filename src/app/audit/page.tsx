import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { AuditPanel } from '@/features/insights/insights';
 import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Audit log | Jimmy & Wax operator' };

export default async function Page(): Promise<React.ReactNode> {
  const operator = await requirePermission('audit:read', '/audit');
  void operator;
  return <AppShell breadcrumbs={['Insights', 'Audit log']}><AuditPanel /></AppShell>;
}

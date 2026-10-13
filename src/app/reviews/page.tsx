import type { Metadata } from 'next';

import { AppShell } from '@/components/layout/app-shell';
import { ReviewsPanel } from '@/features/people/people';
 import { requirePermission } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Reviews | Jimmy & Wax operator' };

export default async function Page(): Promise<React.ReactNode> {
  const operator = await requirePermission('reviews:moderate', '/reviews');
  void operator;
  return <AppShell breadcrumbs={['Customers', 'Reviews']}><ReviewsPanel /></AppShell>;
}

import type { Metadata } from 'next';

import { AccountSecurity } from '@/components/auth/account-security';
import { AppShell } from '@/components/layout/app-shell';
import { requireOperator } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Account security | Jimmy & Wax' };

export default async function AccountSecurityPage(): Promise<React.ReactNode> {
  const operator = await requireOperator('/account/security');
  return <AppShell breadcrumbs={['Account', 'Security']}><AccountSecurity initialOperator={operator} /></AppShell>;
}

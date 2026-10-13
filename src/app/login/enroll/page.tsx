import type { Metadata } from 'next';

import { MfaEnrollment } from '@/components/auth/mfa-enrollment';
import { isSafeNextPath } from '@/lib/auth/navigation';

export const metadata: Metadata = { title: 'Set up authenticator | Jimmy & Wax', referrer: 'no-referrer' };

export default async function EnrollPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }): Promise<React.ReactNode> {
  const params = await searchParams;
  const requestedNext = typeof params.next === 'string' ? params.next : null;
  const nextPath = isSafeNextPath(requestedNext) ? requestedNext : '/';
  return <main className="auth-page"><MfaEnrollment nextPath={nextPath} /></main>;
}

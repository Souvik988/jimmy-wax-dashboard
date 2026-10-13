'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { kit } from '@/components/kit/kit';
import { ErrorState } from '@/components/ui/feedback';

/** Route-level boundary: a failing page never leaks internals and always offers retry and a way home. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): React.ReactNode {
  useEffect(() => { console.error('Route error', error.digest ?? ''); }, [error]);
  return <main className={kit.page}>
    <ErrorState title="This page hit an unexpected problem" {...(error.digest ? { requestId: error.digest } : {})} actionLabel="Try again" onAction={reset}>
      Nothing was changed by this error. Try again, or return to the overview. If it keeps happening, share the reference below with an administrator.
    </ErrorState>
    <p><Link href="/">Return to overview</Link></p>
  </main>;
}

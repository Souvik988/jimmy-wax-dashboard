'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import { ErrorState, NotAllowedState, OfflineState, Skeleton } from '@/components/ui/feedback';
import { ApiError } from '@/lib/api/errors';

import styles from './kit.module.css';

export { styles as kit };

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow: string; title: string; children?: ReactNode; actions?: ReactNode }): ReactNode {
  return <header className={styles.header}>
    <div>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1>{title}</h1>
      {children ? <p>{children}</p> : null}
    </div>
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </header>;
}

export function problemOf(error: unknown): { message: string; requestId?: string; offline: boolean; forbidden: boolean; mfa: boolean; conflict: boolean } {
  if (error instanceof ApiError) return {
    message: error.message,
    ...(error.requestId ? { requestId: error.requestId } : {}),
    offline: error.status === 0 || error.status >= 500 || error.code === 'UNAVAILABLE',
    forbidden: error.status === 403 && error.code === 'FORBIDDEN',
    mfa: error.code === 'MFA_REQUIRED',
    conflict: error.status === 409 || error.status === 412 || error.code === 'ETAG_MISMATCH' || error.code === 'CONFLICT',
  };
  return { message: 'The response could not be verified. Nothing was changed.', offline: false, forbidden: false, mfa: false, conflict: false };
}

/** Standard loading / error / offline / forbidden rendering; children render only when data is present. */
export function Loadable({ query, noun, children }: {
  query: { isLoading: boolean; error: unknown; data: unknown; refetch: () => unknown };
  noun: string;
  children: ReactNode;
}): ReactNode {
  if (query.isLoading) return <div aria-label={`Loading ${noun}`}><Skeleton lines={5} /></div>;
  if (query.error && !query.data) {
    const problem = problemOf(query.error);
    const requestId = problem.requestId ? { requestId: problem.requestId } : {};
    if (problem.forbidden) return <NotAllowedState title={`${noun} are not available for this role`} {...requestId}>{problem.message}</NotAllowedState>;
    if (problem.offline) return <OfflineState title={`${noun} are unavailable`} {...requestId} actionLabel="Try again" onAction={() => void query.refetch()}>{problem.message}</OfflineState>;
    return <ErrorState title={`${noun} could not be loaded`} {...requestId} actionLabel="Retry" onAction={() => void query.refetch()}>{problem.message}</ErrorState>;
  }
  return <>{query.error ? <p className={`${styles.notice} ${styles.danger}`} role="alert">Refresh failed; showing the last loaded data, which may be out of date. {problemOf(query.error).requestId ? `Request ID: ${problemOf(query.error).requestId}` : ''}</p> : null}{children}</>;
}

/** Inline status line for mutation results. Announced politely; errors assertively. */
export function useNotice(): { element: ReactNode; success: (message: string) => void; failure: (error: unknown) => void; clear: () => void } {
  const [state, setState] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);
  const success = useCallback((message: string) => setState({ tone: 'ok', message }), []);
  const failure = useCallback((error: unknown) => {
    const problem = problemOf(error);
    const id = problem.requestId ? ` (request ${problem.requestId})` : '';
    const fields = error instanceof ApiError && error.fields ? ` ${Object.entries(error.fields).map(([key, value]) => `${key}: ${value}`).join('; ')}` : '';
    setState({ tone: 'error', message: problem.mfa ? 'Verify your identity with your authenticator code, then retry.' : `${problem.message}${fields}${id}` });
  }, []);
  const clear = useCallback(() => setState(null), []);
  const element = state
    ? <p className={`${styles.notice} ${state.tone === 'ok' ? styles.ok : styles.danger}`} role={state.tone === 'ok' ? 'status' : 'alert'}>{state.message}</p>
    : null;
  return { element, success, failure, clear };
}

export function labelOf(value: string): string {
  return value.split(/[_.-]/u).filter(Boolean).map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`).join(' ');
}

export function toneOf(value: string): 'positive' | 'negative' | 'warning' | 'info' {
  if (['live', 'active', 'approved', 'sent', 'ok', 'delivered', 'published', 'resolved', 'completed', 'succeeded', 'healthy'].includes(value)) return 'positive';
  if (['failed', 'dead', 'rejected', 'error', 'blocked', 'killed', 'disabled', 'archived', 'cancelled', 'expired'].includes(value)) return 'negative';
  if (['scheduled', 'pending', 'draft', 'warning', 'queued', 'superseded'].includes(value)) return 'warning';
  return 'info';
}

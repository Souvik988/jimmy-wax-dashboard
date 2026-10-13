'use client';

import { AlertCircle, CheckCircle2, CircleOff, FileQuestion, Info, ShieldAlert, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn, Button } from './core';

export function Card({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string | undefined }): ReactNode {
  return <section className={cn('ui-card', className)}>{title ? <header className="ui-card__header"><h2>{title}</h2>{action}</header> : null}{children}</section>;
}

export function StatCard({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail?: string; tone?: 'neutral' | 'positive' | 'negative' }): ReactNode {
  return <article className={cn('ui-stat', `ui-stat--${tone}`)}><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</article>;
}

export function Skeleton({ lines = 3 }: { lines?: number }): ReactNode { return <div className="ui-skeleton" aria-label="Loading content" role="status">{Array.from({ length: lines }, (_, index) => <i className="ui-skeleton__line" key={index} />)}</div>; }

type StateProps = { title: string; children: ReactNode; actionLabel?: string; onAction?: () => void; requestId?: string | undefined };
function State({ icon, title, children, actionLabel, onAction, requestId, tone = 'neutral' }: StateProps & { icon: ReactNode; tone?: 'neutral' | 'danger' | 'warning' }): ReactNode {
  return <section className={cn('ui-state', `ui-state--${tone}`)}><div className="ui-state__icon" aria-hidden="true">{icon}</div><div><h2>{title}</h2><p>{children}</p>{requestId ? <code>Request ID: {requestId}</code> : null}{actionLabel && onAction ? <div><Button variant={tone === 'danger' ? 'danger' : 'secondary'} onClick={onAction}>{actionLabel}</Button></div> : null}</div></section>;
}
export function EmptyState(props: StateProps): ReactNode { return <State {...props} icon={<CircleOff size={22} />} />; }
export function ErrorState(props: StateProps): ReactNode { return <State {...props} icon={<AlertCircle size={22} />} tone="danger" />; }
export function OfflineState(props: StateProps): ReactNode { return <State {...props} icon={<WifiOff size={22} />} tone="warning" />; }
export function NotAllowedState({ title = 'You do not have access to this area', children = 'Ask an administrator if you think this is unexpected.', ...props }: Partial<StateProps>): ReactNode { return <State title={title} {...props} icon={<ShieldAlert size={22} />} tone="warning">{children}</State>; }
export function NotReadyState({ title = 'This workspace is not ready yet', children = 'It will appear here when its verified workflow is complete.' }: Partial<StateProps>): ReactNode { return <State title={title} icon={<FileQuestion size={22} />}>{children}</State>; }
export function InfoState(props: StateProps): ReactNode { return <State {...props} icon={<Info size={22} />} />; }

export function JsonViewer({ value, redactedKeys = [] }: { value: unknown; redactedKeys?: string[] }): ReactNode {
  const safe = JSON.stringify(value, (key, item: unknown) => redactedKeys.includes(key) ? '[REDACTED]' : item, 2);
  return <pre className="ui-json">{safe ?? 'null'}</pre>;
}

export function Pagination({ nextCursor, onNext, onPrevious, hasPrevious = false }: { nextCursor: string | null; onNext: () => void; onPrevious: () => void; hasPrevious?: boolean }): ReactNode {
  return <nav className="ui-pagination" aria-label="Pagination"><Button variant="secondary" onClick={onPrevious} disabled={!hasPrevious}>Previous</Button><span>{nextCursor ? 'More results available' : 'End of results'}</span><Button variant="secondary" onClick={onNext} disabled={!nextCursor}>Next</Button></nav>;
}

export function FilterBar({ children }: { children: ReactNode }): ReactNode { return <div className="ui-filter-bar" aria-label="Filters">{children}</div>; }

export function ToastRegion({ toasts, onDismiss }: { toasts: Array<{ id: string; title: string; detail?: string; tone?: 'success' | 'error' | 'info'; action?: { label: string; onClick: () => void } }>; onDismiss: (id: string) => void }): ReactNode {
  return <div className="ui-toast-region" aria-live="polite" aria-label="Notifications">{toasts.slice(0, 3).map((toast) => <section className={cn('ui-toast', `ui-toast--${toast.tone ?? 'info'}`)} key={toast.id}><CheckCircle2 size={18} aria-hidden="true" /><div><strong>{toast.title}</strong>{toast.detail ? <span>{toast.detail}</span> : null}</div>{toast.action ? <button type="button" onClick={toast.action.onClick}>{toast.action.label}</button> : null}<button type="button" className="ui-toast__close" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>×</button></section>)}</div>;
}

'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, CheckCircle2, CircleAlert, Clock3, Gauge, LoaderCircle, PackageSearch, PauseCircle, PlayCircle, RefreshCw, ShieldCheck, ToggleLeft, TriangleAlert, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button, StatusPill } from '@/components/ui/core';
import { Card, EmptyState, ErrorState, NotAllowedState, OfflineState, Skeleton, StatCard } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { queryKeys, resourceInvalidation } from '@/lib/api/query-keys';
import { activateCheckout, disableCheckout, getAudit, getDashboard, getHealth, getIntegrations, getSales, getSettings, getStoreStatus, setStoreStatus, type DashboardSnapshot, type HealthSnapshot, type SettingsSnapshot, type StoreStatus } from '@/lib/api/resources/overview';
import { can, type SafeOperator } from '@/lib/auth/permissions';
import { formatMoney } from '@/lib/format/money';
import { formatIst, formatRelativeIst } from '@/lib/format/time';

import styles from './overview.module.css';

type Operation = 'pause' | 'resume' | 'activate' | 'disable' | null;

function requestId(error: unknown): string | undefined { return error instanceof ApiError ? error.requestId : undefined; }
function isOffline(error: unknown): boolean { return error instanceof ApiError && (error.status === 0 || error.code === 'UNAVAILABLE' || error.status >= 500); }
function isDenied(error: unknown): boolean { return error instanceof ApiError && error.status === 403 && error.code !== 'MFA_REQUIRED'; }
function readinessFailureDetails(error: ApiError): string[] {
  if (error.code !== 'POLICY_NOT_CONFIGURED') return [];
  return (error.lines ?? []).flatMap((line) => {
    if (typeof line !== 'object' || line === null || !('detail' in line)) return [];
    const detail = (line as { detail?: unknown }).detail;
    return typeof detail === 'string' ? [detail] : [];
  });
}

function QueryFailure({ error, retry }: { error: unknown; retry: () => void }): React.ReactNode {
  if (isDenied(error)) return <NotAllowedState title="Not available for your role">The backend did not grant this overview widget.</NotAllowedState>;
  const identifier = requestId(error);
  const request = identifier ? { requestId: identifier } : {};
  if (isOffline(error)) return <OfflineState title="This service is unavailable" {...request} actionLabel="Try again" onAction={retry}>Other overview cards can still be used.</OfflineState>;
  return <ErrorState title="This card could not load" {...request} actionLabel="Try again" onAction={retry}>The service returned an unexpected response. No replacement data is shown.</ErrorState>;
}

function metricTone(value: number): 'neutral' | 'positive' | 'negative' { return value > 0 ? 'negative' : 'positive'; }

function DashboardCards({ data }: { data: DashboardSnapshot }): React.ReactNode {
  const orders = data.ordersByStatus.reduce((total, item) => total + item.count, 0);
  const revenue = data.ordersByStatus.reduce((total, item) => total + item.totalPaise, 0);
  const fulfilment = data.ordersByStatus.filter((item) => ['placed', 'confirmed', 'processing'].includes(item.status)).reduce((total, item) => total + item.count, 0);
  return <div className={styles.metrics}>
    <StatCard label="Orders in the window" value={String(orders)} detail={data.definitions.window} />
    <StatCard label="Order total in the window" value={formatMoney(revenue)} detail={data.definitions.ordersByStatus} />
    <StatCard label="To fulfil" value={String(fulfilment)} detail="Placed, confirmed or processing" tone={fulfilment ? 'negative' : 'positive'} />
    <StatCard label="Low-stock variants" value={String(data.lowStockVariants)} detail="At or below its configured threshold" tone={metricTone(data.lowStockVariants)} />
    <StatCard label="Payment exceptions" value={String(data.paymentExceptions)} detail="Current payment status" tone={metricTone(data.paymentExceptions)} />
    <StatCard label="Open refunds" value={String(data.refundsOpen)} detail="Requested or pending" tone={metricTone(data.refundsOpen)} />
  </div>;
}

function SalesPanel(): React.ReactNode {
  const sales = useQuery({ queryKey: queryKeys.sales, queryFn: getSales, staleTime: 60_000, retry: 2 });
  if (sales.isPending) return <Card title="Sales pulse"><Skeleton lines={5} /></Card>;
  if (sales.isError) return <Card title="Sales pulse"><QueryFailure error={sales.error} retry={() => void sales.refetch()} /></Card>;
  const highest = Math.max(...sales.data.series.map((point) => point.revenuePaise), 1);
  return <Card title="Sales pulse" action={<StatusPill tone="info">Server-defined</StatusPill>}>
    <p className={styles.cardDefinition}>{sales.data.definitions.sales}</p>
    <div className={styles.salesTotals}>
      <div><span>Revenue</span><strong>{formatMoney(sales.data.totals.revenuePaise)}</strong></div>
      <div><span>Orders</span><strong>{sales.data.totals.orders}</strong></div>
      <div><span>AOV</span><strong>{formatMoney(sales.data.totals.aovPaise)}</strong></div>
    </div>
    {sales.data.series.length ? <div className={styles.sparkline} aria-label={`Revenue by day from ${formatIst(sales.data.range.from, { dateStyle: 'medium' })} to ${formatIst(sales.data.range.to, { dateStyle: 'medium' })}`} role="img">
      {sales.data.series.map((point) => <i key={point.bucket} title={`${point.bucket}: ${formatMoney(point.revenuePaise)}`} style={{ height: `${Math.max(5, Math.round((point.revenuePaise / highest) * 100))}%` }} />)}
    </div> : <EmptyState title="No sales in this range">The server returned no sold orders for this period.</EmptyState>}
    <small className={styles.cardFootnote}>Range: {formatIst(sales.data.range.from, { dateStyle: 'medium' })} – {formatIst(sales.data.range.to, { dateStyle: 'medium' })} · {sales.data.definitions.aov}</small>
  </Card>;
}

function HealthPanel(): React.ReactNode {
  const health = useQuery({ queryKey: queryKeys.health, queryFn: getHealth, staleTime: 30_000, retry: 2 });
  if (health.isPending) return <Card title="System health"><Skeleton lines={6} /></Card>;
  if (health.isError) return <Card title="System health"><QueryFailure error={health.error} retry={() => void health.refetch()} /></Card>;
  const rows = [
    ['Outbox pending', health.data.outbox.pending], ['Dead-lettered events', health.data.outbox.dead],
    ['Email failures', health.data.email.failed], ['Unprocessed shipping events', health.data.shippingEvents.unprocessed],
    ['Stuck shipment requests', health.data.stuckShipmentRequests], ['Active bulk jobs', health.data.bulkJobs.active],
  ] as const;
  return <Card title="System health" action={<StatusPill tone={health.data.alerts.length ? 'warning' : 'positive'}>{health.data.alerts.length ? 'Needs attention' : 'No alerts'}</StatusPill>}>
    <dl className={styles.healthList}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {health.data.alerts.length ? <ul className={styles.alertList}>{health.data.alerts.map((alert) => <li key={alert}><TriangleAlert size={15} aria-hidden="true" />{alert}</li>)}</ul> : <p className={styles.goodState}><CheckCircle2 size={17} aria-hidden="true" />No derived operational alerts from the health service.</p>}
  </Card>;
}

function IntegrationPanel(): React.ReactNode {
  const integrations = useQuery({ queryKey: queryKeys.integrations, queryFn: getIntegrations, staleTime: 60_000, retry: 2 });
  if (integrations.isPending) return <Card title="Integrations"><Skeleton lines={5} /></Card>;
  if (integrations.isError) return <Card title="Integrations"><QueryFailure error={integrations.error} retry={() => void integrations.refetch()} /></Card>;
  return <Card title="Integrations" action={<span className={styles.capabilityNote}>Status only</span>}>
    <ul className={styles.integrationList}>{integrations.data.items.map((item) => <li key={item.name}>
      <div><strong>{item.name}</strong><span>{item.configured ? 'Configured' : 'Not configured'}{item.lastCheck ? ` · last checked ${formatRelativeIst(item.lastCheck.at)}` : ' · no safe live probe recorded'}</span></div>
      <StatusPill tone={item.configured ? 'info' : 'warning'}>{item.configured ? 'Configured' : 'Unavailable'}</StatusPill>
    </li>)}</ul>
    <p className={styles.cardFootnote}>Configured does not mean proven working. This screen never runs a live provider test.</p>
  </Card>;
}

function AuditPanel(): React.ReactNode {
  const audit = useQuery({ queryKey: queryKeys.audit, queryFn: getAudit, staleTime: 60_000, retry: 2 });
  if (audit.isPending) return <Card title="Recent audited activity"><Skeleton lines={5} /></Card>;
  if (audit.isError) return <Card title="Recent audited activity"><QueryFailure error={audit.error} retry={() => void audit.refetch()} /></Card>;
  if (!audit.data.items.length) return <Card title="Recent audited activity"><EmptyState title="No audit events yet">The backend has not returned an audit event for this local store.</EmptyState></Card>;
  return <Card title="Recent audited activity"><ol className={styles.auditList}>{audit.data.items.slice(0, 6).map((item) => <li key={item.id}>
    <span className={styles.auditMark}><Clock3 size={15} aria-hidden="true" /></span><div><strong>{item.action.replaceAll('.', ' ')}</strong><span>{item.actorRole} · {item.resourceType} · {formatRelativeIst(item.createdAt)}</span>{item.reason ? <small>Reason: {item.reason}</small> : null}</div>
  </li>)}</ol><p className={styles.cardFootnote}>Raw before/after values are intentionally not shown here.</p></Card>;
}

function StoreControlDialog({ operation, status, settings, pending, error, onClose, onSubmit }: { operation: Exclude<Operation, null>; status: StoreStatus; settings: SettingsSnapshot; pending: boolean; error: ApiError | null; onClose: () => void; onSubmit: (input: { pauseMessage?: string; reason?: string }) => void }): React.ReactNode {
  const [pauseMessage, setPauseMessage] = useState(status.pauseMessage);
  const [reason, setReason] = useState('');
  const [phrase, setPhrase] = useState('');
  const activation = operation === 'activate'; const disable = operation === 'disable';
  const needsReason = activation || disable; const neededPhrase = activation ? 'ACTIVATE' : disable ? 'DISABLE CHECKOUT' : null;
  const valid = (!needsReason || [...reason.trim()].length >= 3) && (!neededPhrase || phrase === neededPhrase);
  const title = operation === 'pause' ? 'Pause new orders' : operation === 'resume' ? 'Resume new orders' : activation ? 'Activate checkout' : 'Disable checkout';
  const action = operation === 'pause' ? 'Pause new orders' : operation === 'resume' ? 'Resume new orders' : activation ? 'Activate checkout' : 'Disable checkout';
  const failureDetails = error ? readinessFailureDetails(error) : [];
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }} title={title} footer={<><Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button><Button variant={disable ? 'danger' : 'primary'} loading={pending} disabled={!valid} onClick={() => onSubmit({ ...(operation === 'pause' ? { pauseMessage } : {}), ...(needsReason ? { reason: reason.trim() } : {}) })}>{action}</Button></>}>
    <div className={styles.dialogCopy}>
      {operation === 'pause' ? <><p>Customers will not be able to place new orders until an operator resumes orders. Existing fulfilment work continues.</p><label className="ui-field"><span className="ui-field__label">Customer-facing pause message <small>(optional)</small></span><textarea className="ui-input ui-textarea" value={pauseMessage} maxLength={300} onChange={(event) => setPauseMessage(event.target.value)} /><span className="ui-field__description">{[...pauseMessage].length}/300 characters</span></label></> : null}
      {operation === 'resume' ? <p>Customers can place new orders again. This is immediate and does not restore checkout if it is separately disabled.</p> : null}
      {activation ? <><p>Checkout will turn on only if every backend readiness check still passes. The backend requires MFA and records this activation.</p><ReadinessSummary settings={settings} /><ReasonField value={reason} onChange={setReason} /><PhraseField phrase="ACTIVATE" value={phrase} onChange={setPhrase} /></> : null}
      {disable ? <><p>Customers will be unable to begin checkout immediately. Existing orders are not cancelled. This kill switch is deliberately not MFA-gated, so review carefully.</p><ReasonField value={reason} onChange={setReason} /><PhraseField phrase="DISABLE CHECKOUT" value={phrase} onChange={setPhrase} /></> : null}
      {error ? <div className={styles.actionError} role="alert"><p>{error.message}{error.requestId ? ` · Request ${error.requestId}` : ''}</p>{failureDetails.length ? <ul><li>Checkout remains off until the backend-reported prerequisite is corrected:</li>{failureDetails.map((detail) => <li key={detail}>{detail}</li>)}</ul> : null}</div> : null}
    </div>
  </Dialog>;
}

function ReasonField({ value, onChange }: { value: string; onChange: (value: string) => void }): React.ReactNode { return <label className="ui-field"><span className="ui-field__label">Reason</span><textarea className="ui-input ui-textarea" value={value} minLength={3} maxLength={300} onChange={(event) => onChange(event.target.value)} /><span className="ui-field__description">{[...value].length}/300 characters · recorded by the backend</span></label>; }
function PhraseField({ phrase, value, onChange }: { phrase: string; value: string; onChange: (value: string) => void }): React.ReactNode { return <label className="ui-field"><span className="ui-field__label">Type <code>{phrase}</code> to continue</span><input className="ui-input" value={value} autoComplete="off" onChange={(event) => onChange(event.target.value)} /></label>; }
function ReadinessSummary({ settings }: { settings: SettingsSnapshot }): React.ReactNode { return <ul className={styles.readinessList}>{settings.readiness.checks.map((check) => <li key={check.id}><span aria-hidden="true">{check.ok ? '✓' : '!'}</span>{check.detail}</li>)}</ul>; }

function StorePanel(): React.ReactNode {
  const queryClient = useQueryClient();
  const [operation, setOperation] = useState<Operation>(null); const [error, setError] = useState<ApiError | null>(null);
  const status = useQuery({ queryKey: queryKeys.storeStatus, queryFn: getStoreStatus, staleTime: 15_000, retry: 2 });
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: getSettings, staleTime: 30_000, retry: 2 });
  const mutation = useMutation({
    mutationFn: async (input: { operation: Exclude<Operation, null>; pauseMessage?: string; reason?: string }) => {
      if (input.operation === 'pause') return setStoreStatus({ ordersPaused: true, pauseMessage: input.pauseMessage ?? '' });
      if (input.operation === 'resume') return setStoreStatus({ ordersPaused: false, pauseMessage: '' });
      if (input.operation === 'disable') return disableCheckout(input.reason ?? '');
      if (!settings.data) throw new ApiError(409, 'CART_VERSION_CONFLICT', 'Checkout readiness changed. Refresh before trying again.');
      return activateCheckout({ reason: input.reason ?? '', expectedVersion: settings.data.settings.version });
    },
    onSuccess: async (result) => {
      await Promise.all(resourceInvalidation.settings.map((key) => queryClient.invalidateQueries({ queryKey: key })));
      if (result && typeof result === 'object' && 'ordersPaused' in result) window.dispatchEvent(new CustomEvent('jw:store-status-updated', { detail: result }));
      else window.dispatchEvent(new Event('jw:store-status-updated'));
      setOperation(null); setError(null);
    },
    onError: (next) => setError(next instanceof ApiError ? next : new ApiError(0, 'UNAVAILABLE', 'The store-control request did not complete. Check the current status before trying again.')),
  });
  if (status.isPending || settings.isPending) return <Card title="Store controls"><Skeleton lines={7} /></Card>;
  if (status.isError) return <Card title="Store controls"><QueryFailure error={status.error} retry={() => void status.refetch()} /></Card>;
  if (settings.isError) return <Card title="Store controls"><QueryFailure error={settings.error} retry={() => void settings.refetch()} /></Card>;
  const open = status.data.checkoutOpen; const paused = status.data.ordersPaused;
  return <Card title="Store controls" action={<StatusPill tone={paused ? 'warning' : open ? 'positive' : 'info'}>{paused ? 'Orders paused' : open ? 'Checkout open' : 'Checkout off'}</StatusPill>}>
    <div className={styles.storeStates}><div><span>New orders</span><strong>{paused ? 'Paused' : 'Accepting orders'}</strong><small>{paused ? status.data.pauseMessage || 'No customer message set.' : 'Pause affects new checkout only.'}</small></div><div><span>Checkout</span><strong>{open ? 'Open' : 'Safety locked'}</strong><small>{settings.data.readiness.allOk ? 'Readiness checks pass.' : `${settings.data.readiness.checks.filter((check) => !check.ok).length} readiness checks need attention.`}</small></div></div>
    <div className={styles.storeActions}>
      <Button variant={paused ? 'primary' : 'secondary'} onClick={() => { setError(null); setOperation(paused ? 'resume' : 'pause'); }}><PauseCircle size={16} aria-hidden="true" />{paused ? 'Resume orders' : 'Pause orders'}</Button>
      {open ? <Button variant="danger" onClick={() => { setError(null); setOperation('disable'); }}><ToggleLeft size={16} aria-hidden="true" />Disable checkout</Button> : <Button onClick={() => { setError(null); setOperation('activate'); }} disabled={!settings.data.readiness.allOk}><PlayCircle size={16} aria-hidden="true" />Activate checkout</Button>}
    </div>
    {!settings.data.readiness.allOk ? <section className={styles.readinessBlock}><strong>Checkout readiness</strong><ReadinessSummary settings={settings.data} /></section> : null}
    <p className={styles.cardFootnote}>Pause/resume and disable are immediate safety controls. Activation requires a reason, current version and MFA.</p>
    {operation ? <StoreControlDialog operation={operation} status={status.data} settings={settings.data} pending={mutation.isPending} error={error} onClose={() => { if (!mutation.isPending) setOperation(null); }} onSubmit={(input) => mutation.mutate({ operation, ...input })} /> : null}
  </Card>;
}

function QueuePanel({ dashboard }: { dashboard: DashboardSnapshot }): React.ReactNode {
  const orderQueue = dashboard.ordersByStatus.filter((item) => ['placed', 'confirmed', 'processing'].includes(item.status));
  const queue = [
    ...orderQueue.map((item) => ({ label: item.status.replaceAll('_', ' '), count: item.count, href: `/orders?status=${encodeURIComponent(item.status)}` })),
    { label: 'Low-stock variants', count: dashboard.lowStockVariants, href: null }, { label: 'Payment exceptions', count: dashboard.paymentExceptions, href: null }, { label: 'Open refunds', count: dashboard.refundsOpen, href: null },
  ];
  return <Card title="Queues needing attention" action={<span className={styles.capabilityNote}>Only released workspaces link</span>}><ul className={styles.queueList}>{queue.map((item) => <li key={item.label}>{item.href ? <Link href={item.href}>{item.label}</Link> : <span>{item.label}</span>}<strong>{item.count}</strong></li>)}</ul><p className={styles.cardFootnote}>Shipping, refunds and inventory queues gain their operational screens in later verified phases.</p></Card>;
}

export function OverviewWorkspace({ operator }: { operator: SafeOperator }): React.ReactNode {
  const queryClient = useQueryClient();
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const dashboardAllowed = can(operator, 'orders:read'); const healthAllowed = can(operator, 'ops:read'); const salesAllowed = can(operator, 'analytics:read'); const settingsAllowed = can(operator, 'settings:read'); const integrationsAllowed = can(operator, 'integrations:read'); const auditAllowed = can(operator, 'audit:read');
  const dashboard = useQuery({ queryKey: queryKeys.dashboard, queryFn: getDashboard, enabled: dashboardAllowed, staleTime: 30_000, retry: 2 });
  const refresh = async () => {
    setUpdatedAt(new Date());
    await Promise.all([
      queryKeys.dashboard, queryKeys.sales, queryKeys.health, queryKeys.storeStatus,
      queryKeys.settings, queryKeys.integrations, queryKeys.audit,
    ].map((key) => queryClient.invalidateQueries({ queryKey: key })));
  };
  const greeting = useMemo(() => operator.role === 'admin' ? 'Store command centre' : 'Your operational view', [operator.role]);
  return <section className={styles.workspace}>
    <header className={styles.header}><div><p className="eyebrow">LIVE OPERATIONS · LOCAL BACKEND</p><h1>{greeting}</h1><p>Read the store as it is now. Every number comes from a verified backend response; unavailable systems stay visibly unavailable.</p></div><div className={styles.refreshGroup}><span aria-live="polite">Updated {formatRelativeIst(updatedAt)}</span><Button variant="secondary" onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />Refresh</Button></div></header>
    {dashboardAllowed ? (dashboard.isPending ? <div className={styles.metrics}><Skeleton lines={3} /><Skeleton lines={3} /><Skeleton lines={3} /></div> : dashboard.isError ? <QueryFailure error={dashboard.error} retry={() => void dashboard.refetch()} /> : <DashboardCards data={dashboard.data} />) : <NotAllowedState title="Your overview is queue-limited">Your role does not include the backend permission for store-wide order metrics.</NotAllowedState>}
    <div className={styles.primaryGrid}>{dashboard.data ? <QueuePanel dashboard={dashboard.data} /> : null}{salesAllowed ? <SalesPanel /> : <Card title="Sales pulse"><NotAllowedState title="Sales data is not available for your role">Analytics are restricted by the backend.</NotAllowedState></Card>}{settingsAllowed ? <StorePanel /> : <Card title="Store status"><NotAllowedState title="Store controls are restricted">This role cannot read or change store settings.</NotAllowedState></Card>}</div>
    <div className={styles.secondaryGrid}>{healthAllowed ? <HealthPanel /> : null}{integrationsAllowed ? <IntegrationPanel /> : null}{auditAllowed ? <AuditPanel /> : null}</div>
    {!healthAllowed && !integrationsAllowed && !auditAllowed ? <section className={styles.reducedNote}><Gauge size={18} aria-hidden="true" /><span>This reduced view hides health, provider and audit information your role is not permitted to read.</span></section> : null}
  </section>;
}

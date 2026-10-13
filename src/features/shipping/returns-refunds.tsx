'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight, ClipboardCheck, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Badge, Button, Select, Textarea } from '@/components/ui/core';
import { Card, EmptyState, ErrorState, NotAllowedState, OfflineState, Skeleton } from '@/components/ui/feedback';
import { ConfirmDialog, Dialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { decideReturn, getRefunds, getReturns, processRefund, type AdminReturn, type RefundBlockedReason, type RefundRecord, type ReturnPage, type ReturnStatus } from '@/lib/api/resources/shipping';
import { getSettings } from '@/lib/api/resources/overview';
import { formatMoney } from '@/lib/format/money';
import { formatIst } from '@/lib/format/time';

import styles from './returns-refunds.module.css';

type QueryProblem = { message: string; requestId?: string; offline: boolean; forbidden: boolean };
type Decision = { item: AdminReturn; approve: boolean };
type StatusFilter = ReturnStatus | 'all';

const statuses: StatusFilter[] = ['all', 'requested', 'approved', 'rejected', 'received', 'closed'];

function problemFor(error: unknown): QueryProblem {
  if (error instanceof ApiError) return {
    message: error.message,
    ...(error.requestId ? { requestId: error.requestId } : {}),
    offline: error.status === 0 || error.status >= 500 || error.code === 'UNAVAILABLE',
    forbidden: error.status === 403 && error.code === 'FORBIDDEN',
  };
  return { message: 'The backend response could not be verified. No sample records are shown.', offline: false, forbidden: false };
}

function statusLabel(value: string): string {
  return value.split('_').map((part) => part ? `${part[0]?.toUpperCase()}${part.slice(1)}` : part).join(' ');
}

function statusTone(status: ReturnStatus): 'neutral' | 'positive' | 'negative' | 'warning' | 'info' {
  if (status === 'approved') return 'positive';
  if (status === 'rejected') return 'negative';
  if (status === 'requested') return 'warning';
  if (status === 'received' || status === 'closed') return 'info';
  return 'neutral';
}

function QueryState({ problem, retry, title }: { problem: QueryProblem; retry: () => void; title: string }): ReactNode {
  const props = { title, ...(problem.requestId ? { requestId: problem.requestId } : {}), actionLabel: 'Retry', onAction: retry };
  if (problem.forbidden) return <NotAllowedState {...props}>{problem.message}</NotAllowedState>;
  if (problem.offline) return <OfflineState {...props}>{problem.message}</OfflineState>;
  return <ErrorState {...props}>{problem.message}</ErrorState>;
}

function ReturnCard({ item, canDecide, onDecision }: { item: AdminReturn; canDecide: boolean; onDecision: (item: AdminReturn, approve: boolean) => void }): ReactNode {
  return <article className={styles.returnCard}>
    <div className={styles.cardTop}>
      <div className={styles.returnIdentity}>
        <Link className={styles.orderLink} href={`/orders/${item.orderId}`} aria-label={`Open order ${item.orderNumber}`}>
          {item.orderNumber}<ArrowUpRight size={14} aria-hidden="true" />
        </Link>
        <span>Return ID · {item.id.slice(0, 8)}</span>
      </div>
      <div className={styles.statusBlock}>
        <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
        <time dateTime={item.createdAt}>{formatIst(item.createdAt, { dateStyle: 'medium', timeStyle: 'short' })} IST</time>
      </div>
    </div>

    <div className={styles.returnDetails}>
      <section aria-label="Customer return reason">
        <h3>Reason provided</h3>
        <p>{item.reason}</p>
      </section>
      <section aria-label="Requested return items">
        <h3>Items requested</h3>
        <ul className={styles.lines}>{item.items.map((line, index) => <li key={`${line.sku}-${index}`}>
          <span><strong>{line.name}</strong><small>SKU · {line.sku}</small></span>
          <span className={styles.quantity}>Qty {line.quantity}</span>
        </li>)}</ul>
      </section>
    </div>

    {item.status === 'approved' ? <p className={styles.safetyNotice}>
      Receipt is withheld. Receiving this return changes inventory, but the backend route does not enforce the required inventory permission and MFA step-up. No receive or restock action is available here.
    </p> : null}
    {canDecide && item.status === 'requested' ? <div className={styles.decisionActions}>
      <Button variant="secondary" onClick={() => onDecision(item, true)}>Approve return {item.orderNumber}</Button>
      <Button variant="danger" onClick={() => onDecision(item, false)}>Decline return {item.orderNumber}</Button>
    </div> : null}
  </article>;
}

function ReturnSection({ canDecide }: { canDecide: boolean }): ReactNode {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.shipping.returns(status === 'all' ? undefined : status),
    queryFn: ({ signal }) => getReturns(status === 'all' ? undefined : status, signal),
    retry: (count, error) => count < 1 && (error instanceof ApiError ? error.retryable || error.status === 0 : false),
  });
  const mutation = useMutation({
    mutationFn: (input: Decision & { note: string }) => decideReturn(input.item.id, { approve: input.approve, note: input.note }),
    retry: false,
    onSuccess: async (_, input) => {
      setNotice(`Return decision recorded for ${input.item.orderNumber}. The backend queues its customer notification; delivery is not confirmed here.`);
      setDecision(null);
      setNote('');
      await queryClient.invalidateQueries({ queryKey: ['shipping', 'returns'] });
    },
    onError: async (_, input) => {
      const activeKey = queryKeys.shipping.returns(status === 'all' ? undefined : status);
      await queryClient.invalidateQueries({ queryKey: ['shipping', 'returns'] });
      const latest = queryClient.getQueryData<ReturnPage>(activeKey);
      const refreshed = queryClient.getQueryState(activeKey)?.status === 'success';
      const remainsPending = latest?.items.some((item) => item.id === input.item.id && item.status === 'requested') ?? false;
      if (refreshed && !remainsPending) {
        setNotice(`The backend no longer lists ${input.item.orderNumber} as requested. Re-open its current status to review; no write was replayed.`);
        setDecision(null);
        setNote('');
      }
    },
  });
  const error = query.error ? problemFor(query.error) : undefined;
  const mutationError = mutation.error ? problemFor(mutation.error) : undefined;
  const canSubmit = note.trim().length >= 3 && note.trim().length <= 300;

  return <Card className={styles.panel!}>
    <div className={styles.sectionHeader}>
      <div><p className={styles.eyebrow}>Customer requests</p><h2>Returns</h2></div>
      <Select label="Return status" value={status} onChange={(event) => { setStatus(event.target.value as StatusFilter); setNotice(''); }}>
        {statuses.map((value) => <option key={value} value={value}>{value === 'all' ? 'All statuses' : statusLabel(value)}</option>)}
      </Select>
    </div>
    <p className={styles.capNotice}>The backend returns the most recent 100 records for this filter and does not provide a cursor. Older records may not appear.</p>
    {query.isLoading ? <div className={styles.loading}><Skeleton lines={5} /></div> : null}
    {error && !query.data ? <QueryState problem={error} retry={() => void query.refetch()} title={error.forbidden ? 'Returns are not available for this role' : error.offline ? 'Returns are unavailable' : 'Returns could not be loaded'} /> : null}
    {error && query.data ? <p className={styles.stale} role="alert">Refresh failed; showing the last verified list. {error.requestId ? `Request ID: ${error.requestId}` : ''}</p> : null}
    {!query.isLoading && !error && query.data?.items.length === 0 ? <EmptyState title="No return requests">The backend returned no matching return records.</EmptyState> : null}
    {query.data?.items.length ? <div className={styles.returnList} aria-label="Return records">
      {query.data.items.map((item) => <ReturnCard key={item.id} item={item} canDecide={canDecide} onDecision={(selected, approve) => { setNote(''); mutation.reset(); setDecision({ item: selected, approve }); }} />)}
    </div> : null}
    {notice ? <p className={styles.success} role="status"><ClipboardCheck size={16} aria-hidden="true" />{notice}</p> : null}

    <Dialog
      open={Boolean(decision)}
      onOpenChange={(open) => { if (!open && !mutation.isPending) { setDecision(null); setNote(''); mutation.reset(); } }}
      title={decision ? `${decision.approve ? 'Approve' : 'Decline'} return?` : 'Review return'}
      footer={<>
        <Button variant="secondary" disabled={mutation.isPending} onClick={() => { setDecision(null); setNote(''); mutation.reset(); }}>Cancel</Button>
        <Button variant={decision?.approve ? 'primary' : 'danger'} loading={mutation.isPending} disabled={!decision || !canSubmit} onClick={() => { if (decision && canSubmit) mutation.mutate({ ...decision, note: note.trim() }); }}>
          {decision?.approve ? 'Record approval' : 'Record decline'}
        </Button>
      </>}
    >
      {decision ? <div className={styles.dialogContent}>
        <p>{decision.approve
          ? 'Approval records the return decision and queues a customer notification. It does not receive or restock the item and does not process a refund.'
          : 'Declining records the decision and queues a customer notification. The return will not be received or restocked.'}</p>
        <Textarea label="Decision note" required minLength={3} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} description={`${note.trim().length}/300 characters · backend requires 3–300 characters.`} />
        {mutationError ? <div className={styles.mutationError} role="alert"><strong>{mutationError.message}</strong>{mutationError.requestId ? <code>Request ID: {mutationError.requestId}</code> : null}<span>{query.isError ? 'The latest return list could not be refreshed. This write will not be replayed; retry the read before deciding again.' : 'The return list was refreshed. Confirm current backend status before any new decision; no automatic write retry was made.'}</span></div> : null}
      </div> : null}
    </Dialog>
  </Card>;
}

const blockedLabels: Record<RefundBlockedReason, string> = {
  already_processed: 'Already processed',
  no_gateway: 'No payment gateway is connected',
  no_online_payment: 'Not an online payment: pay this one manually',
};

function RefundSection({ canProcess }: { canProcess: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.shipping.refunds,
    queryFn: ({ signal }) => getRefunds(signal),
    retry: (count, error) => count < 1 && (error instanceof ApiError ? error.retryable || error.status === 0 : false),
  });
  const error = query.error ? problemFor(query.error) : undefined;
  const [target, setTarget] = useState<RefundRecord | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'problem'; text: string } | null>(null);
  const process = useMutation({
    mutationFn: (refund: RefundRecord) => processRefund(refund.id),
    retry: false,
    onSuccess: async (result, refund) => {
      setTarget(null);
      setNotice(result.status === 'processed'
        ? { tone: 'ok', text: `Refund of ${formatMoney(refund.amountPaise)} was processed.` }
        : result.status === 'pending'
          ? { tone: 'ok', text: 'The gateway accepted the refund and is still settling it. Check back shortly.' }
          : { tone: 'problem', text: 'The gateway could not complete the refund. It stays marked failed, so you can try again.' });
      await queryClient.invalidateQueries({ queryKey: queryKeys.shipping.refunds });
    },
    onError: async (failure) => {
      setTarget(null);
      const api = failure instanceof ApiError ? failure : null;
      setNotice({ tone: 'problem', text: `${api?.code === 'UNSUPPORTED_PAYMENT_METHOD' ? 'No payment gateway is configured, so this refund cannot be sent.' : api?.message ?? 'The refund did not complete. Refresh and check its status before trying again.'}${api?.requestId ? ` (Request ID: ${api.requestId})` : ''}` });
      await queryClient.invalidateQueries({ queryKey: queryKeys.shipping.refunds });
    },
  });
  const capability = query.data?.paymentCapability;

  return <Card className={styles.panel!}>
    <div className={styles.sectionHeader}>
      <div><p className={styles.eyebrow}>{canProcess ? 'Finance' : 'Finance · Read only'}</p><h2>Refund records</h2></div>
      {canProcess ? null : <span className={styles.readOnly}><RotateCcw size={15} aria-hidden="true" />No processing action</span>}
    </div>
    <p className={styles.capNotice}>
      {!capability
        ? 'The backend returns the most recent 100 refund records. Provider readiness and captured-payment eligibility are not available to this role, so this screen never attempts to process a refund.'
        : capability.configured
          ? `Online payments are connected through ${capability.provider ?? 'the payment provider'}${capability.mode ? ` in ${capability.mode} mode` : ''}. Only refunds marked ready can be sent; cash-on-delivery refunds are paid manually.`
          : 'No payment gateway is connected, so no refund can be sent from here. Cash-on-delivery refunds are always paid manually.'}
      {capability && !canProcess ? ' Your role can see refund status but not send refunds.' : ''}
    </p>
    {notice ? <p className={notice.tone === 'ok' ? styles.capNotice : styles.mutationError} role={notice.tone === 'ok' ? 'status' : 'alert'}>{notice.text}</p> : null}
    {query.isLoading ? <div className={styles.loading}><Skeleton lines={4} /></div> : null}
    {error && !query.data ? <QueryState problem={error} retry={() => void query.refetch()} title={error.forbidden ? 'Refunds are not available for this role' : error.offline ? 'Refund records are unavailable' : 'Refund records could not be loaded'} /> : null}
    {error && query.data ? <p className={styles.stale} role="alert">Refresh failed; showing the last verified records. {error.requestId ? `Request ID: ${error.requestId}` : ''}</p> : null}
    {!query.isLoading && !error && query.data?.items.length === 0 ? <EmptyState title="No refund records">The backend returned an empty refund register. No refund is inferred from an approved return.</EmptyState> : null}
    {query.data?.items.length ? <div className={styles.refundList} aria-label="Refund records">
      {query.data.items.map((item) => <article className={styles.refundRow} key={item.id}>
        <div><Link className={styles.orderLink} href={`/orders/${item.orderId}`}>Open order<ArrowUpRight size={14} aria-hidden="true" /></Link><span>Refund · {item.id.slice(0, 8)}</span></div>
        <div><strong>{formatMoney(item.amountPaise)}</strong><Badge tone={item.status === 'failed' ? 'negative' : item.status === 'processed' ? 'positive' : 'info'}>{statusLabel(item.status)}</Badge></div>
        <p>{item.reason}</p>
        <div className={styles.refundMeta}>
          <time dateTime={item.createdAt}>{formatIst(item.createdAt, { dateStyle: 'medium', timeStyle: 'short' })} IST</time>
          {canProcess && item.processable ? <Button size="sm" onClick={() => { setNotice(null); setTarget(item); }}>Process refund</Button> : null}
          {item.processable === false && item.blockedReason && item.blockedReason !== 'already_processed' ? <span>{blockedLabels[item.blockedReason]}</span> : null}
        </div>
      </article>)}
    </div> : null}
    <ConfirmDialog open={target !== null} onOpenChange={(open) => { if (!open) setTarget(null); }} phrase="PROCESS REFUND" title="Send this refund to the customer" pending={process.isPending} onConfirm={() => { if (target) process.mutate(target); }}>
      {target ? `This sends ${formatMoney(target.amountPaise)} back to the customer's original payment method through the payment gateway. It cannot be recalled. Retrying the same refund is safe: it will never be paid twice.` : ''}
    </ConfirmDialog>
  </Card>;
}

function ReturnPolicy(): ReactNode {
  const query = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => getSettings(),
    staleTime: 60_000,
    retry: false,
  });
  const problem = query.error ? problemFor(query.error) : undefined;
  return <aside className={styles.policy} aria-label="Return policy">
    <div><p className={styles.eyebrow}>Policy visibility</p><h2>Return window</h2></div>
    {query.isLoading ? <Skeleton lines={1} /> : null}
    {problem ? <p className={styles.policyProblem}>{problem.message}{problem.requestId ? ` · Request ID: ${problem.requestId}` : ''}</p> : null}
    {query.data ? <strong>{query.data.settings.returnWindowDays === null ? 'Not configured' : `${query.data.settings.returnWindowDays} days`}</strong> : null}
    <p>Read-only backend setting. This page does not change policy or override customer eligibility.</p>
  </aside>;
}

export function ReturnsRefunds({ canDecideReturns, canViewRefunds, canProcessRefunds = false, canViewReturnPolicy }: {
  canDecideReturns: boolean;
  canViewRefunds: boolean;
  canProcessRefunds?: boolean;
  canViewReturnPolicy: boolean;
}): ReactNode {
  return <main className={styles.root}>
    <header className={styles.header}>
      <div>
        <Link className={styles.backLink} href="/shipping"><ArrowLeft size={16} aria-hidden="true" />Shipping centre</Link>
        <p className={styles.eyebrow}>Orders & fulfilment · Customer care</p>
        <h1>Returns & refunds</h1>
        <p>Review customer-submitted returns and manage refunds. The backend remains the authority for eligibility, inventory and money movement.</p>
      </div>
      {canViewReturnPolicy ? <ReturnPolicy /> : <div className={styles.policyHidden}><strong>Return policy is server-enforced</strong><span>Duration is not visible to this role.</span></div>}
    </header>

    <ReturnSection canDecide={canDecideReturns} />
    {canViewRefunds ? <RefundSection canProcess={canProcessRefunds} /> : null}
  </main>;
}

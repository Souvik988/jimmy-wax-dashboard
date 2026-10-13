'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ExternalLink, FileText, PackageCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Badge, Button } from '@/components/ui/core';
import { Card, ErrorState, NotAllowedState, OfflineState, Skeleton } from '@/components/ui/feedback';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { addManualShipmentEvent, getShipment, type ShipmentDetail as ShipmentRecord, type ShipmentEventInput } from '@/lib/api/resources/shipping';
import { formatMoney } from '@/lib/format/money';
import { formatIst } from '@/lib/format/time';

import { ManualShipmentEventForm } from './manual-shipment-event-form';
import styles from './shipment-detail.module.css';

type ReconciliationState = 'idle' | 'checking' | 'no-match' | 'failed';
type UnknownAttempt = { input: ShipmentEventInput; baseline: Set<string> };

function statusLabel(value: string): string {
  return value.split('_').map((part) => part ? `${part[0]?.toUpperCase()}${part.slice(1)}` : part).join(' ');
}

function eventKey(event: { status: string; description: string; occurredAt: string }): string {
  return `${event.status}\u0000${event.description}\u0000${event.occurredAt}`;
}

function isAmbiguous(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.message}${error.requestId ? ` Request ID: ${error.requestId}` : ''}`;
  return 'The response could not be verified. Ask an administrator to inspect the shipment before retrying.';
}

function isSafeExternalUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isOffline(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.code === 'UNAVAILABLE');
}

function ShipmentEvents({ shipment }: { shipment: ShipmentRecord }): ReactNode {
  return <ol className={styles.timeline} aria-label="Shipment tracking timeline">
    {shipment.events.map((event, index) => <li className={styles.event} key={`${event.status}-${event.occurredAt}-${index}`}>
      <span className={styles.marker} aria-hidden="true"><PackageCheck size={15} /></span>
      <div className={styles.eventBody}>
        <div className={styles.eventTop}><strong>{statusLabel(event.status)}</strong><Badge tone={event.source === 'manual' ? 'neutral' : 'info'}>{event.source === 'manual' ? 'Manual entry' : event.source}</Badge></div>
        <p>{event.description || 'No note supplied.'}</p>
        <time dateTime={event.occurredAt} title={`UTC ${event.occurredAt}`}>{formatIst(event.occurredAt, { dateStyle: 'full', timeStyle: 'short' })} IST</time>
      </div>
    </li>)}
    {shipment.events.length === 0 ? <li className={styles.noEvents}>No tracking events have been returned for this shipment.</li> : null}
  </ol>;
}

function ShipmentContents({ shipment, canFulfilOrders }: { shipment: ShipmentRecord; canFulfilOrders: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [success, setSuccess] = useState<string | undefined>();
  const [attempt, setAttempt] = useState<UnknownAttempt | null>(null);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [reconciliation, setReconciliation] = useState<ReconciliationState>('idle');
  const [reconciliationError, setReconciliationError] = useState<string | undefined>();
  const [reviewed, setReviewed] = useState(false);

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.shipping.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
  };

  const submit = async (input: ShipmentEventInput) => {
    if (pending || (outcomeUnknown && !(reconciliation === 'no-match' && reviewed))) return;
    const baseline = new Set(shipment.events.map(eventKey));
    setPending(true);
    setError(undefined);
    setSuccess(undefined);
    setReconciliationError(undefined);
    try {
      await addManualShipmentEvent(shipment.id, input);
      setOutcomeUnknown(false);
      setAttempt(null);
      setReconciliation('idle');
      setReviewed(false);
      setSuccess('The backend confirmed this tracking update. The timeline below is refreshed from the shipment record.');
      refreshLists();
      await queryClient.invalidateQueries({ queryKey: queryKeys.shipping.shipment(shipment.id) });
    } catch (caught) {
      if (isAmbiguous(caught)) {
        setAttempt({ input, baseline });
        setOutcomeUnknown(true);
        setReconciliation('idle');
        setReviewed(false);
      } else {
        setError(errorMessage(caught));
        setReconciliation('idle');
        refreshLists();
      }
    } finally {
      setPending(false);
    }
  };

  const checkTimeline = async () => {
    if (!attempt || reconciliation === 'checking') return;
    setReconciliation('checking');
    setReconciliationError(undefined);
    try {
      for (let check = 0; check < 2; check += 1) {
        if (check > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 1_500));
        const latest = await getShipment(shipment.id);
        queryClient.setQueryData(queryKeys.shipping.shipment(shipment.id), latest);
        const recorded = latest.events.some((event) =>
          event.status === attempt.input.status && event.description === (attempt.input.description ?? '') && !attempt.baseline.has(eventKey(event)),
        );
        if (recorded) {
          setOutcomeUnknown(false);
          setAttempt(null);
          setReconciliation('idle');
          setReviewed(false);
          setSuccess('The tracking update was found in the shipment timeline. No retry was submitted.');
          refreshLists();
          return;
        }
      }
      setReconciliation('no-match');
    } catch (caught) {
      setReconciliation('failed');
      setReconciliationError(errorMessage(caught));
    }
  };

  const retry = () => {
    if (attempt && reconciliation === 'no-match' && reviewed) void submit(attempt.input);
  };

  const trackingUrl = isSafeExternalUrl(shipment.trackingUrl) ? shipment.trackingUrl : undefined;

  return <main className={styles.root}>
    <header className={styles.header}>
      <div>
        <Link className={styles.backLink} href="/shipping/shipments"><ArrowLeft size={16} aria-hidden="true" />Shipment register</Link>
        <p className={styles.eyebrow}>Orders & fulfilment · Shipment detail</p>
        <h1>Shipment tracking</h1>
        <p>Shipment details and tracking events are backend-confirmed. A status update may appear in the customer timeline.</p>
      </div>
      <Badge tone={shipment.status === 'delivered' ? 'positive' : ['failed', 'returned_to_origin', 'lost', 'damaged'].includes(shipment.status) ? 'negative' : 'info'}>{statusLabel(shipment.status)}</Badge>
    </header>

    <Card className={styles.summary!}>
      <div className={styles.summaryHead}>
        <div><p className={styles.eyebrow}>Shipment identity</p><h2>{shipment.orderNumber ?? 'Order reference unavailable'}</h2></div>
        <Link href={`/orders/${shipment.orderId}`}>Open order <ExternalLink size={14} aria-hidden="true" /></Link>
      </div>
      <dl className={styles.facts}>
        <div><dt>Courier</dt><dd>{shipment.courier}</dd></div>
        <div><dt>Tracking number</dt><dd><code>{shipment.awb}</code></dd></div>
        <div><dt>Fulfilment mode</dt><dd>{shipment.provider === 'manual' ? 'Manual courier entry' : shipment.provider}</dd></div>
        <div><dt>COD to collect</dt><dd>{shipment.codAmountPaise > 0 ? formatMoney(shipment.codAmountPaise) : 'Prepaid · no cash collection'}</dd></div>
        <div><dt>Parcel weight</dt><dd>{shipment.weightGrams === null ? 'Not provided by this shipment record' : `${shipment.weightGrams} g`}</dd></div>
        <div><dt>Created</dt><dd><time dateTime={shipment.createdAt}>{formatIst(shipment.createdAt, { dateStyle: 'medium', timeStyle: 'short' })} IST</time></dd></div>
        {shipment.etd ? <div><dt>Estimated delivery</dt><dd><time dateTime={shipment.etd}>{formatIst(shipment.etd, { dateStyle: 'medium', timeStyle: 'short' })} IST</time></dd></div> : null}
        {shipment.ndrCount > 0 ? <div><dt>Delivery exceptions</dt><dd>{shipment.ndrCount}</dd></div> : null}
      </dl>
      <div className={styles.links}>
        {trackingUrl ? <a href={trackingUrl} target="_blank" rel="noopener noreferrer">Open courier tracking <ExternalLink size={14} aria-hidden="true" /></a> : <span>No safe HTTPS tracking link was returned.</span>}
        {shipment.hasLabel ? <a href={`/api/backend/admin/shipments/${shipment.id}/label`} target="_blank" rel="noopener noreferrer"><FileText size={15} aria-hidden="true" />Open label PDF</a> : null}
      </div>
      {shipment.provider !== 'manual' ? <p className={styles.providerNote}>Provider status: {shipment.provider}. Its adapter is mock-tested only; not verified against live Shiprocket.</p> : null}
    </Card>

    <div className={styles.contentGrid}>
      <Card className={styles.timelineCard!}>
        <div className={styles.sectionHead}><div><p className={styles.eyebrow}>Carrier history</p><h2>Tracking timeline</h2></div><span>{shipment.events.length} event{shipment.events.length === 1 ? '' : 's'}</span></div>
        <ShipmentEvents shipment={shipment} />
        {shipment.status === 'returned_to_origin' || shipment.status === 'failed' ? <p className={styles.exception}><AlertTriangle size={16} aria-hidden="true" />This delivery exception does not cancel the order or issue a refund. Returns and finance decisions are separate.</p> : null}
      </Card>

      <Card className={styles.eventCard!}>
        <p className={styles.eyebrow}>Manual carrier update</p>
        <h2>Record an event</h2>
        {success ? <p role="status" className={styles.success}>{success}</p> : null}
        {shipment.provider !== 'manual' ? <p>Manual event entry is not offered for provider-backed shipments; their status should arrive through the provider integration.</p>
          : !canFulfilOrders ? <p>This role can inspect tracking only. An operator with order-fulfilment permission can add carrier events.</p>
            : outcomeUnknown ? <section aria-live="polite" className={styles.unknown}>
              <h3>Event outcome is unknown</h3>
              <p>The request may have reached the backend before the connection failed. Check the authoritative shipment timeline before considering a retry.</p>
              {reconciliation === 'no-match' ? <>
                <p>No matching new event appeared in two checks 1.5 seconds apart. Confirm the courier did not record the scan elsewhere before retrying.</p>
                <label className={styles.review}><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />I reviewed the latest backend timeline and confirm this event is not recorded.</label>
              </> : null}
              {reconciliationError ? <p role="alert">Timeline check failed: {reconciliationError}</p> : null}
              <div className={styles.unknownActions}>
                <Button variant="secondary" loading={reconciliation === 'checking'} disabled={reconciliation === 'checking'} onClick={() => void checkTimeline()}>{reconciliation === 'failed' ? 'Check shipment timeline again' : 'Check shipment timeline'}</Button>
                {reconciliation === 'no-match' ? <Button disabled={!reviewed || pending} loading={pending} onClick={retry}>Retry event</Button> : null}
              </div>
            </section>
              : <ManualShipmentEventForm currentStatus={shipment.status} onSubmit={submit} pending={pending} error={error} />}
      </Card>
    </div>
  </main>;
}

export function ShipmentDetail({ shipmentId, canFulfilOrders = false }: { shipmentId: string; canFulfilOrders?: boolean }): ReactNode {
  const query = useQuery({
    queryKey: queryKeys.shipping.shipment(shipmentId),
    queryFn: ({ signal }) => getShipment(shipmentId, signal),
    staleTime: 10_000,
    retry: (count, error) => count < 2 && (error instanceof ApiError ? error.retryable || error.status === 0 : true),
  });

  if (query.isLoading) return <main className={styles.root} aria-label="Loading shipment"><Skeleton lines={7} /></main>;
  if (query.error && !query.data) {
    const requestId = query.error instanceof ApiError ? query.error.requestId : undefined;
    const message = query.error instanceof ApiError ? query.error.message : 'The shipment response did not match the expected contract.';
    if (query.error instanceof ApiError && query.error.status === 403 && query.error.code === 'FORBIDDEN') return <NotAllowedState title="Shipment detail is not available for this role" {...(requestId ? { requestId } : {})}>{message}</NotAllowedState>;
    if (isOffline(query.error)) return <OfflineState title="Shipment detail is unavailable" {...(requestId ? { requestId } : {})} actionLabel="Try again" onAction={() => void query.refetch()}>{message}</OfflineState>;
    return <ErrorState title="Shipment detail could not be verified" {...(requestId ? { requestId } : {})} actionLabel="Retry" onAction={() => void query.refetch()}>{message}</ErrorState>;
  }
  if (!query.data) return <ErrorState title="Shipment detail is empty">The backend returned no shipment record. No placeholder shipment is substituted.</ErrorState>;
  return <ShipmentContents shipment={query.data} canFulfilOrders={canFulfilOrders} />;
}

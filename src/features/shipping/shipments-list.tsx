'use client';

import { AlertTriangle, ArrowLeft, ArrowUpRight, Search, Truck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { Badge, Button, Checkbox, Input } from '@/components/ui/core';
import { Card, EmptyState, ErrorState, NotAllowedState, OfflineState, Skeleton } from '@/components/ui/feedback';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { getShipments, type ShipmentFilters, type ShippingShipment } from '@/lib/api/resources/shipping';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { formatMoney } from '@/lib/format/money';
import { formatIst } from '@/lib/format/time';

import styles from './shipments-list.module.css';

function statusLabel(value: string): string {
  return value.split('_').map((part) => part ? `${part[0]?.toUpperCase()}${part.slice(1)}` : part).join(' ');
}

function statusTone(value: string): 'positive' | 'negative' | 'warning' | 'info' {
  if (value === 'delivered') return 'positive';
  if (['failed', 'lost', 'damaged', 'undelivered', 'returned_to_origin', 'rto_initiated', 'rto_in_transit'].includes(value)) return 'negative';
  if (value === 'pending_provider') return 'warning';
  return 'info';
}

function safeTrackingUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function ShipmentRow({ shipment }: { shipment: ShippingShipment }): ReactNode {
  const url = safeTrackingUrl(shipment.trackingUrl);
  return <article className={styles.row}>
    <div className={styles.identity}>
      <Link className={styles.orderLink} href={`/shipping/shipments/${shipment.id}`}>
        {shipment.orderNumber ?? 'Order reference unavailable'}<ArrowUpRight size={15} aria-hidden="true" />
      </Link>
      <span className={styles.code}>AWB · {shipment.awb}</span>
    </div>
    <div className={styles.statusCell}>
      <Badge tone={statusTone(shipment.status)}>{statusLabel(shipment.status)}</Badge>
      <span>{shipment.courier}</span>
      <small>{shipment.provider === 'manual' ? 'Manual courier entry' : `Provider · ${shipment.provider}`}</small>
    </div>
    <div className={styles.moneyCell}>
      {shipment.codAmountPaise > 0 ? <><strong>{formatMoney(shipment.codAmountPaise)}</strong><span>COD to collect</span></> : <><strong>Prepaid</strong><span>No cash collection due</span></>}
    </div>
    <div className={styles.metaCell}>
      <span>Created <time dateTime={shipment.createdAt}>{formatIst(shipment.createdAt, { dateStyle: 'medium', timeStyle: 'short' })} IST</time></span>
      <span>{shipment.lastEventAt ? <>Last scan <time dateTime={shipment.lastEventAt}>{formatIst(shipment.lastEventAt, { dateStyle: 'medium', timeStyle: 'short' })} IST</time></> : 'No carrier scan recorded'}</span>
      {shipment.ndrCount > 0 ? <span className={styles.exception}><AlertTriangle size={14} aria-hidden="true" />{shipment.ndrCount} delivery exception{shipment.ndrCount === 1 ? '' : 's'}</span> : null}
    </div>
    <div className={styles.actions}>
      <Link className={styles.detailLink} href={`/shipping/shipments/${shipment.id}`}>Open shipment</Link>
      {url ? <a className={styles.detailLink} href={url} target="_blank" rel="noopener noreferrer">Courier tracking</a> : null}
      {shipment.hasLabel ? <a className={styles.detailLink} href={`/api/backend/admin/shipments/${shipment.id}/label`} target="_blank" rel="noopener noreferrer">Open label</a> : null}
      {shipment.provider !== 'manual' ? <small>Provider adapter is mock-tested only; not verified against live Shiprocket.</small> : null}
    </div>
  </article>;
}

function apiProblem(error: unknown): { message: string; requestId?: string; offline: boolean; forbidden: boolean } {
  if (error instanceof ApiError) return {
    message: error.message,
    ...(error.requestId ? { requestId: error.requestId } : {}),
    offline: error.status === 0 || error.status >= 500 || error.code === 'UNAVAILABLE',
    forbidden: error.status === 403 && error.code === 'FORBIDDEN',
  };
  return { message: 'The shipment response could not be verified. No sample rows are shown.', offline: false, forbidden: false };
}

export function ShipmentsList(): ReactNode {
  const [searchDraft, setSearchDraft] = useState('');
  const [filters, setFilters] = useState<ShipmentFilters>({});

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const q = searchDraft.trim();
      setFilters((current) => ({ ...current, q: q || undefined }));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  const query = useCursorList(queryKeys.shipping.shipments, filters, (current, cursor, signal) => getShipments(cursor, signal, current));
  const problem = query.error ? apiProblem(query.error) : undefined;
  const hasFilters = Boolean(searchDraft.trim() || filters.courier?.trim() || filters.status?.trim() || filters.exception || filters.stuck);

  return <main className={styles.root}>
    <header className={styles.header}>
      <div>
        <Link className={styles.backLink} href="/shipping"><ArrowLeft size={16} aria-hidden="true" />Shipping centre</Link>
        <p className={styles.eyebrow}>Orders & fulfilment · Live register</p>
        <h1>Shipment register</h1>
        <p>Search and inspect courier tracking records returned by the backend. Events are added from an individual shipment.</p>
      </div>
      <Truck size={32} strokeWidth={1.5} aria-hidden="true" className={styles.headerIcon} />
    </header>

    <Card className={styles.card!}>
      <div className={styles.filters} aria-label="Shipment filters">
        <div className={styles.search}>
          <Search size={17} aria-hidden="true" />
          <Input label="Search order or tracking" value={searchDraft} maxLength={60} placeholder="Order number or AWB" onChange={(event) => setSearchDraft(event.target.value)} />
        </div>
        <Input label="Courier" value={filters.courier ?? ''} maxLength={60} onChange={(event) => setFilters((current) => ({ ...current, courier: event.target.value || undefined }))} />
        <Input label="Exact status" value={filters.status ?? ''} maxLength={30} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value || undefined }))} />
        <Checkbox label="Exceptions only" checked={filters.exception ?? false} onChange={(exception) => setFilters((current) => ({ ...current, exception: exception || undefined }))} />
        <Checkbox label="Stuck shipments only" checked={filters.stuck ?? false} onChange={(stuck) => setFilters((current) => ({ ...current, stuck: stuck || undefined }))} />
        <Button variant="quiet" onClick={() => { setSearchDraft(''); setFilters({}); }} disabled={!searchDraft && !Object.values(filters).some(Boolean)}>Clear filters</Button>
      </div>

      {query.isLoading ? <div className={styles.loading} aria-label="Loading shipments"><Skeleton lines={5} /></div> : null}
      {problem && !query.data ? problem.forbidden
        ? <NotAllowedState title="Shipment register is not available for this role" {...(problem.requestId ? { requestId: problem.requestId } : {})}>{problem.message}</NotAllowedState>
        : problem.offline
          ? <OfflineState title="Shipments are unavailable" {...(problem.requestId ? { requestId: problem.requestId } : {})} actionLabel="Try again" onAction={() => void query.refetch()}>{problem.message}</OfflineState>
          : <ErrorState title="Shipments could not be loaded" {...(problem.requestId ? { requestId: problem.requestId } : {})} actionLabel="Retry" onAction={() => void query.refetch()}>{problem.message}</ErrorState> : null}
      {problem && query.data ? <p className={styles.stale} role="alert">Refresh failed. The list below may be out of date. {problem.requestId ? `Request ID: ${problem.requestId}` : ''}</p> : null}
      {!query.isLoading && !problem && query.items.length === 0 ? hasFilters
        ? <EmptyState title="No shipments match these filters">The backend returned no shipment records for this query. Clear filters to check the full register.</EmptyState>
        : <EmptyState title="No shipments recorded yet">The backend returned an empty shipment register. Manual shipment creation is available from the <Link href="/shipping">ready-to-ship queue</Link>.</EmptyState> : null}
      {query.items.length > 0 ? <div className={styles.list} aria-label="Shipment records">{query.items.map((shipment) => <ShipmentRow key={shipment.id} shipment={shipment} />)}</div> : null}
      <footer className={styles.footer}>
        <span>{query.items.length} shipment{query.items.length === 1 ? '' : 's'} loaded · server cursor pagination</span>
        {query.hasMore ? <Button variant="secondary" loading={query.isFetchingNextPage} disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more shipments</Button> : null}
      </footer>
    </Card>
  </main>;
}

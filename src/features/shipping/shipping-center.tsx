'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertTriangle, ArrowUpRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Badge, Button } from '@/components/ui/core';
import { Card, EmptyState, ErrorState, NotAllowedState, OfflineState, Skeleton, StatCard } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { getReadyToShip, getShippingProvider, type ShippingProvider, type ShippingReadyItem } from '@/lib/api/resources/shipping';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { formatMoney } from '@/lib/format/money';

import { ManualShipmentWorkflow } from './manual-shipment-workflow';
import { providerCapabilities } from './provider-capabilities';
import { ProviderDispatch, ProviderReadinessCard } from './provider-dispatch';
import { ShippingTools } from './shipping-tools';
import styles from './shipping-center.module.css';

type QueryError = { message: string; requestId?: string; offline?: boolean; forbidden?: boolean };

function isOffline(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.code === 'UNAVAILABLE');
}

function errorDetails(error: unknown): QueryError {
  if (error instanceof ApiError) return {
    message: error.message,
    ...(error.requestId ? { requestId: error.requestId } : {}),
    offline: isOffline(error),
    forbidden: error.status === 403 && error.code === 'FORBIDDEN',
  };
  return { message: 'The backend response could not be confirmed. No sample data is substituted.' };
}

function ProviderPanel({ provider, error, retry }: { provider: ShippingProvider | null; error?: QueryError | undefined; retry?: (() => void) | undefined }): ReactNode {
  if (error) {
    return <section className={styles.connection} aria-labelledby="shipping-connection-title">
      <p className={styles.eyebrow}>Connection state</p>
      <h2 id="shipping-connection-title">{error.forbidden ? 'Provider status is not available for this role' : 'Provider status could not be confirmed'}</h2>
      <p>{error.message}{error.requestId ? ` · Request ID: ${error.requestId}` : ''}</p>
      {retry ? <Button variant="quiet" onClick={retry}>Retry provider check</Button> : null}
    </section>;
  }
  if (!provider) return <section className={styles.connection} aria-label="Loading provider status"><Skeleton lines={3} /></section>;

  const manual = !provider.configured || provider.provider === 'manual';
  return <section className={styles.connection} aria-labelledby="shipping-connection-title">
    <p className={styles.eyebrow}>Connection state</p>
    {manual ? <>
      <span className={styles.connectionStatus}>Provider not connected</span>
      <h2 id="shipping-connection-title">Manual courier entry</h2>
      <p>Enter the courier and tracking details provided by your carrier. Provider booking, labels, pickup scheduling and wallet actions are not available in this mode.</p>
    </> : <>
      <span className={styles.connectionStatus}>{provider.reachable ? 'Provider reachable' : 'Provider connection needs attention'}</span>
      <h2 id="shipping-connection-title">{provider.provider} connection</h2>
      <p>Provider capability is reported by the backend. Provider actions remain separate from manual tracking.</p>
      <p className={styles.providerNote}>Mock-tested only; not verified against live Shiprocket. Do not treat this connection as proof of live courier processing.</p>
    </>}
  </section>;
}

function ReadyOrder({ item, canCreateShipment, onAddShipment, onProviderShip }: { item: ShippingReadyItem; canCreateShipment: boolean; onAddShipment?: ((item: ShippingReadyItem) => void) | undefined; onProviderShip?: ((item: ShippingReadyItem) => void) | undefined }): ReactNode {
  const isCod = item.paymentMethod === 'cod';
  return <article className={styles.orderCard}>
    <div className={styles.orderMain}>
      <Link className={styles.orderNumber} href={`/orders/${item.id}`} aria-label={`Open order ${item.orderNumber}`}>
        {item.orderNumber}<ArrowUpRight size={15} aria-hidden="true" />
      </Link>
      <p className={styles.customer}>{item.customerName || 'Customer name unavailable'}</p>
      <p className={styles.location}>{item.city || 'City unavailable'} · PIN {item.pincode}</p>
    </div>
    <div className={styles.amount}>
      <strong>{formatMoney(isCod ? item.codAmountPaise : item.totalPaise)}</strong>
      <span>{isCod ? 'Collect on delivery' : `Paid · ${formatMoney(item.totalPaise)}`}</span>
    </div>
    <div className={styles.package} aria-label="Backend-computed package details">
      <span><strong>{item.lines}</strong> {item.lines === 1 ? 'line' : 'lines'}</span>
      <span>Dead weight <strong>{item.package.weightGrams} g</strong></span>
      <span>Queue age <strong>{item.ageHours} h</strong></span>
      <span>Package <strong>{item.package.lengthMm} × {item.package.widthMm} × {item.package.heightMm} mm</strong></span>
      <span>Volumetric weight <strong>{item.volumetricGrams} g</strong></span>
      <Badge tone="warning">Serviceability {item.serviceable === null ? 'not checked' : item.serviceable ? 'allowed' : 'not allowed'}</Badge>
    </div>
    {item.warnings.length ? <ul className={styles.warningList} aria-label="Shipment warnings">
      {item.warnings.map((warning) => <li key={warning}><AlertTriangle size={15} aria-hidden="true" />{warning}</li>)}
    </ul> : null}
    {(canCreateShipment && onAddShipment) || onProviderShip ? <div className={styles.actions}>
      {onProviderShip ? <Button onClick={() => onProviderShip(item)}>Ship via provider</Button> : null}
      {canCreateShipment && onAddShipment ? <Button variant="secondary" onClick={() => onAddShipment(item)}>{onProviderShip ? 'Enter courier manually' : 'Add shipment'}</Button> : null}
    </div> : null}
  </article>;
}

export function ShippingCenterView({
  provider,
  readyItems,
  providerError,
  queueError,
  providerLoading = false,
  queueLoading = false,
  queueStale = false,
  onRefresh,
  refreshing = false,
  onRetryProvider,
  onRetryQueue,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  canCreateShipment = false,
  onAddShipment,
  onProviderShip,
}: {
  provider: ShippingProvider | null;
  readyItems: ShippingReadyItem[];
  providerError?: QueryError | undefined;
  queueError?: QueryError | undefined;
  providerLoading?: boolean;
  queueLoading?: boolean;
  queueStale?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  onRetryProvider?: () => void;
  onRetryQueue?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  canCreateShipment?: boolean;
  onAddShipment?: ((item: ShippingReadyItem) => void) | undefined;
  onProviderShip?: ((item: ShippingReadyItem) => void) | undefined;
}): ReactNode {
  return <div className={styles.root}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>Orders & fulfilment · Live operations</p>
        <h1>Shipping centre</h1>
        <p>Prepare parcels from backend-confirmed order, payment and package data. Manual courier details remain the primary path until a provider is explicitly configured.</p>
      </div>
      <div className={styles.headerActions}>
        <Link className={styles.registerLink} href="/shipping/shipments">Shipment register <ArrowUpRight size={15} aria-hidden="true" /></Link>
        <Link className={styles.registerLink} href="/shipping/returns">Returns &amp; refunds <ArrowUpRight size={15} aria-hidden="true" /></Link>
        <Button variant="secondary" onClick={onRefresh} disabled={!onRefresh || refreshing}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh shipping data
        </Button>
      </div>
    </header>

    <div className={styles.introGrid}>
      <ProviderPanel provider={providerLoading ? null : provider} error={providerError} retry={onRetryProvider} />
      <section className={styles.focus} aria-label="Fulfilment focus">
        <p className={styles.eyebrow}>Fulfilment focus</p>
        <h2>Ready orders, clearly packed.</h2>
        <p>Only processing orders eligible for shipment are returned by the backend queue.</p>
        <strong>{queueLoading ? '—' : readyItems.length}</strong>
        <small>{readyItems.length === 1 ? 'order loaded' : 'orders loaded'} · cursor-paginated</small>
      </section>
    </div>

    {provider ? <ProviderReadinessCard capabilities={providerCapabilities(provider)} /> : null}

    {provider ? <div className={styles.stats} aria-label="Shipment overview">
      <StatCard label="Active shipments" value={String(provider.overview.activeShipments)} detail="Backend count" />
      <StatCard label="Exceptions" value={String(provider.overview.exceptions)} detail="Review shipment status" tone={provider.overview.exceptions ? 'negative' : 'positive'} />
      <StatCard label="Stuck" value={String(provider.overview.stuck)} detail={`Backend threshold · ${provider.settings.stuckAfterHours} hours`} tone={provider.overview.stuck ? 'negative' : 'neutral'} />
    </div> : null}

    <Card className={styles.queueCard!}>
      <div className={styles.queueHeading}>
        <div><p className={styles.eyebrow}>Orders in processing</p><h2>Ready to ship</h2></div>
        <p>COD values are shown exactly as returned in integer paise; GST and checkout fees are already included.</p>
      </div>
      {queueLoading ? <div className={styles.loading}><Skeleton lines={5} /></div> : null}
      {queueError && !readyItems.length ? queueError.forbidden
        ? <NotAllowedState title="Shipping queue is not available for this role" {...(queueError.requestId ? { requestId: queueError.requestId } : {})}>{queueError.message}</NotAllowedState>
        : queueError.offline
          ? <OfflineState title="Shipping queue is unavailable" {...(queueError.requestId ? { requestId: queueError.requestId } : {})} {...(onRetryQueue ? { actionLabel: 'Try again', onAction: onRetryQueue } : {})}>{queueError.message}</OfflineState>
          : <ErrorState title="Shipping queue could not be verified" {...(queueError.requestId ? { requestId: queueError.requestId } : {})} {...(onRetryQueue ? { actionLabel: 'Retry', onAction: onRetryQueue } : {})}>{queueError.message}</ErrorState> : null}
      {queueError && readyItems.length ? <p className={styles.stale} role="alert">Refresh failed; showing the last successful queue. {queueError.requestId ? `Request ID: ${queueError.requestId}` : ''}</p> : null}
      {!queueLoading && !queueError && readyItems.length === 0 ? <EmptyState title="No orders are ready to ship">The backend returned an empty processing queue. Orders are not created or inferred by this screen.</EmptyState> : null}
      {readyItems.length ? <div className={styles.queueList}>{readyItems.map((item) => <ReadyOrder item={item} canCreateShipment={canCreateShipment} onAddShipment={onAddShipment} onProviderShip={onProviderShip} key={item.id} />)}</div> : null}
      <div className={styles.queueFooter}>
        <span>{queueStale ? 'Queue data may be out of date.' : 'Package weights and dimensions are backend-calculated.'}</span>
        {hasMore ? <Button variant="secondary" loading={loadingMore} disabled={loadingMore} onClick={onLoadMore}>Load more ready orders</Button> : null}
      </div>
    </Card>
  </div>;
}

export function ShippingCenter({ canFulfilOrders = false, canWriteShippingSettings = false, canWriteDeliveryAreas = false }: { canFulfilOrders?: boolean; canWriteShippingSettings?: boolean; canWriteDeliveryAreas?: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const [selectedOrder, setSelectedOrder] = useState<ShippingReadyItem | null>(null);
  const [providerOrder, setProviderOrder] = useState<ShippingReadyItem | null>(null);
  const [shipmentDialogBlocked, setShipmentDialogBlocked] = useState(false);
  const providerQuery = useQuery({
    queryKey: queryKeys.shipping.provider,
    queryFn: ({ signal }) => getShippingProvider(signal),
    staleTime: 30_000,
    retry: (count, error) => count < 2 && (error instanceof ApiError ? error.retryable || error.status === 0 : true),
  });
  const filters = { limit: 20 };
  const queue = useCursorList(queryKeys.shipping.ready, filters, (_filters, cursor, signal) => getReadyToShip(cursor, signal, filters.limit));
  const providerError = providerQuery.error ? errorDetails(providerQuery.error) : undefined;
  const queueError = queue.error ? errorDetails(queue.error) : undefined;
  const capabilities = providerCapabilities(providerQuery.data ?? null);
  const canDispatch = canFulfilOrders && capabilities.canDispatch;

  return <>
    <ShippingCenterView
      provider={providerQuery.data ?? null}
      readyItems={queue.items}
      providerError={providerError}
      queueError={queueError}
      providerLoading={providerQuery.isLoading}
      queueLoading={queue.isLoading}
      queueStale={queue.isFetching || Boolean(queue.error)}
      onRefresh={() => void queryClient.invalidateQueries({ queryKey: queryKeys.shipping.all })}
      refreshing={providerQuery.isFetching || queue.isFetching}
      onRetryProvider={() => void providerQuery.refetch()}
      onRetryQueue={() => void queue.refetch()}
      hasMore={queue.hasMore}
      loadingMore={queue.isFetchingNextPage}
      onLoadMore={() => void queue.fetchNextPage()}
      canCreateShipment={canFulfilOrders}
      onAddShipment={setSelectedOrder}
      onProviderShip={canDispatch ? setProviderOrder : undefined}
    />
    {providerQuery.data && !providerQuery.error ? <ShippingTools
      provider={providerQuery.data}
      canWriteShippingSettings={canWriteShippingSettings}
      canWriteDeliveryAreas={canWriteDeliveryAreas}
    /> : null}
    {providerOrder ? <Dialog
      open
      onOpenChange={(open) => { if (!open) setProviderOrder(null); }}
      title={`Ship via ${capabilities.providerName} · ${providerOrder.orderNumber}`}
    >
      <ProviderDispatch order={{ id: providerOrder.id, orderNumber: providerOrder.orderNumber }} capabilities={capabilities} onDone={() => setProviderOrder(null)} />
    </Dialog> : null}
    {selectedOrder ? <Dialog
      open
      onOpenChange={(open) => { if (open) return; if (!shipmentDialogBlocked) setSelectedOrder(null); }}
      title={`Add manual shipment · ${selectedOrder.orderNumber}`}
      dismissible={!shipmentDialogBlocked}
      footer={<Button variant="secondary" disabled={shipmentDialogBlocked} onClick={() => setSelectedOrder(null)}>{shipmentDialogBlocked ? 'Resolve the shipment check first' : 'Close'}</Button>}
    >
      <ManualShipmentWorkflow
        order={{ id: selectedOrder.id, orderNumber: selectedOrder.orderNumber }}
        onClose={() => setSelectedOrder(null)}
        onSafetyStateChange={setShipmentDialogBlocked}
      />
    </Dialog> : null}
  </>;
}

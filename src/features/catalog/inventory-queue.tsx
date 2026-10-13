'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Package, Search, X } from 'lucide-react';

import { Badge, Button, Input, StatusPill, Textarea } from '@/components/ui/core';
import { Card, EmptyState, ErrorState, NotAllowedState, OfflineState, Skeleton, StatCard } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { adjustInventory, getInventory, getInventoryMovements, inventoryAdjustmentInputSchema, type InventoryAdjustmentInput, type InventoryMovement, type InventoryRow } from '@/lib/api/resources/catalog';
import { mergeCursorPages } from '@/lib/api/cursor';
import { formatIst } from '@/lib/format/time';

import styles from './inventory-queue.module.css';

const EMPTY_SNAPSHOT: InventoryRow[] = [];

function isOffline(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.code === 'UNAVAILABLE');
}

function apiError(error: unknown): ApiError | null {
  return error instanceof ApiError ? error : null;
}

function uncertainOutcome(error: unknown): boolean {
  return error instanceof ApiError ? error.status === 0 || error.status >= 500 : true;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
}

function signed(value: number): string {
  return value > 0 ? `+${formatCount(value)}` : formatCount(value);
}

function statusFor(row: InventoryRow): { label: string; tone: 'positive' | 'warning' | 'negative' } {
  if (row.available === 0) return { label: 'Out of stock', tone: 'negative' };
  if (row.lowStockThreshold !== null && row.available <= row.lowStockThreshold) return { label: 'Low stock', tone: 'warning' };
  return { label: 'Stock available', tone: 'positive' };
}

function movementLabel(movement: InventoryMovement): string {
  return movement.kind.replaceAll('_', ' ');
}

function MovementHistory({
  variantId,
  row,
  onClose,
}: {
  variantId: string;
  row: InventoryRow;
  onClose: () => void;
}): React.ReactNode {
  const movements = useInfiniteQuery({
    queryKey: queryKeys.inventory.movements(variantId),
    queryFn: ({ pageParam, signal }) => getInventoryMovements(variantId, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(variantId),
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error instanceof ApiError ? error.retryable || error.status === 0 : true),
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 1_500),
  });
  const items = mergeCursorPages(movements.data?.pages ?? []);
  const error = apiError(movements.error);

  return <section className={styles.history} aria-label={`Movement history for ${row.name} ${row.variantTitle}`}>
    <header className={styles.historyHead}>
      <div>
        <p className="eyebrow">APPEND-ONLY STOCK LEDGER</p>
        <h2>Movement history</h2>
        <p>{row.name} · {row.variantTitle} · {row.sku}</p>
      </div>
      <Button variant="quiet" onClick={onClose}><X size={16} aria-hidden="true" /> Close history</Button>
    </header>
    {movements.isLoading ? <div className={styles.loading}><Skeleton lines={3} /></div> : null}
    {!movements.isLoading && movements.error && !movements.data ? (
      error?.status === 403 && error.code === 'FORBIDDEN'
        ? <NotAllowedState title="Movement history access denied" {...(error.requestId ? { requestId: error.requestId } : {})}>The backend denied inventory movement access for this role.</NotAllowedState>
        : isOffline(movements.error)
          ? <OfflineState title="Movement history unavailable" {...(error?.requestId ? { requestId: error.requestId } : {})} actionLabel="Try again" onAction={() => void movements.refetch()}>{error?.message ?? 'Reconnect to the backend to load the real inventory ledger.'}</OfflineState>
          : <ErrorState title="Movement history could not be loaded" {...(error?.requestId ? { requestId: error.requestId } : {})} actionLabel="Retry" onAction={() => void movements.refetch()}>{error?.message ?? 'The movement response did not match the expected contract.'}</ErrorState>
    ) : null}
    {movements.data ? <>
      {movements.error ? <p className={styles.stale} role="alert">Refresh failed; showing the last verified ledger page. {error?.requestId ? `Request ID: ${error.requestId}` : ''}</p> : null}
      {items.length ? <ol className={styles.movements}>
        {items.map((movement) => <li className={styles.movement} key={movement.id}>
          <div className={styles.movementTop}>
            <Badge tone={movement.deltaOnHand < 0 ? 'warning' : movement.deltaOnHand > 0 ? 'positive' : 'neutral'}>{movementLabel(movement)}</Badge>
            <time dateTime={movement.createdAt} title={`UTC ${movement.createdAt}`}>{formatIst(movement.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time>
          </div>
          <p className={styles.movementDelta}>On hand {signed(movement.deltaOnHand)} · reserved {signed(movement.deltaReserved)}</p>
          <p>{movement.reason ?? 'No reason was returned for this movement.'}</p>
          {movement.refType ? <small>Reference type: {movement.refType}</small> : null}
        </li>)}
      </ol> : <EmptyState title="No movements recorded">The backend returned no inventory movements for this variant.</EmptyState>}
      {movements.hasNextPage ? <Button variant="secondary" loading={movements.isFetchingNextPage} disabled={movements.isFetchingNextPage} onClick={() => void movements.fetchNextPage()}>Load older movements</Button> : null}
    </> : null}
  </section>;
}

function InventoryRowCard({ row, selected, canAdjust, adjustmentOutcomeUnknown, onSelect, onAdjust }: { row: InventoryRow; selected: boolean; canAdjust: boolean; adjustmentOutcomeUnknown: boolean; onSelect: () => void; onAdjust: () => void }): React.ReactNode {
  const status = statusFor(row);
  const label = `View movement history for ${row.name} · ${row.variantTitle}`;
  return <li className={styles.position}>
    <div className={styles.positionHead}>
      <div className={styles.identity}>
        <span className={styles.mark} aria-hidden="true"><Package size={18} strokeWidth={1.7} /></span>
        <div className={styles.identityCopy}>
          <p className={styles.sku}>{row.sku} · v{row.version}</p>
          <h3>{row.name}</h3>
          <p>{row.variantTitle}</p>
        </div>
      </div>
      <StatusPill tone={status.tone}>{status.label}</StatusPill>
    </div>
    <div className={styles.balances} aria-label={`Stock balance for ${row.name} ${row.variantTitle}`}>
      <div><span>Available</span><strong>{formatCount(row.available)}</strong></div>
      <div><span>On hand</span><strong>{formatCount(row.onHand)}</strong></div>
      <div><span>Reserved</span><strong>{formatCount(row.reserved)}</strong></div>
      <div><span>Low-stock threshold</span><strong>{row.lowStockThreshold === null ? 'Not configured' : formatCount(row.lowStockThreshold)}</strong></div>
    </div>
    <div className={styles.rowActions}>
      <Button variant={selected ? 'primary' : 'secondary'} className={styles.historyButton!} aria-label={label} aria-pressed={selected} onClick={onSelect}>{selected ? 'Viewing history' : 'View movement history'}</Button>
      {canAdjust ? <Button variant="quiet" className={styles.historyButton!} aria-label={adjustmentOutcomeUnknown ? `Adjustment outcome unknown for ${row.name} · ${row.variantTitle}` : `Adjust stock for ${row.name} · ${row.variantTitle}`} disabled={adjustmentOutcomeUnknown} onClick={onAdjust}>{adjustmentOutcomeUnknown ? 'Check ledger before adjusting' : 'Adjust stock'}</Button> : null}
    </div>
    {adjustmentOutcomeUnknown ? <p className={styles.stale} role="status">A previous adjustment request had an uncertain response. Check the refreshed ledger before another adjustment; this action is withheld for this page session.</p> : null}
  </li>;
}

function InventoryAdjustmentDialog({ row, onClose, onOutcomeUnknown }: { row: InventoryRow; onClose: () => void; onOutcomeUnknown: () => void }): React.ReactNode {
  const [baseRow] = useState(row);
  const queryClient = useQueryClient();
  const [deltaDraft, setDeltaDraft] = useState('');
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (input: InventoryAdjustmentInput) => adjustInventory(baseRow.variantId, input),
    retry: false,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all }); },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
      if (uncertainOutcome(error)) onOutcomeUnknown();
    },
  });

  const delta = deltaDraft.trim() ? Number(deltaDraft) : Number.NaN;
  const validDelta = Number.isSafeInteger(delta) && delta !== 0 && Math.abs(delta) <= 100_000;
  const reasonLength = Array.from(reason.trim()).length;
  const validReason = reasonLength >= 3 && reasonLength <= 300;
  const projectedOnHand = validDelta ? baseRow.onHand + delta : null;
  const projectedAvailable = projectedOnHand === null ? null : projectedOnHand - baseRow.reserved;
  const wouldConsumeReserved = projectedOnHand !== null && projectedOnHand < baseRow.reserved;
  const error = apiError(mutation.error);
  const conflict = error?.status === 409;
  const outcomeUnknown = mutation.error !== null && uncertainOutcome(mutation.error);
  const mfaCancelled = error?.status === 403 && error.code === 'MFA_REQUIRED';
  const formId = `inventory-adjustment-${baseRow.variantId}`;
  const canSubmit = validDelta && validReason && !wouldConsumeReserved && !mutation.isPending && !conflict && !outcomeUnknown && !mutation.data;
  const lockedDraft = mutation.isPending || conflict || outcomeUnknown || Boolean(mutation.data);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    const parsed = inventoryAdjustmentInputSchema.safeParse({ delta, reason: reason.trim(), expectedVersion: baseRow.version });
    if (!parsed.success) {
      setFieldError('Enter a non-zero whole-unit change and a 3–300 character reason.');
      return;
    }
    setFieldError(null);
    mutation.mutate(parsed.data);
  };

  return <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }} title={`Review stock adjustment · ${baseRow.name} · ${baseRow.variantTitle}`} dismissible={!mutation.isPending} footer={<>
    <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>{mutation.data ? 'Close' : 'Cancel'}</Button>
    {!mutation.data ? <Button type="submit" form={formId} loading={mutation.isPending} disabled={!canSubmit}>Apply adjustment</Button> : null}
  </>}>
    {mutation.data ? <div className={styles.adjustSuccess} role="status">
      <StatusPill tone="positive">Adjustment recorded</StatusPill>
      <p>The backend confirmed on-hand {formatCount(mutation.data.onHand)}, reserved {formatCount(mutation.data.reserved)}, and available {formatCount(mutation.data.onHand - mutation.data.reserved)} units at version {mutation.data.version}. The inventory snapshot and open ledgers are refreshing.</p>
    </div> : <>
      <p className={styles.adjustIntro}>Enter a signed change to on-hand stock. Reserved units are held for online orders in their payment window and cannot be consumed by an adjustment. This write requires inventory permission and a fresh MFA step-up; the backend remains authoritative.</p>
      <form id={formId} className={styles.adjustForm} onSubmit={submit}>
        <Input label="Signed change in on-hand units" type="number" step="1" min="-100000" max="100000" inputMode="numeric" value={deltaDraft} disabled={lockedDraft} onChange={(event) => { setDeltaDraft(event.target.value); setFieldError(null); mutation.reset(); }} description="Use a negative number to remove units or a positive number to receive them; zero is not allowed." />
        <Textarea label="Reason · required" minLength={3} maxLength={300} value={reason} disabled={lockedDraft} onChange={(event) => { setReason(event.target.value); setFieldError(null); mutation.reset(); }} description={`${reasonLength}/300 characters. This reason is written to the append-only inventory ledger and audit log.`} />
        {fieldError ? <p className={styles.stale} role="alert">{fieldError}</p> : null}
        {validDelta ? <div className={styles.adjustReview} aria-label="Stock adjustment review">
          <h3>Before and projected balance</h3>
          <dl>
            <div><dt>Current on-hand</dt><dd>{formatCount(baseRow.onHand)}</dd></div>
            <div><dt>Signed change</dt><dd>{signed(delta)}</dd></div>
            <div><dt>Projected on-hand</dt><dd>{formatCount(projectedOnHand!)}</dd></div>
            <div><dt>Reserved · unchanged</dt><dd>{formatCount(baseRow.reserved)}</dd></div>
            <div><dt>Projected available</dt><dd>{formatCount(projectedAvailable!)}</dd></div>
            <div><dt>Expected inventory version</dt><dd>{baseRow.version}</dd></div>
          </dl>
        </div> : null}
        {wouldConsumeReserved ? <p className={styles.stale} role="alert">This change would put on-hand stock below the {formatCount(baseRow.reserved)} units already reserved. Reduce the removal amount; the backend would reject this adjustment.</p> : null}
        {mutation.error ? <div className={styles.adjustError} role="alert">
          {outcomeUnknown ? <><strong>Outcome not confirmed.</strong> The request may or may not have been applied. The inventory snapshot and any open ledger view are refreshing; open movement history to verify before taking another action. Do not repeat this adjustment from the current page session. {error?.requestId ? `Request ID: ${error.requestId}` : ''}</> : conflict ? <><strong>Stock changed or the adjustment is no longer valid.</strong> {error?.message ?? 'Refresh inventory and start a new review with the latest version.'} The request was not replayed. {error?.requestId ? `Request ID: ${error.requestId}` : ''}</> : mfaCancelled ? <><strong>MFA step-up was not completed.</strong> The backend did not apply the adjustment. You can review and request verification again. {error?.requestId ? `Request ID: ${error.requestId}` : ''}</> : <>{error?.message ?? 'The backend rejected this adjustment.'} {error?.requestId ? `Request ID: ${error.requestId}` : ''}</>}
        </div> : null}
      </form>
    </>}
  </Dialog>;
}

export function InventoryQueue({ canAdjust = false }: { canAdjust?: boolean } = {}): React.ReactNode {
  const query = useQuery({
    queryKey: queryKeys.inventory.list,
    queryFn: ({ signal }) => getInventory(signal),
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error instanceof ApiError ? error.retryable || error.status === 0 : true),
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 1_500),
  });
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [adjustmentVariantId, setAdjustmentVariantId] = useState<string | null>(null);
  const [unknownOutcomeVariantIds, setUnknownOutcomeVariantIds] = useState<Set<string>>(() => new Set());
  const error = apiError(query.error);
  const snapshot = query.data?.items ?? EMPTY_SNAPSHOT;

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim().slice(0, 100)), 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const visibleRows = useMemo(() => {
    if (!search) return snapshot;
    const normalized = search.toLocaleLowerCase('en-IN');
    return snapshot.filter((row) => `${row.name} ${row.variantTitle} ${row.sku} ${row.variantId}`.toLocaleLowerCase('en-IN').includes(normalized));
  }, [search, snapshot]);
  const selectedRow = snapshot.find((row) => row.variantId === selectedVariantId) ?? null;
  const adjustmentRow = snapshot.find((row) => row.variantId === adjustmentVariantId) ?? null;
  const lowStock = snapshot.filter((row) => row.lowStockThreshold !== null && row.available <= row.lowStockThreshold && row.available > 0).length;
  const outOfStock = snapshot.filter((row) => row.available === 0).length;

  return <div className={styles.root}>
    <header className={styles.header}>
      <div>
        <p className="eyebrow">STOCK · LIVE BACKEND</p>
        <h1>Inventory</h1>
        <p>Reconcile backend on-hand, reserved and available units. Stock adjustments are signed, reasoned and version-checked; existing low-stock thresholds remain read-only.</p>
      </div>
    </header>

    {query.isLoading ? <Card className={styles.loadingCard!}><Skeleton lines={5} /></Card> : null}
    {!query.isLoading && query.error && !query.data ? (
      error?.status === 403 && error.code === 'FORBIDDEN'
        ? <NotAllowedState title="Inventory access denied" {...(error.requestId ? { requestId: error.requestId } : {})}>The backend denied inventory access for this role. No inventory details were loaded.</NotAllowedState>
        : isOffline(query.error)
          ? <OfflineState title="Inventory service unavailable" {...(error?.requestId ? { requestId: error.requestId } : {})} actionLabel="Try again" onAction={() => void query.refetch()}>{error?.message ?? 'Reconnect to the backend to load real stock positions. No sample inventory is shown.'}</OfflineState>
          : <ErrorState title="Inventory could not be loaded" {...(error?.requestId ? { requestId: error.requestId } : {})} actionLabel="Retry" onAction={() => void query.refetch()}>{error?.message ?? 'The inventory response did not match the expected contract.'}</ErrorState>
    ) : null}

    {query.data ? <>
      <div className={styles.summary} aria-label="Inventory snapshot summary">
        <StatCard label="Variant positions" value={formatCount(snapshot.length)} detail="Complete backend snapshot" />
        <StatCard label="Low stock" value={formatCount(lowStock)} detail="Available at or below threshold" tone={lowStock ? 'negative' : 'neutral'} />
        <StatCard label="Out of stock" value={formatCount(outOfStock)} detail="No available units" tone={outOfStock ? 'negative' : 'neutral'} />
      </div>

      <Card className={styles.card!}>
        <div className={styles.listHead}>
          <div>
            <h2>Stock positions</h2>
            <p>Search applies to the complete inventory snapshot returned by the backend; this endpoint is not cursor-paginated.</p>
          </div>
          <div className={styles.search}><Search size={17} aria-hidden="true" /><Input label="Search inventory" value={searchDraft} maxLength={100} placeholder="Product, variant, SKU or ID" onChange={(event) => setSearchDraft(event.target.value)} /></div>
        </div>

        {query.isFetching ? <p className={styles.freshness} role="status">Refreshing stock snapshot; the visible values may be stale.</p> : null}
        {query.error ? <p className={styles.stale} role="alert">Refresh failed. Showing the last successful snapshot. {error?.requestId ? `Request ID: ${error.requestId}` : ''}</p> : null}
        {snapshot.length === 0 ? <EmptyState title="No inventory positions">The backend returned no stock positions. No sample inventory is shown.</EmptyState> : visibleRows.length ? <>
          <p className={styles.count}>{visibleRows.length} of {snapshot.length} positions shown · backend order retained.</p>
          <ul className={styles.positions} aria-label="Inventory positions returned by the backend">
            {visibleRows.map((row) => <InventoryRowCard key={row.variantId} row={row} selected={selectedVariantId === row.variantId} canAdjust={canAdjust} adjustmentOutcomeUnknown={unknownOutcomeVariantIds.has(row.variantId)} onSelect={() => setSelectedVariantId((current) => current === row.variantId ? null : row.variantId)} onAdjust={() => setAdjustmentVariantId(row.variantId)} />)}
          </ul>
        </> : <EmptyState title="No matching stock positions" actionLabel="Clear search" onAction={() => setSearchDraft('')}>Try another product, variant, SKU or ID. Search covers the complete snapshot.</EmptyState>}
      </Card>

      {selectedRow ? <MovementHistory variantId={selectedRow.variantId} row={selectedRow} onClose={() => setSelectedVariantId(null)} /> : null}

      {canAdjust && adjustmentRow ? <InventoryAdjustmentDialog row={adjustmentRow} onClose={() => setAdjustmentVariantId(null)} onOutcomeUnknown={() => setUnknownOutcomeVariantIds((current) => new Set(current).add(adjustmentRow.variantId))} /> : null}

      <Card title="Adjustment safeguards" className={styles.guardrails!}>
        <div className={styles.guardIcon} aria-hidden="true"><Boxes size={19} /></div>
        <p>Stock changes use a signed unit delta, a reason, the current inventory version and fresh MFA step-up. Low-stock thresholds are displayed from the backend and cannot be edited here.</p>
      </Card>
    </> : null}
  </div>;
}

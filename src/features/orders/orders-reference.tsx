'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, RefreshCw, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Badge, Button, Input, Select } from '@/components/ui/core';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { Card, EmptyState, ErrorState, OfflineState, Skeleton, NotAllowedState } from '@/components/ui/feedback';
import { downloadBlob } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { applyServerFieldErrors } from '@/lib/api/form-errors';
import { queryKeys } from '@/lib/api/query-keys';
import { exportOrders, listOrders, type AdminOrder, type OrderListFilters } from '@/lib/api/resources/orders';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { formatMoney } from '@/lib/format/money';
import { formatIst } from '@/lib/format/time';

import styles from './orders-reference.module.css';

const orderStatuses = ['pending_payment', 'placed', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'expired', 'returned'] as const;
type InitialFilters = { status?: string; q?: string };

const exportRangeSchema = z.object({
  from: z.iso.date('Choose a valid start date.'),
  to: z.iso.date('Choose a valid end date.'),
}).superRefine((range, context) => {
  const days = (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days) || days <= 0) context.addIssue({ code: 'custom', path: ['to'], message: 'The end date must be after the start date.' });
  else if (days > 400) context.addIssue({ code: 'custom', path: ['to'], message: 'The backend accepts a maximum 400-day range.' });
});
type ExportRange = z.infer<typeof exportRangeSchema>;

function readUrlFilters(): InitialFilters {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('status') ?? '';
  const q = params.get('q') ?? '';
  return {
    ...(orderStatuses.includes(status as (typeof orderStatuses)[number]) ? { status } : {}),
    ...(q ? { q: q.slice(0, 40) } : {}),
  };
}

function writeUrlFilters(filters: InitialFilters): void {
  const url = new URL(window.location.href);
  if (filters.status) url.searchParams.set('status', filters.status);
  else url.searchParams.delete('status');
  if (filters.q) url.searchParams.set('q', filters.q);
  else url.searchParams.delete('q');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function isOffline(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.code === 'UNAVAILABLE');
}

function displayStatus(value: string): string {
  return value.replaceAll('_', ' ');
}

export function OrdersReference({ initialFilters, operatorId }: { initialFilters: InitialFilters; operatorId: string }): React.ReactNode {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(initialFilters.status ?? '');
  const [searchDraft, setSearchDraft] = useState(initialFilters.q ?? '');
  const [search, setSearch] = useState(initialFilters.q ?? '');
  const [exportError, setExportError] = useState<ApiError | null>(null);
  const exportForm = useForm<ExportRange>({ resolver: zodResolver(exportRangeSchema), defaultValues: { from: '', to: '' } });

  const filters = useMemo<InitialFilters>(() => ({ ...(status ? { status } : {}), ...(search ? { q: search } : {}) }), [status, search]);
  const queryFilters = useMemo<OrderListFilters>(() => ({
    ...(status ? { status } : {}),
    ...(search ? { q: search } : {}),
    limit: 20,
  }), [search, status]);
  const query = useCursorList(queryKeys.orders.list(queryFilters), queryFilters, listOrders);

  useEffect(() => {
    const handlePopState = () => {
      const next = readUrlFilters();
      setStatus(next.status ?? '');
      setSearchDraft(next.q ?? '');
      setSearch(next.q ?? '');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft.trim().slice(0, 40));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => writeUrlFilters(filters), [filters]);

  const resetFilters = useCallback(() => {
    setSearchDraft('');
    setStatus('');
    setSearch('');
  }, []);

  const applySavedFilters = useCallback((saved: Record<string, string | boolean>) => {
    const savedStatus = typeof saved.status === 'string' && orderStatuses.includes(saved.status as (typeof orderStatuses)[number])
      ? saved.status
      : '';
    setStatus(savedStatus);
    setSearchDraft('');
    setSearch('');
  }, []);

  const columns = useMemo<DataColumn<AdminOrder>[]>(() => [
    { id: 'order', header: 'Order', cell: (row) => <span className={styles.number}><Link href={`/orders/${row.id}`} aria-label={`Open ${row.orderNumber}`}>{row.orderNumber}</Link>{row.demo ? <Badge tone="warning">Demo</Badge> : null}</span> },
    { id: 'created', header: 'Placed · IST', cell: (row) => <time dateTime={row.createdAt} title={`UTC ${row.createdAt}`}>{formatIst(row.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time> },
    { id: 'status', header: 'Order status', cell: (row) => <span className={styles.status}>{displayStatus(row.status)}</span> },
    { id: 'payment', header: 'Payment', cell: (row) => `${displayStatus(row.paymentStatus)} · ${row.paymentMethod}` },
    { id: 'total', header: 'Total · INR', className: styles.amount!, cell: (row) => formatMoney(row.totalPaise) },
  ], []);

  const handleExport = exportForm.handleSubmit(async (range) => {
    setExportError(null);
    try {
      const file = await exportOrders(range);
      downloadBlob(file);
    } catch (error) {
      const mapped = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL', 'The export could not be completed.');
      const firstField = applyServerFieldErrors(mapped, ['from', 'to'] as const, (field, issue) => exportForm.setError(field, issue));
      if (firstField) exportForm.setFocus(firstField);
      else setExportError(mapped);
    }
  });

  const queryError = query.error;
  const apiError = queryError instanceof ApiError ? queryError : null;

  return <div className={styles.root}>
    <header className={styles.header}>
      <div>
        <p className="eyebrow">LIVE BACKEND · OPERATOR QUEUE</p>
        <h1>Orders</h1>
        <p>Search the real order-number queue, open a full order record, and retain backend ordering. Actions appear only when the server-supported workflow is ready.</p>
      </div>
      <Button variant="secondary" onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })} disabled={query.isFetching}>
        <RefreshCw size={16} aria-hidden="true" /> Refresh
      </Button>
    </header>

    <Card className={styles.card!}>
      <div className={styles.filters} aria-label="Order filters">
        <div className={styles.search}>
          <Search size={17} aria-hidden="true" />
          <Input label="Search order number" value={searchDraft} maxLength={40} placeholder="e.g. JW-…" onChange={(event) => setSearchDraft(event.target.value)} />
        </div>
        <Select label="Filter orders by status" value={filters.status ?? ''} onChange={(event) => {
          const status = event.target.value;
          setStatus(status);
        }}>
          <option value="">All statuses</option>
          {orderStatuses.map((status) => <option value={status} key={status}>{displayStatus(status)}</option>)}
        </Select>
        <Button variant="quiet" onClick={resetFilters} disabled={!filters.status && !filters.q && !searchDraft}>Clear filters</Button>
      </div>

      {query.isLoading ? <div className={styles.loading} aria-label="Loading orders"><Skeleton lines={5} /></div> : null}
      {!query.isLoading && queryError && !query.data ? (
        apiError?.status === 403 && apiError.code === 'FORBIDDEN'
          ? <NotAllowedState title="Orders are not available for this role">The backend denied access to this queue. Your role permissions remain enforced by the service.</NotAllowedState>
          : isOffline(queryError)
            ? <OfflineState title="Could not reach the orders service" {...(apiError?.requestId ? { requestId: apiError.requestId } : {})} actionLabel="Try again" onAction={() => void query.refetch()}>{apiError?.message ?? 'Reconnect to the backend to load real orders. No sample orders are shown here.'}</OfflineState>
            : <ErrorState title="Orders could not be loaded" {...(apiError?.requestId ? { requestId: apiError.requestId } : {})} actionLabel="Retry" onAction={() => void query.refetch()}>{apiError?.message ?? 'The response did not match the expected orders contract.'}</ErrorState>
      ) : null}
      {query.data ? <>
        {query.isFetching ? <p className={styles.freshness} role="status">Updating; the visible rows may be stale.</p> : null}
        {queryError ? <p className={styles.stale} role="alert">Refresh failed. Showing the last successful results. {apiError?.requestId ? `Request ID: ${apiError.requestId}` : ''}</p> : null}
        {query.items.length ? <>
          <p className={styles.count}>{query.items.length} loaded · totals are the backend’s integer-paise values.</p>
          <DataTable
            caption="Live orders from the backend"
            columns={columns}
            rows={query.items}
            density="regular"
            operatorId={operatorId}
            resource="orders"
            filters={status ? { status } : {}}
            onFiltersChange={applySavedFilters}
            selectionScopeKey={`${status}:${search}`}
          />
          <div className={styles.pagination}>
            <span>{query.hasMore ? 'More results are available.' : 'End of available results.'}</span>
            <Button variant="secondary" loading={query.isFetchingNextPage} disabled={!query.hasMore} onClick={() => void query.fetchNextPage()}>Load more orders</Button>
          </div>
        </> : <EmptyState title={filters.status || filters.q ? 'No matching orders' : 'No orders yet'} {...(filters.status || filters.q ? { actionLabel: 'Clear filters', onAction: resetFilters } : {})}>{filters.status || filters.q ? 'Try another order number or status. This is a real empty result, not demo data.' : 'The backend returned an empty orders list. No sample rows are substituted.'}</EmptyState>}
      </> : null}
    </Card>

    <Card title="Export orders" className={styles.export!}>
      <p>Choose a half-open UTC date range (start included, end excluded). The backend requires a step-up check before it releases customer order data; date ranges are limited to 400 days.</p>
      <form className={styles.exportForm} onSubmit={(event) => void handleExport(event)}>
        <Input label="Start date · included" type="date" error={exportForm.formState.errors.from?.message} {...exportForm.register('from')} required />
        <Input label="End date · excluded" type="date" error={exportForm.formState.errors.to?.message} {...exportForm.register('to')} required />
        <Button type="submit" loading={exportForm.formState.isSubmitting} disabled={exportForm.formState.isSubmitting}><Download size={16} aria-hidden="true" /> Download CSV</Button>
      </form>
      {exportError ? <p className={styles.inlineError} role="alert">{exportError.message}{exportError.requestId ? ` · Request ID: ${exportError.requestId}` : ''}</p> : null}
      <small>The backend formula-guards CSV cells. The dashboard does not retain an export copy; the browser saves the file after download.</small>
    </Card>
  </div>;
}

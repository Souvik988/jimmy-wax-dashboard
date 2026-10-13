'use client';

/* eslint-disable @typescript-eslint/no-explicit-any -- passthrough backend payloads are intentionally loosely typed */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Loadable, PageHeader, kit, labelOf, toneOf, useNotice } from '@/components/kit/kit';
import { Badge, Button, Input, Select, Tabs } from '@/components/ui/core';
import { ReasonDialog } from '@/components/ui/overlays';
import { type AnalyticsName, type OutboxEvent, getAnalytics, getOpsHealth, listAudit, listOutbox, replayOutbox } from '@/lib/api/resources/admin-ops';
import { formatMoney } from '@/lib/format/money';

import { Gstr1Panel } from './gstr1-panel';
import { formatIst } from '@/lib/format/time';

type Data = Record<string, any>;

function Definitions({ data }: { data: Data }): ReactNode {
  const defs = data['definitions'] as Record<string, string> | undefined;
  if (!defs) return null;
  return <details className={kit.notice}><summary>How these numbers are defined</summary><ul>{Object.entries(defs).map(([key, value]) => <li key={key}><strong>{key}</strong>: {value}</li>)}</ul></details>;
}

function Table({ caption, columns, rows }: { caption: string; columns: Array<{ key: string; label: string; format?: (value: any) => string }>; rows: Data[] }): ReactNode {
  if (rows.length === 0) return <p className={kit.notice}>No data in this range for {caption.toLowerCase()}.</p>;
  return <div className="ui-table-wrap" role="region" aria-label={`${caption} table`} tabIndex={0}><table className="ui-table ui-table--regular"><caption>{caption}</caption>
    <thead><tr>{columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column.key}>{column.format ? column.format(row[column.key]) : String(row[column.key] ?? '—')}</td>)}</tr>)}</tbody>
  </table></div>;
}
const money = (value: number): string => formatMoney(value ?? 0);

export function RangePicker({ from, to, onChange }: { from: string; to: string; onChange: (range: { from: string; to: string }) => void }): ReactNode {
  return <div className={kit.toolbar}>
    <Input label="From" type="date" value={from} onChange={(event) => onChange({ from: event.target.value, to })} />
    <Input label="To" type="date" value={to} onChange={(event) => onChange({ from, to: event.target.value })} />
  </div>;
}

function useAnalytics(name: AnalyticsName, range: { from: string; to: string }) {
  const valid = !range.from || !range.to || range.from <= range.to;
  return useQuery({ queryKey: ['analytics', name, range], enabled: valid, queryFn: ({ signal }) => getAnalytics(name, { ...(range.from ? { from: new Date(`${range.from}T00:00:00+05:30`).toISOString() } : {}), ...(range.to ? { to: new Date(`${range.to}T23:59:59+05:30`).toISOString() } : {}) }, signal) });
}

function Sales({ range }: { range: { from: string; to: string } }): ReactNode {
  const q = useAnalytics('sales', range);
  const d = q.data as Data | undefined;
  return <Loadable query={q} noun="Sales analytics">{d ? <div className={kit.stack}>
    <div className={kit.grid}>
      <div className={kit.stat}><span>Orders</span><strong>{d['totals'].orders}</strong></div>
      <div className={kit.stat}><span>Revenue (incl. GST, shipping, COD fee)</span><strong>{money(d['totals'].revenuePaise)}</strong></div>
      <div className={kit.stat}><span>Average order value</span><strong>{money(d['totals'].aovPaise)}</strong></div>
      <div className={kit.stat}><span>Discounts</span><strong>{money(d['totals'].discountPaise)}</strong></div>
    </div>
    <Definitions data={d} />
    <Table caption="Revenue by day" rows={d['series'] ?? []} columns={[{ key: 'bucket', label: 'Day' }, { key: 'orders', label: 'Orders' }, { key: 'subtotalPaise', label: 'Items', format: money }, { key: 'shippingPaise', label: 'Shipping', format: money }, { key: 'taxPaise', label: 'GST', format: money }, { key: 'revenuePaise', label: 'Revenue', format: money }]} />
    {d['byPaymentMethod'] ? <Table caption="By payment method" rows={d['byPaymentMethod']} columns={Object.keys((d['byPaymentMethod'] as Data[])[0] ?? {}).map((key) => ({ key, label: labelOf(key), ...(key.endsWith('Paise') ? { format: money } : {}) }))} /> : null}
  </div> : null}</Loadable>;
}

function Generic({ name, range, tables }: { name: AnalyticsName; range: { from: string; to: string }; tables: Array<{ path: string; caption: string; money?: string[] }> }): ReactNode {
  const q = useAnalytics(name, range);
  const d = q.data as Data | undefined;
  return <Loadable query={q} noun={`${labelOf(name)} analytics`}>{d ? <div className={kit.stack}>
    <Definitions data={d} />
    {Object.entries(d).filter(([key, value]) => typeof value === 'number' && key !== 'range').map(([key, value]) => <div className={kit.stat} key={key}><span>{labelOf(key.replace(/([A-Z])/gu, '_$1').toLowerCase())}</span><strong>{key.endsWith('Paise') ? money(value as number) : String(value)}</strong></div>)}
    {tables.map((table) => { const rows = (d[table.path] ?? []) as Data[]; return <Table key={table.path} caption={table.caption} rows={rows} columns={Object.keys(rows[0] ?? {}).filter((key) => typeof rows[0]?.[key] !== 'object').map((key) => ({ key, label: labelOf(key.replace(/([A-Z])/gu, '_$1').toLowerCase()), ...(key.endsWith('Paise') ? { format: money } : {}) }))} />; })}
  </div> : null}</Loadable>;
}

export function AnalyticsPanel(): ReactNode {
  const [tab, setTab] = useState('sales');
  const [range, setRange] = useState({ from: '', to: '' });
  const invalid = Boolean(range.from && range.to && range.from > range.to);
  return <div className={kit.page}>
    <PageHeader eyebrow="Insights" title="Analytics">Figures come straight from the backend and use its published definitions. Times are IST. Leave the dates empty for the last 30 days.</PageHeader>
    <RangePicker from={range.from} to={range.to} onChange={setRange} />
    {invalid ? <p className={`${kit.notice} ${kit.danger}`} role="alert">The start date must not be after the end date.</p> : null}
    <Tabs value={tab} onChange={setTab} tabs={[{ id: 'sales', label: 'Sales' }, { id: 'products', label: 'Products' }, { id: 'customers', label: 'Customers' }, { id: 'shipping', label: 'Shipping' }, { id: 'returns', label: 'Returns' }, { id: 'geo', label: 'Geography' }]} />
    {tab === 'sales' ? <Sales range={range} /> : null}
    {tab === 'products' ? <Generic name="products" range={range} tables={[{ path: 'items', caption: 'Best-selling products' }]} /> : null}
    {tab === 'customers' ? <Generic name="customers" range={range} tables={[{ path: 'topCustomers', caption: 'Top customers' }]} /> : null}
    {tab === 'shipping' ? <Generic name="shipping" range={range} tables={[{ path: 'byStatus', caption: 'Shipments by status' }, { path: 'byCourier', caption: 'By courier' }]} /> : null}
    {tab === 'returns' ? <Generic name="returns" range={range} tables={[{ path: 'byStatus', caption: 'Returns by status' }]} /> : null}
    {tab === 'geo' ? <Generic name="geo" range={range} tables={[{ path: 'byState', caption: 'Orders by state' }, { path: 'topCities', caption: 'Top cities' }]} /> : null}
  </div>;
}

export function FinancePanel(): ReactNode {
  const [range, setRange] = useState({ from: '', to: '' });
  const q = useAnalytics('gst', range);
  const d = q.data as Data | undefined;
  return <div className={kit.page}>
    <PageHeader eyebrow="Insights" title="GST & finance">GST is summed from each order&apos;s stored tax breakdown — the same figures printed on invoices. Refunds are processed from Orders → Returns & refunds.</PageHeader>
    <RangePicker from={range.from} to={range.to} onChange={setRange} />
    <Loadable query={q} noun="GST summary">{d ? <div className={kit.stack}>
      <Definitions data={d} />
      <Table caption="GST by month" rows={d['months'] ?? []} columns={[{ key: 'month', label: 'Month' }, { key: 'orders', label: 'Orders' }, { key: 'taxablePaise', label: 'Taxable value', format: money }, { key: 'gstPaise', label: 'GST', format: money }]} />
      <div className={kit.actions}><a href="/api/backend/admin/exports/orders.csv"><Button variant="secondary">Download orders CSV</Button></a></div>
    </div> : null}</Loadable>
    <Gstr1Panel />
  </div>;
}

function Json({ value }: { value: unknown }): ReactNode { return <pre className={kit.pre}>{value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}</pre>; }

export function AuditPanel(): ReactNode {
  const [type, setType] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['audit', type], queryFn: ({ signal }) => listAudit(type || undefined, signal) });
  return <div className={kit.page}>
    <PageHeader eyebrow="Insights" title="Audit log">Every sensitive change, with who did it and the before/after values. Showing the latest 100.</PageHeader>
    <div className={kit.toolbar}>
      <Select label="Resource type" value={type} onChange={(event) => setType(event.target.value)}><option value="">All</option>{['order', 'shipment', 'product', 'variant', 'inventory', 'media', 'customer', 'coupon', 'settings', 'exp_document', 'exp_release', 'exp_campaign', 'message_template', 'outbox'].map((t) => <option key={t} value={t}>{t}</option>)}</Select>
    </div>
    <Loadable query={q} noun="Audit entries">
      {q.data?.length === 0 ? <p className={kit.notice}>No audit entries.</p> : <ul className={kit.rows}>{q.data?.map((entry) => <li key={entry.id} className={kit.row}>
        <div><strong>{entry.action}</strong><br /><small>{entry.resourceType}{entry.resourceId ? ` · ${entry.resourceId}` : ''} · {entry.actorRole ?? 'system'} · {formatIst(entry.createdAt, { dateStyle: 'medium', timeStyle: 'short' })} IST</small>{entry.reason ? <><br /><small>Reason: {entry.reason}</small></> : null}
          {open === entry.id ? <div className={kit.split}><div><h4>Before</h4><Json value={entry.before} /></div><div><h4>After</h4><Json value={entry.after} /></div></div> : null}</div>
        <div><small>{entry.requestId ?? ''}</small></div>
        <div><Button variant="quiet" aria-expanded={open === entry.id} onClick={() => setOpen(open === entry.id ? null : entry.id)}>{open === entry.id ? 'Hide detail' : 'Show detail'}</Button></div>
      </li>)}</ul>}
    </Loadable>
  </div>;
}

export function OpsPanel({ canReplay }: { canReplay: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const [state, setState] = useState<'dead' | 'pending'>('dead');
  const [target, setTarget] = useState<OutboxEvent | null>(null);
  const health = useQuery({ queryKey: ['ops', 'health'], queryFn: ({ signal }) => getOpsHealth(signal), refetchInterval: 30_000 });
  const outbox = useQuery({ queryKey: ['ops', 'outbox', state], queryFn: ({ signal }) => listOutbox(state, signal) });
  const replay = useMutation({
    mutationFn: (reason: string) => replayOutbox(target!.id, reason),
    onSuccess: () => { setTarget(null); notice.success('Event re-queued for delivery.'); void queryClient.invalidateQueries({ queryKey: ['ops'] }); },
    onError: (error) => { setTarget(null); notice.failure(error); },
  });
  return <div className={kit.page}>
    <PageHeader eyebrow="Insights" title="Operations">Background event delivery and system alerts. Dead-lettered events failed repeatedly; fix the cause before replaying.</PageHeader>
    {notice.element}
    <Loadable query={health} noun="System health">{health.data ? <section aria-label="Health">
      {health.data.alerts.length === 0 ? <p className={`${kit.notice} ${kit.ok}`}>No active alerts.</p> : <ul className={kit.rows}>{health.data.alerts.map((alert) => <li key={alert} className={`${kit.notice} ${kit.danger}`}>{alert}</li>)}</ul>}
      <div className={kit.grid}>{Object.entries(health.data).filter(([key]) => key !== 'alerts').map(([key, value]) => <div className={kit.stat} key={key}><span>{labelOf(key.replace(/([A-Z])/gu, '_$1').toLowerCase())}</span><strong>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</strong></div>)}</div>
    </section> : null}</Loadable>
    <div className={kit.toolbar}><Select label="Event queue" value={state} onChange={(event) => setState(event.target.value as typeof state)}><option value="dead">Dead-lettered</option><option value="pending">Pending</option></Select></div>
    <Loadable query={outbox} noun="Events">
      {outbox.data?.length === 0 ? <p className={kit.notice}>No {state} events.</p> : <ul className={kit.rows}>{outbox.data?.map((event) => <li key={event.id} className={kit.row}>
        <div><strong>{event.eventType}</strong><br /><small>#{event.id} · {event.attempts} attempt(s) · {formatIst(event.createdAt, { dateStyle: 'medium', timeStyle: 'short' })} IST</small>{event.lastError ? <><br /><small>{event.lastError}</small></> : null}</div>
        <div><Badge tone={toneOf(event.dead ? 'dead' : 'pending')}>{event.dead ? 'Dead' : 'Pending'}</Badge></div>
        <div>{canReplay && event.dead ? <Button variant="secondary" onClick={() => setTarget(event)}>Replay</Button> : null}</div>
      </li>)}</ul>}
    </Loadable>
    <ReasonDialog open={Boolean(target)} onOpenChange={(open) => { if (!open) setTarget(null); }} pending={replay.isPending} title="Replay event" onConfirm={(reason) => replay.mutate(reason)}>The event is re-queued once. Customer notifications it triggers may be sent.</ReasonDialog>
  </div>;
}

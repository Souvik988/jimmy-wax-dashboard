'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, PackageCheck, ReceiptText, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

import { Card, EmptyState, ErrorState, NotAllowedState, OfflineState, Skeleton } from '@/components/ui/feedback';
import { Button, StatusPill } from '@/components/ui/core';
import { ReasonDialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { addOrderNote, cancelOrder, getOrder, getOrderNotes, resendOrderConfirmation, transitionOrder, type AdminOrderDetail, type OrderNotes } from '@/lib/api/resources/orders';
import { can, type SafeOperator } from '@/lib/auth/permissions';
import { formatMoney } from '@/lib/format/money';
import { formatIst, formatRelativeIst } from '@/lib/format/time';
import { OrderInvoiceAction } from './order-invoice';
import { OrderTimeline } from './order-timeline';

import styles from './order-detail.module.css';

function label(value: string): string { return value.replaceAll('_', ' '); }
function tone(status: string): 'positive' | 'warning' | 'negative' | 'info' {
  if (['delivered', 'cod_collected', 'paid'].includes(status)) return 'positive';
  if (['cancelled', 'returned', 'failed', 'expired'].includes(status)) return 'negative';
  if (['placed', 'confirmed', 'processing', 'cod_due'].includes(status)) return 'warning';
  return 'info';
}
function offline(error: unknown): boolean { return error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.code === 'UNAVAILABLE'); }
function Failure({ error, retry }: { error: unknown; retry: () => void }): React.ReactNode {
  const api = error instanceof ApiError ? error : undefined;
  if (api?.status === 403) return <NotAllowedState title="This order is not available">The backend denied access to this order.</NotAllowedState>;
  if (offline(error)) return <OfflineState title="Order service unavailable" {...(api?.requestId ? { requestId: api.requestId } : {})} actionLabel="Try again" onAction={retry}>No cached order details are substituted.</OfflineState>;
  return <ErrorState title="Order could not load" {...(api?.requestId ? { requestId: api.requestId } : {})} actionLabel="Retry" onAction={retry}>The order response was unavailable or did not match the verified contract.</ErrorState>;
}

function MoneyBreakdown({ order }: { order: AdminOrderDetail }): React.ReactNode {
  const discount = order.discountPaise ? `−${formatMoney(order.discountPaise)}` : formatMoney(0);
  return <Card title="Totals" className={styles.totals!}><dl>
    <div><dt>Items subtotal</dt><dd>{formatMoney(order.subtotalPaise)}</dd></div>
    <div><dt>Order discount</dt><dd>{discount}</dd></div>
    <div><dt>Shipping</dt><dd>{formatMoney(order.shippingPaise)}</dd></div>
    <div><dt>COD handling</dt><dd>{formatMoney(order.codFeePaise)}</dd></div>
    <div className={styles.total}><dt>Order total</dt><dd>{formatMoney(order.totalPaise)}</dd></div>
  </dl><p>{order.taxInclusive ? `Includes ${formatMoney(order.taxPaise)} GST.` : `GST: ${formatMoney(order.taxPaise)}.`} The backend does not provide a per-line GST or coupon allocation for this admin record.</p></Card>;
}

function AddressCard({ order, operator }: { order: AdminOrderDetail; operator: SafeOperator }): React.ReactNode {
  const address = order.address;
  const hasStreet = typeof address.address === 'string' || typeof address.line1 === 'string';
  const street = typeof address.address === 'string' ? address.address : typeof address.line1 === 'string' ? address.line1 : null;
  const name = address.name;
  return <Card title="Delivery address" className={styles.address!} action={<StatusPill tone={hasStreet ? 'positive' : 'info'}>{hasStreet ? 'Fulfilment view' : 'Redacted view'}</StatusPill>}>
    <strong>{name}</strong><p>{street ? <>{street}<br /></> : null}{address.landmark ? <>{String(address.landmark)}<br /></> : null}{address.city}, {address.state} · {address.pin}</p>
    {!hasStreet ? <p className={styles.redaction}><ShieldAlert size={16} aria-hidden="true" />Street and phone are redacted for this role. Customer reveal is not offered here because the verified order DTO has no customer identifier.</p> : null}
    {!can(operator, 'orders:fulfil') ? <p className={styles.cardNote}>You can read the order but cannot pack, resend, or transition it.</p> : null}
  </Card>;
}

function Actions({ order, operator }: { order: AdminOrderDetail; operator: SafeOperator }): React.ReactNode {
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const resend = useMutation({ mutationFn: () => resendOrderConfirmation(order.id) });
  const mutation = useMutation({
    mutationFn: async (input: { action: 'confirmed' | 'processing' | 'cancel'; reason?: string }) => input.action === 'cancel'
      ? cancelOrder(order.id, { reason: input.reason ?? '', expectedVersion: order.version })
      : transitionOrder(order.id, { to: input.action, expectedVersion: order.version }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all }); setCancelOpen(false); },
  });
  const canFulfil = can(operator, 'orders:fulfil'); const canCancel = can(operator, 'orders:cancel');
  if (!canFulfil && !canCancel) return null;
  const next = order.status === 'placed' ? 'confirmed' : order.status === 'confirmed' ? 'processing' : null;
  const conflict = mutation.error instanceof ApiError && mutation.error.code === 'CART_VERSION_CONFLICT';
  return <Card title="Order actions" className={styles.actions!}><p>Actions wait for the backend response; they never optimistically change order, stock, or payment state.</p><div>{next && canFulfil ? <Button loading={mutation.isPending} disabled={mutation.isPending} onClick={() => mutation.mutate({ action: next })}>{next === 'confirmed' ? 'Confirm order' : 'Start processing'}</Button> : null}{canFulfil ? <Link className="ui-button ui-button--secondary" href={`/orders/${order.id}/packing-slip`}>Packing slip</Link> : null}{canFulfil ? <Button variant="secondary" loading={resend.isPending} disabled={resend.isPending} onClick={() => resend.mutate()}>Resend confirmation</Button> : null}{canCancel && ['pending_payment', 'placed', 'confirmed', 'processing'].includes(order.status) ? <Button variant="danger" disabled={mutation.isPending} onClick={() => setCancelOpen(true)}>Cancel order</Button> : null}</div>{resend.isSuccess ? <p role="status">Confirmation email was queued. Delivery is not guaranteed until the outbox processes it.</p> : null}{resend.isError ? <p className={styles.actionError} role="alert">{resend.error instanceof ApiError ? resend.error.message : 'The confirmation was not queued.'}</p> : null}{mutation.isError ? conflict ? <div className={styles.actionError} role="alert"><p>This order changed in another operator session. No action was repeated.</p><Button variant="secondary" onClick={() => { mutation.reset(); void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(order.id) }); }}>Load current order</Button></div> : <p className={styles.actionError} role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'The action did not complete. Reload the order before trying again.'}</p> : null}<ReasonDialog open={cancelOpen} onOpenChange={setCancelOpen} pending={mutation.isPending} title="Cancel this order" onConfirm={(reason) => mutation.mutate({ action: 'cancel', reason })}><>Cancelling restocks committed stock. For paid online orders, the backend queues a refund; this COD order has no automatic refund.</></ReasonDialog></Card>;
}

function Refunds({ order }: { order: AdminOrderDetail }): React.ReactNode {
  return <Card title="Refunds" className={styles.refunds!}>
    {order.refunds.length ? <ul>{order.refunds.map((refund) => <li key={refund.id}>
      <ReceiptText size={16} aria-hidden="true" />
      <span><strong>{label(refund.status)} · {formatMoney(refund.amountPaise)}</strong><small>{refund.reason}</small></span>
    </li>)}</ul> : <EmptyState title="No refunds recorded">The backend has not recorded a refund for this order.</EmptyState>}
    <p>Refund processing is controlled by Finance with MFA in the dedicated fulfilment workflow.</p>
  </Card>;
}

function Notes({ id, notes }: { id: string; notes: UseQueryResult<OrderNotes> }): React.ReactNode {
  const queryClient = useQueryClient(); const [body, setBody] = useState('');
  const add = useMutation({ mutationFn: () => addOrderNote(id, body.trim()), onSuccess: async () => { setBody(''); await queryClient.invalidateQueries({ queryKey: queryKeys.orders.notes(id) }); } });
  return <Card title="Internal notes" className={styles.notes!}><p className={styles.internal}><PackageCheck size={16} aria-hidden="true" />Visible to operators only. Never shown to customers.</p>{notes.isPending ? <Skeleton lines={3} /> : notes.isError ? <Failure error={notes.error} retry={() => void notes.refetch()} /> : notes.data.items.length ? <ul>{notes.data.items.map((note) => <li key={note.id}><strong>{note.authorRole}</strong><span>{note.body}</span><time dateTime={note.createdAt}>{formatRelativeIst(note.createdAt)}</time></li>)}</ul> : <EmptyState title="No internal notes">There are no operator notes for this order.</EmptyState>}<label className="ui-field"><span className="ui-field__label">Add an internal note</span><textarea className="ui-input ui-textarea" value={body} maxLength={2000} onChange={(event) => setBody(event.target.value)} /></label><Button loading={add.isPending} disabled={body.trim().length === 0 || add.isPending} onClick={() => add.mutate()}>Save internal note</Button>{add.isError ? <p className={styles.actionError} role="alert">{add.error instanceof ApiError ? add.error.message : 'The note was not saved. Try again.'}</p> : null}</Card>;
}

export function OrderDetail({ id, operator }: { id: string; operator: SafeOperator }): React.ReactNode {
  const order = useQuery({ queryKey: queryKeys.orders.detail(id), queryFn: () => getOrder(id), staleTime: 15_000, retry: 1 });
  const notes = useQuery({ queryKey: queryKeys.orders.notes(id), queryFn: () => getOrderNotes(id), enabled: order.isSuccess, staleTime: 15_000, retry: 1 });
  if (order.isPending) return <section className={styles.root} aria-label="Loading order"><Skeleton lines={4} /><Skeleton lines={12} /></section>;
  if (order.isError) return <section className={styles.root}><Failure error={order.error} retry={() => void order.refetch()} /></section>;
  const data = order.data;
  return <section className={`${styles.root} orders-detail-root`}>
    <Link className={styles.back} href="/orders"><ArrowLeft size={16} aria-hidden="true" />Back to orders</Link>
    <header className={styles.header}><div><p className="eyebrow">LIVE ORDER RECORD</p><h1>{data.orderNumber}</h1><p>Placed {formatIst(data.createdAt, { dateStyle: 'full', timeStyle: 'short' })}</p></div><div className={styles.pills}><StatusPill tone={tone(data.status)}>{label(data.status)}</StatusPill><StatusPill tone={tone(data.paymentStatus)}>{label(data.paymentStatus)} · {data.paymentMethod.toUpperCase()}</StatusPill></div></header>
    <section className={styles.notice}><CircleAlert size={18} aria-hidden="true" /><span>Transitions use the order’s current backend version and wait for the server. Shipping and returns remain in their dedicated verified workflows.</span></section>
    <div className={styles.grid}><Card title="Items" className={styles.items!}><table><thead><tr><th>Item</th><th>SKU</th><th>Qty</th><th>Total</th></tr></thead><tbody>{data.lines.map((line) => <tr key={`${line.sku}-${line.variantTitle}`}><td><strong>{line.productName}</strong><small>{line.variantTitle} · {formatMoney(line.unitPricePaise)} each</small></td><td>{line.sku}</td><td>{line.quantity}</td><td>{formatMoney(line.lineTotalPaise)}</td></tr>)}</tbody></table></Card><MoneyBreakdown order={data} /><AddressCard order={data} operator={operator} /><Actions order={data} operator={operator} /></div>
    <div className={styles.lower}><Card title="Payment attempts" className={styles.attempts!}>{data.paymentAttempts.length ? <ul>{data.paymentAttempts.map((attempt) => <li key={attempt.id}><ReceiptText size={16} aria-hidden="true" /><span>{label(attempt.status)} · {formatMoney(attempt.amountPaise)} · {attempt.provider}</span><time dateTime={attempt.createdAt}>{formatRelativeIst(attempt.createdAt)}</time></li>)}</ul> : <EmptyState title="No payment attempts">This order has no recorded provider attempt.</EmptyState>}</Card><Refunds order={data} /><Notes id={id} notes={notes} /></div>
    <OrderTimeline order={data} />
    {can(operator, 'orders:read') ? <OrderInvoiceAction id={id} status={data.status} canIssue={can(operator, 'orders:fulfil')} /> : null}
  </section>;
}

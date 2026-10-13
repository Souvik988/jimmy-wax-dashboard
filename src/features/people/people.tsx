'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { Loadable, PageHeader, kit, labelOf, toneOf, useNotice } from '@/components/kit/kit';
import { Badge, Button, Checkbox, Input, Select, Textarea } from '@/components/ui/core';
import { ConfirmDialog, Drawer, ReasonDialog } from '@/components/ui/overlays';
import { queryKeys } from '@/lib/api/query-keys';
import {
  type Review, blockCustomer, getCustomer, listCustomers, listReviews, moderateReview, moderateReviewPhoto, revealCustomer, updateCustomerNotes, type Reveal,
} from '@/lib/api/resources/admin-ops';
import { apiDownload, downloadBlob } from '@/lib/api/client';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { formatMoney } from '@/lib/format/money';
import { formatIst } from '@/lib/format/time';

function CustomerDrawer({ id, canWrite, onClose }: { id: string; canWrite: boolean; onClose: () => void }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const detail = useQuery({ queryKey: queryKeys.customers.detail(id), queryFn: ({ signal }) => getCustomer(id, signal) });
  const [notes, setNotes] = useState<string | null>(null);
  const [tags, setTags] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [dialog, setDialog] = useState<'reveal' | 'block' | null>(null);
  const customer = detail.data;
  const refresh = (): void => { void queryClient.invalidateQueries({ queryKey: queryKeys.customers.all }); };

  const saveNotes = useMutation({
    mutationFn: () => updateCustomerNotes(id, { notes: notes ?? customer?.notes ?? '', tags: (tags ?? customer?.tags.join(', ') ?? '').split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean) }),
    onSuccess: () => { notice.success('Notes and tags saved.'); setNotes(null); setTags(null); refresh(); },
    onError: notice.failure,
  });
  const doReveal = useMutation({
    mutationFn: (reason: string) => revealCustomer(id, reason),
    onSuccess: (data) => { setReveal(data); setDialog(null); notice.success('Contact details revealed. This access was written to the audit log.'); },
    onError: (error) => { setDialog(null); notice.failure(error); },
  });
  const doBlock = useMutation({
    mutationFn: (reason: string) => blockCustomer(id, !customer?.blocked, reason),
    onSuccess: () => { setDialog(null); notice.success(customer?.blocked ? 'Customer unblocked.' : 'Customer blocked from placing orders.'); refresh(); },
    onError: (error) => { setDialog(null); notice.failure(error); },
  });

  return <Drawer open onOpenChange={(open) => { if (!open) onClose(); }} title="Customer">
    <div className={kit.drawerBody}>
      {notice.element}
      <Loadable query={detail} noun="Customer">
        {customer ? <>
          <dl className={kit.kv}>
            <dt>Name</dt><dd>{reveal?.name ?? (customer.name || '—')}</dd>
            <dt>Email</dt><dd>{reveal?.email ?? customer.email ?? '—'}</dd>
            <dt>Phone</dt><dd>{reveal?.phone ?? customer.phone ?? '—'}</dd>
            <dt>Status</dt><dd><Badge tone={customer.blocked ? 'negative' : 'positive'}>{customer.blocked ? 'Blocked' : 'Active'}</Badge>{customer.blockedReason ? ` — ${customer.blockedReason}` : ''}</dd>
            <dt>Orders</dt><dd>{customer.orders} · lifetime {formatMoney(customer.lifetimeSpendPaise)}</dd>
            <dt>Joined</dt><dd>{formatIst(customer.joinedAt, { dateStyle: 'medium' })}</dd>
            <dt>Saved addresses</dt><dd>{customer.addressCount}</dd>
          </dl>
          {reveal ? <section aria-label="Revealed addresses"><h3>Addresses</h3>{reveal.addresses.map((address, index) => <p key={index} className={kit.muted}>{address.name} · {address.line1}{address.landmark ? `, ${address.landmark}` : ''}, {address.city}, {address.state} {address.pin} · {address.phone}</p>)}</section> : null}
          <div className={kit.actions}>
            <Button variant="secondary" disabled={Boolean(reveal)} onClick={() => setDialog('reveal')}>Reveal contact details</Button>
            {canWrite ? <Button variant={customer.blocked ? 'secondary' : 'danger'} onClick={() => setDialog('block')}>{customer.blocked ? 'Unblock customer' : 'Block customer'}</Button> : null}
          </div>
          <Textarea label="Internal notes" value={notes ?? customer.notes} maxLength={2000} disabled={!canWrite} onChange={(event) => setNotes(event.target.value)} description="Visible to staff only. Do not store payment details here." />
          <Input label="Tags (comma separated)" value={tags ?? customer.tags.join(', ')} disabled={!canWrite} onChange={(event) => setTags(event.target.value)} />
          {canWrite ? <Button loading={saveNotes.isPending} disabled={notes === null && tags === null} onClick={() => saveNotes.mutate()}>Save notes</Button> : null}
          <h3>Recent orders</h3>
          <ul className={kit.rows}>{customer.recentOrders.map((order) => <li key={order.id} className={kit.row}><Link href={`/orders/${order.id}`}>{order.orderNumber}</Link><Badge tone={toneOf(order.status)}>{labelOf(order.status)}</Badge><span>{formatMoney(order.totalPaise)}</span></li>)}</ul>
        </> : null}
      </Loadable>
      <ReasonDialog open={dialog === 'reveal'} onOpenChange={(open) => { if (!open) setDialog(null); }} pending={doReveal.isPending} title="Reveal contact details" onConfirm={(reason) => doReveal.mutate(reason)}>Contact details are masked by default. Revealing is recorded in the audit log with your reason.</ReasonDialog>
      <ReasonDialog open={dialog === 'block'} onOpenChange={(open) => { if (!open) setDialog(null); }} pending={doBlock.isPending} title={customer?.blocked ? 'Unblock customer' : 'Block customer'} onConfirm={(reason) => doBlock.mutate(reason)}>{customer?.blocked ? 'The customer will be able to order again.' : 'The customer will be prevented from placing orders. Requires verified identity.'}</ReasonDialog>
    </div>
  </Drawer>;
}

export function CustomersPanel({ canWrite, canExport = false }: { canWrite: boolean; canExport?: boolean }): ReactNode {
  const exportNotice = useNotice();
  const [exportOpen, setExportOpen] = useState(false);
  const exportCsv = useMutation({
    mutationFn: () => apiDownload('admin/exports/customers.csv'),
    onSuccess: (file) => { downloadBlob(file); setExportOpen(false); exportNotice.success('Customer export downloaded. It contains personal data — store it securely and delete it when finished.'); },
    onError: (error) => { setExportOpen(false); exportNotice.failure(error); },
  });
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { const t = window.setTimeout(() => setQ(search.trim()), 300); return () => window.clearTimeout(t); }, [search]);
  const filters = { q: q || undefined, blocked: blocked || undefined };
  const list = useCursorList(['customers', 'list'], filters, (f, cursor, signal) => listCustomers(f, cursor, signal));
  return <div className={kit.page}>
    <PageHeader eyebrow="Customers" title="Customers" actions={canExport ? <Button variant="secondary" onClick={() => setExportOpen(true)}>Export customers (CSV)</Button> : null}>Contact details are masked. Revealing them requires a reason and is audited.</PageHeader>
    {exportNotice.element}
    <div className={kit.toolbar}>
      <Input label="Search" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} />
      <Checkbox label="Blocked only" checked={blocked} onChange={setBlocked} />
    </div>
    <Loadable query={list} noun="Customers">
      {list.items.length === 0 ? <p className={kit.notice}>No customers match.</p> : <ul className={kit.rows} aria-label="Customers">
        {list.items.map((customer) => <li key={customer.id} className={kit.row}>
          <div><strong>{customer.name || customer.email || customer.phone || 'Unnamed customer'}</strong><br /><small>{[customer.email, customer.phone].filter(Boolean).join(' · ') || 'No contact on file'}</small></div>
          <div>{customer.blocked ? <Badge tone="negative">Blocked</Badge> : <Badge tone="positive">Active</Badge>}</div>
          <div><small>{customer.orders} order(s) · {formatMoney(customer.lifetimeSpendPaise)}</small></div>
          <div><Button variant="secondary" onClick={() => setSelected(customer.id)}>Open</Button></div>
        </li>)}
      </ul>}
      <footer className={kit.footer}><span>{list.items.length} loaded</span>{list.hasMore ? <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button> : null}</footer>
    </Loadable>
    <ConfirmDialog open={exportOpen} onOpenChange={setExportOpen} phrase="export" pending={exportCsv.isPending} title="Export customer data" onConfirm={() => exportCsv.mutate()}>This downloads personal data for every customer and is recorded in the audit log. It needs a verified identity.</ConfirmDialog>
    {selected ? <CustomerDrawer id={selected} canWrite={canWrite} onClose={() => setSelected(null)} /> : null}
  </div>;
}

export function ReviewsPanel(): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [target, setTarget] = useState<{ review: Review; approve: boolean } | null>(null);
  const reviews = useQuery({ queryKey: ['reviews', status], queryFn: ({ signal }) => listReviews(status, signal) });
  const moderate = useMutation({
    mutationFn: ({ note }: { note: string }) => moderateReview(target!.review.id, target!.approve, note),
    onSuccess: () => { notice.success(target?.approve ? 'Review approved and published.' : 'Review rejected.'); setTarget(null); void queryClient.invalidateQueries({ queryKey: ['reviews'] }); },
    onError: (error) => { setTarget(null); notice.failure(error); },
  });
  const photo = useMutation({
    mutationFn: (input: { id: string; approve: boolean }) => moderateReviewPhoto(input.id, input.approve),
    onSuccess: () => { notice.success('Photo decision recorded.'); void queryClient.invalidateQueries({ queryKey: ['reviews'] }); },
    onError: notice.failure,
  });
  return <div className={kit.page}>
    <PageHeader eyebrow="Customers" title="Review moderation">Only verified customer reviews are shown to shoppers. Never edit a review&apos;s rating or text.</PageHeader>
    {notice.element}
    <div className={kit.toolbar}>
      <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></Select>
    </div>
    <Loadable query={reviews} noun="Reviews">
      {reviews.data?.length === 0 ? <p className={kit.notice}>No {status} reviews.</p> : <ul className={kit.rows}>
        {reviews.data?.map((review) => <li key={review.id} className={kit.row}>
          <div><strong>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)} {review.title ?? ''}</strong><br /><span>{review.body}</span><br /><small>{review.productId} · {review.verifiedPurchase ? 'Verified purchase' : 'Unverified'} · {formatIst(review.createdAt, { dateStyle: 'medium' })}</small>
            {review.photos.length > 0 ? <div className={kit.actions}>{review.photos.map((p) => <span key={p.id} className={kit.actions}><Badge tone={toneOf(p.status)}>{`Photo ${labelOf(p.status)}`}</Badge>
              <Button variant="quiet" onClick={() => window.open(`/api/backend/admin/review-media/${p.id}/image`, '_blank', 'noopener,noreferrer')}>View</Button>
              {p.status === 'pending' ? <><Button variant="quiet" onClick={() => photo.mutate({ id: p.id, approve: true })}>Approve photo</Button><Button variant="quiet" onClick={() => photo.mutate({ id: p.id, approve: false })}>Reject photo</Button></> : null}</span>)}</div> : null}</div>
          <div><Badge tone={toneOf(review.status)}>{labelOf(review.status)}</Badge></div>
          <div className={kit.actions}>
            {review.status !== 'approved' ? <Button onClick={() => setTarget({ review, approve: true })}>Approve</Button> : null}
            {review.status !== 'rejected' ? <Button variant="secondary" onClick={() => setTarget({ review, approve: false })}>Reject</Button> : null}
          </div>
        </li>)}
      </ul>}
    </Loadable>
    <ReasonDialog open={Boolean(target)} onOpenChange={(open) => { if (!open) setTarget(null); }} pending={moderate.isPending} title={target?.approve ? 'Approve review' : 'Reject review'} onConfirm={(note) => moderate.mutate({ note })}>Add a short internal note for the moderation record.</ReasonDialog>
  </div>;
}

'use client';

/* eslint-disable @typescript-eslint/no-explicit-any -- passthrough backend payloads are intentionally loosely typed */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Loadable, PageHeader, kit, labelOf, toneOf, useNotice } from '@/components/kit/kit';
import { Badge, Button, Checkbox, Input, Select, Switch, Textarea } from '@/components/ui/core';
import { ConfirmDialog, Drawer } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import {
  type Coupon, type CouponInput, type MessageTemplate, createCoupon, deactivateCoupon, getCouponAnalytics, listCoupons, listTemplates, resetTemplate, saveTemplate,
  testTemplate, updateCoupon, listEmailOutbox,
} from '@/lib/api/resources/admin-ops';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { formatMoney, parseRupeesToPaise } from '@/lib/format/money';
import { formatIst } from '@/lib/format/time';

type CouponForm = { code: string; description: string; kind: CouponInput['kind']; value: string; minOrder: string; maxDiscount: string; startsAt: string; endsAt: string; totalLimit: string; perCustomer: string; firstOrderOnly: boolean; products: string; active: boolean };
const blankCoupon: CouponForm = { code: '', description: '', kind: 'percentage', value: '', minOrder: '0', maxDiscount: '', startsAt: '', endsAt: '', totalLimit: '', perCustomer: '1', firstOrderOnly: false, products: '', active: true };

/** Pure: form → API payload, with field-level problems (percentage in %, money in rupees). */
export function couponPayload(form: CouponForm, editing: boolean): { input: CouponInput } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const input: CouponInput = { code: form.code.trim().toUpperCase(), description: form.description.trim(), kind: form.kind, usageLimitPerCustomer: Number(form.perCustomer) || 1, firstOrderOnly: form.firstOrderOnly, active: form.active };
  if (!editing && !/^[A-Z0-9][A-Z0-9_-]{2,31}$/u.test(input.code)) errors['code'] = '3–32 characters: letters, digits, - or _.';
  if (form.kind === 'percentage') {
    const pct = Number(form.value);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) errors['value'] = 'Enter a percentage between 0.01 and 100.'; else input.valueBps = Math.round(pct * 100);
  } else if (form.kind === 'flat') {
    const paise = parseRupeesToPaise(form.value);
    if (!paise || paise < 1) errors['value'] = 'Enter an amount in rupees.'; else input.valuePaise = paise;
  }
  const min = parseRupeesToPaise(form.minOrder || '0'); if (min === null) errors['minOrder'] = 'Enter a rupee amount.'; else input.minOrderPaise = min;
  if (form.maxDiscount) { const max = parseRupeesToPaise(form.maxDiscount); if (!max) errors['maxDiscount'] = 'Enter a rupee amount.'; else input.maxDiscountPaise = max; }
  if (form.startsAt) input.startsAt = new Date(form.startsAt).toISOString();
  if (form.endsAt) input.endsAt = new Date(form.endsAt).toISOString();
  if (input.startsAt && input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) errors['endsAt'] = 'Must be after the start.';
  if (form.totalLimit) { const n = Number(form.totalLimit); if (!Number.isInteger(n) || n < 1) errors['totalLimit'] = 'Whole number, at least 1.'; else input.usageLimitTotal = n; }
  input.scopeProductIds = form.products.split(',').map((id) => id.trim()).filter(Boolean);
  return Object.keys(errors).length ? { errors } : { input };
}

function describe(coupon: Coupon): string {
  const c = coupon as Record<string, any>;
  if (c['kind'] === 'percentage') return `${(c['valueBps'] ?? 0) / 100}% off`;
  if (c['kind'] === 'flat') return `${formatMoney(c['valuePaise'] ?? 0)} off`;
  return 'Free shipping';
}

export function CouponsPanel({ canWrite }: { canWrite: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const [status, setStatus] = useState('');
  const [form, setForm] = useState<CouponForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deactivate, setDeactivate] = useState<Coupon | null>(null);
  const list = useCursorList(['coupons', 'list'], { status: status || undefined }, (f, cursor, signal) => listCoupons(f.status, cursor, signal));
  const analytics = useQuery({ queryKey: ['coupons', 'analytics'], queryFn: ({ signal }) => getCouponAnalytics(signal) });
  const refresh = (): void => { void queryClient.invalidateQueries({ queryKey: ['coupons'] }); };

  const save = useMutation({
    mutationFn: (input: CouponInput) => { if (editingId) { const { code: _c, ...patch } = input; return updateCoupon(editingId, patch); } return createCoupon(input); },
    onSuccess: () => { notice.success(editingId ? 'Coupon updated.' : 'Coupon created.'); setForm(null); setEditingId(null); refresh(); },
    onError: (error) => { if (error instanceof ApiError && error.fields) setErrors(error.fields); notice.failure(error); },
  });
  const off = useMutation({
    mutationFn: (id: string) => deactivateCoupon(id),
    onSuccess: () => { setDeactivate(null); notice.success('Coupon deactivated. Carts holding it will no longer apply it.'); refresh(); },
    onError: (error) => { setDeactivate(null); notice.failure(error); },
  });

  const edit = (coupon: Coupon): void => {
    const c = coupon as Record<string, any>;
    setEditingId(coupon.id); setErrors({});
    setForm({ code: coupon.code, description: c['description'] ?? '', kind: c['kind'], value: c['kind'] === 'percentage' ? String((c['valueBps'] ?? 0) / 100) : c['valuePaise'] ? String(c['valuePaise'] / 100) : '', minOrder: String((c['minOrderPaise'] ?? 0) / 100), maxDiscount: c['maxDiscountPaise'] ? String(c['maxDiscountPaise'] / 100) : '', startsAt: c['startsAt'] ? new Date(c['startsAt']).toISOString().slice(0, 16) : '', endsAt: c['endsAt'] ? new Date(c['endsAt']).toISOString().slice(0, 16) : '', totalLimit: c['usageLimitTotal'] ? String(c['usageLimitTotal']) : '', perCustomer: String(c['usageLimitPerCustomer'] ?? 1), firstOrderOnly: Boolean(c['firstOrderOnly']), products: (c['scopeProductIds'] ?? []).join(', '), active: c['active'] !== false });
  };
  const submit = (): void => {
    if (!form) return;
    const result = couponPayload(form, Boolean(editingId));
    if ('errors' in result) { setErrors(result.errors); return; }
    setErrors({}); save.mutate(result.input);
  };

  return <div className={kit.page}>
    <PageHeader eyebrow="Marketing" title="Coupons" actions={<Button disabled={!canWrite} onClick={() => { setForm(blankCoupon); setEditingId(null); setErrors({}); notice.clear(); }}>New coupon</Button>}>
      Discounts are computed by the backend at checkout and can never push a total below zero. Value and type freeze once a coupon has been redeemed.
    </PageHeader>
    {notice.element}
    <section className={kit.grid} aria-label="Coupon performance">
      <div className={kit.stat}><span>Redemptions</span><strong>{analytics.data?.redemptions ?? '—'}</strong></div>
      <div className={kit.stat}><span>Discount given</span><strong>{analytics.data ? formatMoney(analytics.data.discountGivenPaise) : '—'}</strong></div>
      <div className={kit.stat}><span>Order revenue with a coupon</span><strong>{analytics.data ? formatMoney(analytics.data.orderRevenuePaise) : '—'}</strong></div>
    </section>
    <div className={kit.toolbar}>
      <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All</option>{['live', 'scheduled', 'expired', 'exhausted', 'inactive'].map((s) => <option key={s} value={s}>{labelOf(s)}</option>)}</Select>
    </div>
    <Loadable query={list} noun="Coupons">
      {list.items.length === 0 ? <p className={kit.notice}>No coupons.</p> : <ul className={kit.rows}>
        {list.items.map((coupon) => { const c = coupon as Record<string, any>; return <li key={coupon.id} className={kit.row}>
          <div><strong>{coupon.code}</strong><br /><small>{describe(coupon)} · min {formatMoney(c['minOrderPaise'] ?? 0)} · used {c['usedCount'] ?? c['redemptions'] ?? 0}{c['usageLimitTotal'] ? `/${c['usageLimitTotal']}` : ''}</small></div>
          <div><Badge tone={toneOf(String(c['status'] ?? (c['active'] ? 'live' : 'inactive')))}>{labelOf(String(c['status'] ?? (c['active'] ? 'live' : 'inactive')))}</Badge></div>
          <div><small>{c['endsAt'] ? `Ends ${formatIst(c['endsAt'], { dateStyle: 'medium' })}` : 'No end date'}</small></div>
          <div className={kit.actions}><Button variant="secondary" onClick={() => edit(coupon)}>{canWrite ? 'Edit' : 'View'}</Button>{canWrite && c['active'] !== false ? <Button variant="quiet" onClick={() => setDeactivate(coupon)}>Deactivate</Button> : null}</div>
        </li>; })}
      </ul>}
      <footer className={kit.footer}><span>{list.items.length} loaded</span>{list.hasMore ? <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button> : null}</footer>
    </Loadable>
    {form ? <Drawer open onOpenChange={(open) => { if (!open) { setForm(null); setEditingId(null); } }} title={editingId ? 'Edit coupon' : 'New coupon'}>
      <div className={kit.drawerBody}>
        <div className={kit.formGrid}>
          <Input label="Code" value={form.code} disabled={Boolean(editingId) || !canWrite} maxLength={32} error={errors['code']} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} />
          <Select label="Type" value={form.kind} disabled={!canWrite} onChange={(event) => setForm({ ...form, kind: event.target.value as CouponForm['kind'] })}><option value="percentage">Percentage</option><option value="flat">Flat amount</option><option value="free_shipping">Free shipping</option></Select>
          {form.kind !== 'free_shipping' ? <Input label={form.kind === 'percentage' ? 'Percent off (%)' : 'Amount off (₹)'} inputMode="decimal" value={form.value} disabled={!canWrite} error={errors['value'] ?? errors['valueBps'] ?? errors['valuePaise']} onChange={(event) => setForm({ ...form, value: event.target.value })} /> : null}
          <Input label="Minimum order (₹)" inputMode="decimal" value={form.minOrder} disabled={!canWrite} error={errors['minOrder'] ?? errors['minOrderPaise']} onChange={(event) => setForm({ ...form, minOrder: event.target.value })} />
          {form.kind === 'percentage' ? <Input label="Maximum discount (₹, optional)" inputMode="decimal" value={form.maxDiscount} disabled={!canWrite} error={errors['maxDiscount']} onChange={(event) => setForm({ ...form, maxDiscount: event.target.value })} /> : null}
          <Input label="Starts (optional)" type="datetime-local" value={form.startsAt} disabled={!canWrite} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} />
          <Input label="Ends (optional)" type="datetime-local" value={form.endsAt} disabled={!canWrite} error={errors['endsAt']} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} />
          <Input label="Total uses (optional)" inputMode="numeric" value={form.totalLimit} disabled={!canWrite} error={errors['totalLimit'] ?? errors['usageLimitTotal']} onChange={(event) => setForm({ ...form, totalLimit: event.target.value })} />
          <Input label="Uses per customer" inputMode="numeric" value={form.perCustomer} disabled={!canWrite} onChange={(event) => setForm({ ...form, perCustomer: event.target.value })} />
        </div>
        <Input label="Limit to product ids (comma separated, optional)" value={form.products} disabled={!canWrite} onChange={(event) => setForm({ ...form, products: event.target.value })} />
        <Textarea label="Internal description" value={form.description} maxLength={300} disabled={!canWrite} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        <Checkbox label="First order only" checked={form.firstOrderOnly} disabled={!canWrite} onChange={(firstOrderOnly) => setForm({ ...form, firstOrderOnly })} />
        <Switch label="Active" checked={form.active} disabled={!canWrite} onChange={(active) => setForm({ ...form, active })} />
        {canWrite ? <Button loading={save.isPending} onClick={submit}>{editingId ? 'Save coupon' : 'Create coupon'}</Button> : null}
      </div>
    </Drawer> : null}
    <ConfirmDialog open={Boolean(deactivate)} onOpenChange={(open) => { if (!open) setDeactivate(null); }} phrase={deactivate?.code ?? 'confirm'} pending={off.isPending} title="Deactivate coupon" onConfirm={() => deactivate && off.mutate(deactivate.id)}>
      Customers will no longer be able to use this coupon.
    </ConfirmDialog>
  </div>;
}

function TemplateEditor({ template, canWrite, onDone }: { template: MessageTemplate; canWrite: boolean; onDone: () => void }): ReactNode {
  const notice = useNotice();
  const start = template.override ?? { ...template.default, enabled: true };
  const [subject, setSubject] = useState(start.subject);
  const [body, setBody] = useState(start.body);
  const [enabled, setEnabled] = useState(template.override?.enabled ?? true);
  const [preview, setPreview] = useState<{ subject: string; body: string; sent: boolean; sender: string } | null>(null);
  const unknown = [...(subject + body).matchAll(/\{\{\s*(\w+)\s*\}\}/gu)].map((m) => m[1]!).filter((name) => !template.variables.includes(name));
  const save = useMutation({ mutationFn: () => saveTemplate(template.key, { subject, body, enabled }), onSuccess: () => { notice.success('Template saved.'); onDone(); }, onError: notice.failure });
  const reset = useMutation({ mutationFn: () => resetTemplate(template.key), onSuccess: () => { notice.success('Reset to the built-in message.'); onDone(); }, onError: notice.failure });
  const test = useMutation({ mutationFn: (send: boolean) => testTemplate(template.key, { subject, body, send }), onSuccess: setPreview, onError: notice.failure });
  return <div className={kit.drawerBody}>
    {notice.element}
    <p className={kit.muted}>Placeholders: {template.variables.map((v) => `{{${v}}}`).join(' ')}</p>
    <Input label="Subject" value={subject} maxLength={200} disabled={!canWrite} onChange={(event) => setSubject(event.target.value)} />
    <Textarea label="Body" rows={10} value={body} maxLength={8000} disabled={!canWrite} onChange={(event) => setBody(event.target.value)} error={unknown.length ? `Unknown placeholder: ${[...new Set(unknown)].join(', ')}` : undefined} />
    <Switch label="Use this custom message" checked={enabled} disabled={!canWrite} onChange={setEnabled} />
    <div className={kit.actions}>
      {canWrite ? <Button loading={save.isPending} disabled={unknown.length > 0} onClick={() => save.mutate()}>Save</Button> : null}
      <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate(false)}>Preview with sample data</Button>
      {canWrite ? <Button variant="secondary" onClick={() => test.mutate(true)}>Send test to me</Button> : null}
      {canWrite && template.override ? <Button variant="quiet" loading={reset.isPending} onClick={() => reset.mutate()}>Reset to default</Button> : null}
    </div>
    {preview ? <section aria-label="Preview"><h3>{preview.subject}</h3><pre className={kit.pre}>{preview.body}</pre><p className={kit.muted}>{preview.sent ? 'A test email was sent to your address.' : `Preview only (sender: ${preview.sender}).`}</p></section> : null}
  </div>;
}

export function MessagingPanel({ canWrite, canOps }: { canWrite: boolean; canOps: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const templates = useQuery({ queryKey: ['templates'], queryFn: ({ signal }) => listTemplates(signal) });
  const outbox = useQuery({ queryKey: ['templates', 'outbox'], queryFn: ({ signal }) => listEmailOutbox(signal), enabled: canOps });
  const [open, setOpen] = useState<MessageTemplate | null>(null);
  return <div className={kit.page}>
    <PageHeader eyebrow="Marketing" title="Message templates">Customer emails. Customised messages replace the built-in text; unknown placeholders are rejected. Editing requires a verified identity.</PageHeader>
    <Loadable query={templates} noun="Templates">
      <ul className={kit.rows}>{templates.data?.map((template) => <li key={template.key} className={kit.row}>
        <div><strong>{template.key}</strong><br /><small>{(template.override?.subject ?? template.default.subject)}</small></div>
        <div><Badge tone={template.override?.enabled ? 'info' : 'neutral'}>{template.override?.enabled ? 'Customised' : 'Built-in'}</Badge></div>
        <div><Button variant="secondary" onClick={() => setOpen(template)}>{canWrite ? 'Edit' : 'View'}</Button></div>
      </li>)}</ul>
    </Loadable>
    {canOps ? <section className={kit.stack}><h2>Recent email deliveries</h2><Loadable query={outbox} noun="Email deliveries"><ul className={kit.rows}>{outbox.data?.map((mail) => <li key={mail.id} className={kit.row}><span>{mail.template}</span><Badge tone={toneOf(mail.status)}>{labelOf(mail.status)}</Badge><small>{formatIst(mail.createdAt, { dateStyle: 'medium', timeStyle: 'short' })} IST</small></li>)}</ul></Loadable></section> : null}
    {open ? <Drawer open onOpenChange={(o) => { if (!o) setOpen(null); }} title={`Template: ${open.key}`}><TemplateEditor key={open.key} template={open} canWrite={canWrite} onDone={() => { setOpen(null); void queryClient.invalidateQueries({ queryKey: ['templates'] }); }} /></Drawer> : null}
  </div>;
}

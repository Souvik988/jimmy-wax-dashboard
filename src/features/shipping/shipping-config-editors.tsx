'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { kit, useNotice } from '@/components/kit/kit';
import { Button, Checkbox, Input, Select, Switch, Textarea } from '@/components/ui/core';
import { Dialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { type ShippingPinList, type ShippingSettings, updateShippingPins, updateShippingSettings } from '@/lib/api/resources/shipping';

import {
  type SettingsChange, type SettingsDraft, buildPinChange, buildSettingsPatch, courierRules, isRiskySettingsChange, settingsDraftFrom,
} from './shipping-config-model';

const reasonLength = (reason: string): number => [...reason.trim()].length;

function ReviewDialog({ open, onOpenChange, title, intro, rows, warning, pending, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; intro: string;
  rows: ReadonlyArray<{ key: string; label: string; from: string; to: string }>; warning?: string | undefined; pending: boolean; onConfirm: (reason: string) => void;
}): ReactNode {
  const [reason, setReason] = useState('');
  const valid = reasonLength(reason) >= 3 && reasonLength(reason) <= 300;
  return <Dialog open={open} onOpenChange={onOpenChange} title={title} footer={<>
    <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
    <Button loading={pending} disabled={!valid} onClick={() => onConfirm(reason.trim())}>Apply change</Button>
  </>}>
    <p>{intro}</p>
    <ul className={kit.rows} aria-label="Changes to apply">
      {rows.map((row) => <li key={row.key} className={kit.row}><strong>{row.label}</strong><span>{row.from} → {row.to}</span></li>)}
    </ul>
    {warning ? <p className={`${kit.notice} ${kit.danger}`} role="alert">{warning}</p> : null}
    <Textarea label="Reason (saved in the audit log)" value={reason} minLength={3} maxLength={300} required onChange={(event) => setReason(event.target.value)} description={`${[...reason].length}/300 characters`} />
  </Dialog>;
}

function conflictAware(error: unknown, what: string): unknown {
  return error instanceof ApiError && error.status === 409
    ? new ApiError(409, 'CONFLICT', `${what} changed since you loaded it. The latest values were reloaded and nothing was applied; review them and try again.`, error.requestId)
    : error;
}

export function ShippingSettingsEditor({ settings }: { settings: ShippingSettings }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  // Snapshot taken when editing starts: the diff and the version stamp must not move under the operator.
  const [base, setBase] = useState<ShippingSettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);

  const build = draft && base ? buildSettingsPatch(base, draft) : null;
  const stamp = base?.updatedAt ?? null;
  const set = (patch: Partial<SettingsDraft>): void => { if (draft) { setDraft({ ...draft, ...patch }); setErrors({}); } };

  const save = useMutation({
    mutationFn: (reason: string) => {
      if (!build?.ok || !stamp) throw new Error('The settings version is not loaded; reload and try again.');
      return updateShippingSettings(build.patch, { expectedUpdatedAt: stamp, reason });
    },
    retry: false,
    onSuccess: (updated) => {
      notice.success('Shipping settings saved and recorded in the audit log.');
      queryClient.setQueryData(queryKeys.shipping.settings, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.shipping.all });
      setReviewing(false); setDraft(null); setBase(null);
    },
    onError: (error) => {
      setReviewing(false);
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      notice.failure(conflictAware(error, 'Shipping settings'));
      if (error instanceof ApiError && error.status === 409) { setDraft(null); setBase(null); void queryClient.invalidateQueries({ queryKey: queryKeys.shipping.all }); }
    },
  });

  if (!draft) return <div className={kit.stack}>
    {notice.element}
    <div className={kit.actions}><Button variant="secondary" disabled={!settings.updatedAt} onClick={() => { setBase(settings); setDraft(settingsDraftFrom(settings)); setErrors({}); notice.clear(); }}>Edit shipping settings</Button></div>
    {!settings.updatedAt ? <p className={kit.muted}>The backend did not return a version stamp, so edits are unavailable until it does.</p> : null}
  </div>;

  const review = (): void => {
    if (build && !build.ok) { setErrors(build.errors); return; }
    if (build?.ok && build.changes.length === 0) { notice.success('No changes to save.'); return; }
    setReviewing(true);
  };
  const changes: SettingsChange[] = build?.ok ? build.changes : [];

  return <form className={kit.stack} aria-label="Edit shipping settings" onSubmit={(event) => { event.preventDefault(); review(); }}>
    {notice.element}
    <Input label="Pickup location" value={draft.pickupLocation} maxLength={120} error={errors.pickupLocation} description="Must match a pickup location registered with your courier account." onChange={(event) => set({ pickupLocation: event.target.value })} />
    <Input label="Pickup PIN" value={draft.pickupPin} maxLength={6} inputMode="numeric" error={errors.pickupPin} onChange={(event) => set({ pickupPin: event.target.value.replace(/[^0-9]/gu, '') })} />
    <Input label="Default weight (g)" type="number" value={draft.defaultWeightGrams} error={errors.defaultWeightGrams} onChange={(event) => set({ defaultWeightGrams: event.target.value })} />
    <Input label="Default length (mm)" type="number" value={draft.defaultLengthMm} error={errors.defaultLengthMm} onChange={(event) => set({ defaultLengthMm: event.target.value })} />
    <Input label="Default width (mm)" type="number" value={draft.defaultWidthMm} error={errors.defaultWidthMm} onChange={(event) => set({ defaultWidthMm: event.target.value })} />
    <Input label="Default height (mm)" type="number" value={draft.defaultHeightMm} error={errors.defaultHeightMm} onChange={(event) => set({ defaultHeightMm: event.target.value })} />
    <Select label="Courier selection" value={draft.courierRule} onChange={(event) => set({ courierRule: event.target.value as SettingsDraft['courierRule'] })}>
      {courierRules.map((rule) => <option key={rule} value={rule}>{rule}</option>)}
    </Select>
    <Input label="Preferred couriers (comma separated)" value={draft.preferredCouriers} error={errors.preferredCouriers} description="Used when the selection rule is “preferred”. Up to 10." onChange={(event) => set({ preferredCouriers: event.target.value })} />
    <Input label="Bulk confirmation threshold (orders)" type="number" value={draft.bulkConfirmThreshold} error={errors.bulkConfirmThreshold} onChange={(event) => set({ bulkConfirmThreshold: event.target.value })} />
    <Input label="Stuck shipment threshold (hours)" type="number" value={draft.stuckAfterHours} error={errors.stuckAfterHours} onChange={(event) => set({ stuckAfterHours: event.target.value })} />
    <Switch label="Require provider serviceability check" checked={draft.requireProviderCheck} onChange={(checked) => set({ requireProviderCheck: checked })} />
    <Switch label="Automatic provider dispatch" checked={draft.autoShip} onChange={(checked) => set({ autoShip: checked })} />
    {errors.autoShip ? <p className={`${kit.notice} ${kit.danger}`} role="alert">{errors.autoShip}</p> : null}
    <div className={kit.actions}>
      <Button type="submit">Review changes</Button>
      <Button type="button" variant="quiet" onClick={() => { setDraft(null); setBase(null); setErrors({}); }}>Discard</Button>
    </div>
    {reviewing ? <ReviewDialog open={reviewing} onOpenChange={setReviewing} title="Review shipping settings" intro="These values change how orders are packed and dispatched. Nothing is applied until you confirm." rows={changes.map((change) => ({ key: change.field, label: change.label, from: change.from, to: change.to }))} warning={isRiskySettingsChange(changes) ? 'This enables automatic dispatch or removes the provider serviceability check, so orders may be handed to a courier without a person reviewing them.' : undefined} pending={save.isPending} onConfirm={(reason) => save.mutate(reason)} /> : null}
  </form>;
}

export function PinListEditor({ list }: { list: ShippingPinList }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState<ShippingPinList | null>(null);
  const [addText, setAddText] = useState('');
  const [note, setNote] = useState('');
  const [removals, setRemovals] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const shown = base ?? list;
  const existing = shown.items.map((item) => item.prefix);
  const build = buildPinChange(existing, addText, removals);
  const etag = shown.etag ?? null;

  const reset = (): void => { setOpen(false); setBase(null); setAddText(''); setNote(''); setRemovals(new Set()); setError(null); setReviewing(false); };
  const save = useMutation({
    mutationFn: (reason: string) => {
      if (!build.ok || !etag) throw new Error('The delivery-area version is not loaded; reload and try again.');
      return updateShippingPins({ add: build.add, remove: build.remove, ...(note.trim() ? { note: note.trim() } : {}), expectedEtag: etag, reason });
    },
    retry: false,
    onSuccess: () => {
      notice.success('Delivery areas updated and recorded in the audit log. Open quotes are re-priced against the new rules.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.shipping.all });
      reset();
    },
    onError: (failure) => {
      setReviewing(false);
      notice.failure(conflictAware(failure, 'The delivery-area list'));
      if (failure instanceof ApiError && failure.status === 409) { reset(); void queryClient.invalidateQueries({ queryKey: queryKeys.shipping.all }); }
    },
  });

  if (!open) return <div className={kit.stack}>
    {notice.element}
    <div className={kit.actions}><Button variant="secondary" disabled={!list.etag} onClick={() => { setBase(list); setOpen(true); notice.clear(); }}>Edit delivery areas</Button></div>
    {!list.etag ? <p className={kit.muted}>The backend did not return a list version, so edits are unavailable until it does.</p> : null}
  </div>;

  const toggle = (prefix: string, on: boolean): void => {
    const next = new Set(removals);
    if (on) next.add(prefix); else next.delete(prefix);
    setRemovals(next); setError(null);
  };
  const review = (): void => { if (!build.ok) { setError(build.error); return; } setError(null); setReviewing(true); };
  const rows = build.ok ? [
    ...build.add.map((prefix) => ({ key: `add-${prefix}`, label: prefix, from: 'Not serviceable', to: 'Serviceable' })),
    ...build.remove.map((prefix) => ({ key: `remove-${prefix}`, label: prefix, from: 'Serviceable', to: 'Removed' })),
  ] : [];

  return <form className={kit.stack} aria-label="Edit delivery areas" onSubmit={(event) => { event.preventDefault(); review(); }}>
    {notice.element}
    <Textarea label="Add PIN prefixes" value={addText} rows={3} description="3–6 digits each, separated by commas, spaces or new lines." onChange={(event) => { setAddText(event.target.value); setError(null); }} />
    <Input label="Note for added prefixes (optional)" value={note} maxLength={100} onChange={(event) => setNote(event.target.value)} />
    {existing.length ? <fieldset className={kit.stack}>
      <legend>Remove existing prefixes</legend>
      {existing.map((prefix) => <Checkbox key={prefix} label={`Remove ${prefix}`} checked={removals.has(prefix)} onChange={(on) => toggle(prefix, on)} />)}
    </fieldset> : null}
    {error ? <p className={`${kit.notice} ${kit.danger}`} role="alert">{error}</p> : null}
    <div className={kit.actions}>
      <Button type="submit">Review changes</Button>
      <Button type="button" variant="quiet" onClick={reset}>Discard</Button>
    </div>
    {reviewing ? <ReviewDialog open={reviewing} onOpenChange={setReviewing} title="Review delivery-area change" intro="Customers see these PIN codes as deliverable or not as soon as this is applied. This is an admin action and may ask for fresh MFA verification." rows={rows} pending={save.isPending} onConfirm={(reason) => save.mutate(reason)} /> : null}
  </form>;
}

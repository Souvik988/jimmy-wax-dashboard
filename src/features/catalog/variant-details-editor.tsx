'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { kit, useNotice } from '@/components/kit/kit';
import { Button, Input, Textarea } from '@/components/ui/core';
import { Dialog } from '@/components/ui/overlays';
import { type ProductVariant, getCatalogVariants, getProduct, updateVariant } from '@/lib/api/resources/catalog';
import { queryKeys } from '@/lib/api/query-keys';
import { ApiError } from '@/lib/api/errors';

import { type VariantDetailsDraft, buildVariantDetailsPatch, variantDetailsDraftFrom } from './variant-details-model';

/** Edits a variant's non-price details (SKU, title, package, HSN, barcode, low-stock alert, admin cost) with a reviewed, audited PATCH. */
export function VariantDetailsEditor({ productId, canWrite, canEditCost }: { productId: string; canWrite: boolean; canEditCost: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const notice = useNotice();
  const product = useQuery({ queryKey: queryKeys.catalog.product(productId), queryFn: ({ signal }) => getProduct(productId, signal) });
  const stamps = useQuery({ queryKey: queryKeys.catalog.variants, queryFn: ({ signal }) => getCatalogVariants(signal), enabled: canWrite });
  const [target, setTarget] = useState<ProductVariant | null>(null);
  const [draft, setDraft] = useState<VariantDetailsDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);

  const stamp = target ? stamps.data?.items.find((item) => item.id === target.id)?.updatedAt : undefined;
  const build = target && draft ? buildVariantDetailsPatch(target, draft, canEditCost) : null;

  const save = useMutation({
    mutationFn: () => {
      if (!target || !draft || !build?.ok || !stamp) throw new Error('The variant timestamp is not loaded; reopen the editor.');
      return updateVariant(target.id, { ...build.patch, reason: draft.reason.trim(), expectedUpdatedAt: stamp });
    },
    onSuccess: () => {
      notice.success('Variant details saved and recorded in the audit log.');
      setTarget(null); setDraft(null); setReviewing(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
    onError: (error) => {
      setReviewing(false);
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      notice.failure(error instanceof ApiError && error.status === 409 ? new ApiError(409, 'CONFLICT', 'This variant was edited by someone else. The editor reloaded the latest values; review and try again.', error.requestId) : error);
      void stamps.refetch(); void product.refetch();
    },
  });

  if (!product.data || product.data.variants.length === 0) return null;
  const open = (variant: ProductVariant): void => { setTarget(variant); setDraft(variantDetailsDraftFrom(variant)); setErrors({}); setReviewing(false); notice.clear(); };
  const update = (patch: Partial<VariantDetailsDraft>): void => { if (draft) { setDraft({ ...draft, ...patch }); setErrors({}); } };
  const review = (): void => { if (build && !build.ok) { setErrors(build.errors); return; } setReviewing(true); };
  const shown = (key: string): string | undefined => errors[key];

  return <section className={kit.stack} aria-label="Variant details">
    <h2>Variant details</h2>
    {notice.element}
    <p className={kit.muted}>Edit SKU, title, package size, HSN, barcode and the low-stock alert. Each change needs a reason and is audited. Selling price and availability are changed in the variants table above.</p>
    <ul className={kit.rows}>
      {product.data.variants.map((variant) => <li key={variant.id} className={kit.row}>
        <div><strong>{variant.title}</strong><br /><small>{variant.id} · {variant.sku}</small></div>
        <div><small>{variant.weightGrams ? `${variant.weightGrams} g` : 'No weight'} · HSN {variant.hsnCode ?? '—'}</small></div>
        <div><Button variant="secondary" disabled={!canWrite || product.data.archived || !stamps.data} onClick={() => open(variant)}>Edit details</Button></div>
      </li>)}
    </ul>
    {target && draft ? <Dialog open onOpenChange={(next) => { if (!next && !save.isPending) { setTarget(null); setDraft(null); setReviewing(false); } }} title={reviewing ? 'Review variant changes' : `Edit ${target.title}`} footer={reviewing ? <>
      <Button variant="secondary" disabled={save.isPending} onClick={() => setReviewing(false)}>Back to editing</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>
    </> : <>
      <Button variant="secondary" onClick={() => { setTarget(null); setDraft(null); }}>Cancel</Button>
      <Button onClick={review}>Review changes</Button>
    </>}>
      {reviewing && build?.ok ? <>
        <dl className={kit.kv}>{build.changes.map((change) => <><dt key={`${change.label}-t`}>{change.label}</dt><dd key={`${change.label}-d`}>{change.before} → <strong>{change.after}</strong></dd></>)}</dl>
        <p className={kit.muted}>Reason: “{draft.reason.trim()}”. If someone else edited this variant meanwhile, the backend refuses the save instead of overwriting.</p>
      </> : <div className={kit.stack}>
        <Input label="Title" value={draft.title} maxLength={80} error={shown('title')} onChange={(event) => update({ title: event.target.value })} />
        <Input label="SKU" value={draft.sku} maxLength={60} error={shown('sku')} onChange={(event) => update({ sku: event.target.value })} />
        <div className={kit.formGrid}>
          <Input label="Weight (g)" inputMode="numeric" value={draft.weightGrams} error={shown('weightGrams')} onChange={(event) => update({ weightGrams: event.target.value })} />
          <Input label="Length (mm)" inputMode="numeric" value={draft.lengthMm} error={shown('lengthMm')} onChange={(event) => update({ lengthMm: event.target.value })} />
          <Input label="Width (mm)" inputMode="numeric" value={draft.widthMm} error={shown('widthMm')} onChange={(event) => update({ widthMm: event.target.value })} />
          <Input label="Height (mm)" inputMode="numeric" value={draft.heightMm} error={shown('heightMm')} onChange={(event) => update({ heightMm: event.target.value })} />
          <Input label="HSN" value={draft.hsnCode} maxLength={8} error={shown('hsnCode')} onChange={(event) => update({ hsnCode: event.target.value })} />
          <Input label="Barcode" value={draft.barcode} maxLength={40} error={shown('barcode')} onChange={(event) => update({ barcode: event.target.value })} />
          <Input label="Low-stock alert (units)" inputMode="numeric" value={draft.lowStockThreshold} error={shown('lowStockThreshold')} onChange={(event) => update({ lowStockThreshold: event.target.value })} />
          {canEditCost ? <Input label="Cost price (₹) · Admin only" inputMode="decimal" value={draft.costPrice} error={shown('costPrice')} onChange={(event) => update({ costPrice: event.target.value })} /> : null}
        </div>
        <Textarea label="Reason for this change" value={draft.reason} maxLength={300} error={shown('reason')} onChange={(event) => update({ reason: event.target.value })} />
        {shown('_form') ? <p className={`${kit.notice} ${kit.danger}`} role="alert">{shown('_form')}</p> : null}
      </div>}
    </Dialog> : null}
  </section>;
}

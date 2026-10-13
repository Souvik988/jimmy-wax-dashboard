import type { ProductVariant, VariantPatchInput } from '@/lib/api/resources/catalog';
import { formatMoney, parseRupeesToPaise } from '@/lib/format/money';

/** Editable text drafts for a variant's non-price details (price edits keep their own reviewed flow). */
export type VariantDetailsDraft = {
  title: string; sku: string; weightGrams: string; lengthMm: string; widthMm: string; heightMm: string;
  hsnCode: string; barcode: string; lowStockThreshold: string; costPrice: string; reason: string;
};

const text = (value: number | null | undefined): string => (value === null || value === undefined ? '' : String(value));

export function variantDetailsDraftFrom(variant: ProductVariant): VariantDetailsDraft {
  return {
    title: variant.title, sku: variant.sku, weightGrams: text(variant.weightGrams), lengthMm: text(variant.lengthMm), widthMm: text(variant.widthMm),
    heightMm: text(variant.heightMm), hsnCode: variant.hsnCode ?? '', barcode: variant.barcode ?? '', lowStockThreshold: text(variant.lowStockThreshold),
    costPrice: variant.costPricePaise === null || variant.costPricePaise === undefined ? '' : String(variant.costPricePaise / 100), reason: '',
  };
}

export type DetailsBuild =
  | { ok: true; patch: Omit<VariantPatchInput, 'expectedUpdatedAt' | 'reason'>; changes: Array<{ label: string; before: string; after: string }> }
  | { ok: false; errors: Record<string, string> };

function optionalInt(value: string, min: number, max: number, label: string, errors: Record<string, string>, key: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < min || n > max) { errors[key] = `${label} must be a whole number from ${min} to ${max}.`; return undefined; }
  return n;
}

/** Sends only fields that changed. Cost is included only when the viewer can see it (admin), so a non-admin can never blank it. */
export function buildVariantDetailsPatch(variant: ProductVariant, draft: VariantDetailsDraft, canEditCost: boolean): DetailsBuild {
  const errors: Record<string, string> = {};
  const patch: Omit<VariantPatchInput, 'expectedUpdatedAt' | 'reason'> = {};
  const changes: Array<{ label: string; before: string; after: string }> = [];
  const note = (label: string, before: string, after: string): void => { changes.push({ label, before: before || 'Not set', after: after || 'Not set' }); };

  const title = draft.title.trim();
  if (title.length < 1 || title.length > 80) errors['title'] = 'Title must be 1–80 characters.';
  else if (title !== variant.title) { patch.title = title; note('Title', variant.title, title); }
  const sku = draft.sku.trim();
  if (sku.length < 2 || sku.length > 60) errors['sku'] = 'SKU must be 2–60 characters.';
  else if (sku !== variant.sku) { patch.sku = sku; note('SKU', variant.sku, sku); }

  const numeric: Array<[keyof VariantDetailsDraft, 'weightGrams' | 'lengthMm' | 'widthMm' | 'heightMm', number, string, string]> = [
    ['weightGrams', 'weightGrams', 50_000, 'Weight', ' g'], ['lengthMm', 'lengthMm', 2_000, 'Length', ' mm'], ['widthMm', 'widthMm', 2_000, 'Width', ' mm'], ['heightMm', 'heightMm', 2_000, 'Height', ' mm'],
  ];
  for (const [draftKey, field, max, label, unit] of numeric) {
    const parsed = optionalInt(draft[draftKey], 1, max, label, errors, field);
    if (parsed === undefined) continue;
    if (parsed !== variant[field]) { patch[field] = parsed; note(label, variant[field] === null ? '' : `${variant[field]}${unit}`, parsed === null ? '' : `${parsed}${unit}`); }
  }
  const hsn = draft.hsnCode.trim();
  if (hsn && !/^[0-9]{4,8}$/u.test(hsn)) errors['hsnCode'] = 'HSN must be 4–8 digits.';
  else if ((hsn || null) !== variant.hsnCode) { patch.hsnCode = hsn || null; note('HSN', variant.hsnCode ?? '', hsn); }
  const barcode = draft.barcode.trim();
  if (barcode && (barcode.length < 4 || barcode.length > 40)) errors['barcode'] = 'Barcode must be 4–40 characters.';
  else if ((barcode || null) !== variant.barcode) { patch.barcode = barcode || null; note('Barcode', variant.barcode ?? '', barcode); }

  const threshold = draft.lowStockThreshold.trim();
  if (threshold !== '' || variant.lowStockThreshold !== null) {
    if (threshold === '') { if (variant.lowStockThreshold !== null) errors['lowStockThreshold'] = 'A threshold can be changed but not cleared; enter a number (0 disables the alert).'; }
    else {
      const n = Number(threshold);
      if (!Number.isInteger(n) || n < 0 || n > 100_000) errors['lowStockThreshold'] = 'Low-stock alert must be a whole number from 0 to 100000.';
      else if (n !== variant.lowStockThreshold) { patch.lowStockThreshold = n; note('Low-stock alert', variant.lowStockThreshold === null ? '' : String(variant.lowStockThreshold), String(n)); }
    }
  }
  if (canEditCost) {
    const cost = draft.costPrice.trim();
    const before = variant.costPricePaise ?? null;
    if (cost === '') { if (before !== null) { patch.costPricePaise = null; note('Cost price', formatMoney(before, { showPaise: true }), ''); } }
    else {
      const paise = parseRupeesToPaise(cost);
      if (paise === null || paise < 0) errors['costPrice'] = 'Enter the cost in rupees.';
      else if (paise !== before) { patch.costPricePaise = paise; note('Cost price', before === null ? '' : formatMoney(before, { showPaise: true }), formatMoney(paise, { showPaise: true })); }
    }
  }
  const reason = draft.reason.trim();
  if (reason.length < 3 || reason.length > 300) errors['reason'] = 'Enter a reason of 3–300 characters.';
  if (Object.keys(errors).length) return { ok: false, errors };
  if (changes.length === 0) return { ok: false, errors: { _form: 'There are no changes to save.' } };
  return { ok: true, patch, changes };
}

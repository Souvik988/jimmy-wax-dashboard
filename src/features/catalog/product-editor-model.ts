import { z } from 'zod';

import {
  productPatchInputSchema,
  variantPatchInputSchema,
  type CatalogVariant,
  type Product,
  type ProductPatchInput,
  type VariantPatchInput,
} from '@/lib/api/resources/catalog';
import { formatMoney, parseRupeesToPaise } from '@/lib/format/money';

export type ProductEditorDraft = {
  name: string;
  subtitle: string;
  description: string;
  categoryId: string;
  keyBenefits: string;
  suitableSurfaces: string;
  boxContents: string;
  tags: string;
  seoTitle: string;
  seoDescription: string;
  sortOrder: string;
  active: boolean;
};

export type ProductChange = {
  path: string;
  label: string;
  before: string;
  after: string;
};

type ProductPatchBuildResult =
  | { ok: true; patch: ProductPatchInput | null; changes: ProductChange[] }
  | { ok: false; fieldErrors: Record<string, string> };

export type VariantPriceDraft = {
  price: string;
  compareAtPrice: string;
  active: boolean;
  reason: string;
};

export type VariantChange = {
  path: 'pricePaise' | 'comparePaise' | 'active';
  label: string;
  before: number | boolean | null;
  after: number | boolean | null;
};

type VariantPatchBuildResult =
  | { ok: true; patch: VariantPatchInput | null; changes: VariantChange[] }
  | { ok: false; fieldErrors: Record<string, string> };

const productLabels: Record<keyof ProductEditorDraft, string> = {
  name: 'Product name',
  subtitle: 'Subtitle',
  description: 'Description',
  categoryId: 'Category',
  keyBenefits: 'Key benefits',
  suitableSurfaces: 'Suitable surfaces',
  boxContents: 'Box contents',
  tags: 'Tags',
  seoTitle: 'SEO title',
  seoDescription: 'SEO description',
  sortOrder: 'Display order',
  active: 'Storefront visibility',
};

function lineValues(value: string, lowercase = false): string[] {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => lowercase ? line.toLowerCase() : line);
}

function nullableText(value: string): string | null {
  return value.trim() || null;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function printable(value: string | string[] | boolean | null): string {
  if (value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Active' : 'Inactive';
  return Array.isArray(value) ? value.join('\n') || '—' : value;
}

function productFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path[0];
    const key = typeof path === 'string' ? path : '_form';
    result[key] ??= issue.message;
  }
  return result;
}

function productValues(product: Product, draft: ProductEditorDraft) {
  return {
    name: draft.name.trim(),
    subtitle: draft.subtitle.trim(),
    description: draft.description.trim(),
    categoryId: draft.categoryId,
    keyBenefits: lineValues(draft.keyBenefits),
    suitableSurfaces: nullableText(draft.suitableSurfaces),
    boxContents: nullableText(draft.boxContents),
    tags: lineValues(draft.tags, true),
    seoTitle: nullableText(draft.seoTitle),
    seoDescription: nullableText(draft.seoDescription),
    sortOrder: draft.sortOrder.trim() ? Number(draft.sortOrder.trim()) : Number.NaN,
    active: draft.active,
    expectedVersion: product.version,
  };
}

export function productDraftFrom(product: Product): ProductEditorDraft {
  return {
    name: product.name,
    subtitle: product.subtitle,
    description: product.description,
    categoryId: product.categoryId,
    keyBenefits: product.keyBenefits.join('\n'),
    suitableSurfaces: product.suitableSurfaces ?? '',
    boxContents: product.boxContents ?? '',
    tags: product.tags.join('\n'),
    seoTitle: product.seoTitle ?? '',
    seoDescription: product.seoDescription ?? '',
    sortOrder: String(product.sortOrder),
    active: product.active,
  };
}

export function buildProductPatch(product: Product, draft: ProductEditorDraft): ProductPatchBuildResult {
  const candidate = productValues(product, draft);
  const changes: ProductChange[] = [];
  const patch: ProductPatchInput = { expectedVersion: product.version };

  const addTextChange = (path: keyof ProductEditorDraft, before: string | null, after: string | null): void => {
    if (before === after) return;
    changes.push({ path, label: productLabels[path], before: printable(before), after: printable(after) });
    if (path === 'name') patch.name = after ?? '';
    else if (path === 'subtitle') patch.subtitle = after ?? '';
    else if (path === 'description') patch.description = after ?? '';
    else if (path === 'categoryId') patch.categoryId = after ?? '';
    else if (path === 'suitableSurfaces') patch.suitableSurfaces = after;
    else if (path === 'boxContents') patch.boxContents = after;
    else if (path === 'seoTitle') patch.seoTitle = after;
    else if (path === 'seoDescription') patch.seoDescription = after;
  };

  addTextChange('name', product.name, candidate.name);
  addTextChange('subtitle', product.subtitle, candidate.subtitle);
  addTextChange('description', product.description, candidate.description);
  addTextChange('categoryId', product.categoryId, candidate.categoryId);

  if (!sameStrings(product.keyBenefits, candidate.keyBenefits)) {
    changes.push({ path: 'keyBenefits', label: productLabels.keyBenefits, before: printable(product.keyBenefits), after: printable(candidate.keyBenefits) });
    patch.keyBenefits = candidate.keyBenefits;
  }
  addTextChange('suitableSurfaces', product.suitableSurfaces, candidate.suitableSurfaces);
  addTextChange('boxContents', product.boxContents, candidate.boxContents);
  if (!sameStrings(product.tags, candidate.tags)) {
    changes.push({ path: 'tags', label: productLabels.tags, before: printable(product.tags), after: printable(candidate.tags) });
    patch.tags = candidate.tags;
  }
  addTextChange('seoTitle', product.seoTitle, candidate.seoTitle);
  addTextChange('seoDescription', product.seoDescription, candidate.seoDescription);
  if (!Number.isSafeInteger(candidate.sortOrder) || candidate.sortOrder < 0 || candidate.sortOrder > 100_000) {
    return { ok: false, fieldErrors: { sortOrder: 'Enter a whole number from 0 to 100,000.' } };
  }
  if (product.sortOrder !== candidate.sortOrder) {
    changes.push({ path: 'sortOrder', label: productLabels.sortOrder, before: String(product.sortOrder), after: String(candidate.sortOrder) });
    patch.sortOrder = candidate.sortOrder;
  }
  if (product.active !== candidate.active) {
    changes.push({ path: 'active', label: productLabels.active, before: printable(product.active), after: printable(candidate.active) });
    patch.active = candidate.active;
  }

  if (changes.length === 0) return { ok: true, patch: null, changes: [] };
  const parsed = productPatchInputSchema.safeParse(patch);
  return parsed.success
    ? { ok: true, patch: parsed.data, changes }
    : { ok: false, fieldErrors: productFieldErrors(parsed.error) };
}

export function variantPriceDraftFrom(variant: CatalogVariant): VariantPriceDraft {
  const inputValue = (paise: number | null): string => paise === null
    ? ''
    : formatMoney(paise, { showPaise: true }).replace(/^₹\s*/u, '');
  return {
    price: inputValue(variant.pricePaise),
    compareAtPrice: inputValue(variant.comparePaise),
    active: variant.active,
    reason: '',
  };
}

export function buildVariantPatch(variant: CatalogVariant, draft: VariantPriceDraft): VariantPatchBuildResult {
  const price = parseRupeesToPaise(draft.price);
  const compareAtPrice = draft.compareAtPrice.trim() === '' ? null : parseRupeesToPaise(draft.compareAtPrice);
  const fieldErrors: Record<string, string> = {};

  if (price === null || !Number.isSafeInteger(price) || price < 0) {
    fieldErrors.price = 'Enter a non-negative price with up to two decimal places.';
  }
  if (compareAtPrice === null && draft.compareAtPrice.trim() !== '') {
    fieldErrors.compareAtPrice = 'Enter a valid compare-at price or leave it blank.';
  }
  if (price !== null && compareAtPrice !== null && compareAtPrice < price) {
    fieldErrors.compareAtPrice = 'Compare-at price must be at least the selling price.';
  }
  if (Object.keys(fieldErrors).length > 0 || price === null) return { ok: false, fieldErrors };

  const normalizedCompare = draft.compareAtPrice.trim() === '' ? null : compareAtPrice;
  const changes: VariantChange[] = [];
  if (price !== variant.pricePaise) changes.push({ path: 'pricePaise', label: 'Selling price', before: variant.pricePaise, after: price });
  if (normalizedCompare !== variant.comparePaise) changes.push({ path: 'comparePaise', label: 'Compare-at price', before: variant.comparePaise, after: normalizedCompare });
  if (draft.active !== variant.active) changes.push({ path: 'active', label: 'Variant availability', before: variant.active, after: draft.active });
  if (changes.length === 0) return { ok: true, patch: null, changes: [] };

  const input = {
    ...(price !== variant.pricePaise ? { pricePaise: price } : {}),
    ...(normalizedCompare !== variant.comparePaise ? { comparePaise: normalizedCompare } : {}),
    ...(draft.active !== variant.active ? { active: draft.active } : {}),
    reason: draft.reason.trim(),
    expectedUpdatedAt: variant.updatedAt,
  };
  const parsed = variantPatchInputSchema.safeParse(input);
  return parsed.success
    ? { ok: true, patch: parsed.data, changes }
    : { ok: false, fieldErrors: { reason: parsed.error.issues[0]?.message ?? 'A reason is required.' } };
}

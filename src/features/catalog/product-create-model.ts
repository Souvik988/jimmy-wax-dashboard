import {
  productCreateInputSchema,
  productVariantCreateInputSchema,
  type ProductCreateInput,
  type ProductVariantCreateInput,
} from '@/lib/api/resources/catalog';
import { parseRupeesToPaise } from '@/lib/format/money';

export type VariantCreateDraft = {
  id: string;
  sku: string;
  title: string;
  price: string;
  compareAtPrice: string;
  weightGrams: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  hsnCode: string;
  barcode: string;
  costPrice: string;
  lowStockThreshold: string;
};

export type ProductCreateDraft = {
  id: string;
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
  variants: VariantCreateDraft[];
};

export type ProductCreateCategory = { id: string; active: boolean };
export type BuildResult<T> = { ok: true; payload: T } | { ok: false; errors: Record<string, string> };

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function parseOptionalWhole(value: string, min: number, max: number): number | undefined | null {
  if (!value.trim()) return undefined;
  if (!/^\d+$/u.test(value.trim())) return null;
  const number = Number(value.trim());
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

function parseMoney(value: string, minimum: number, maximum?: number): number | null {
  const paise = parseRupeesToPaise(value);
  if (paise === null || !Number.isSafeInteger(paise) || paise < minimum || (maximum !== undefined && paise > maximum)) return null;
  return paise;
}

function lines(value: string, maxCount: number, maxLength: number, lower = false): string[] {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => lower ? line.toLowerCase() : line).slice(0, maxCount + 1).filter((line) => line.length <= maxLength);
}

function buildVariant(draft: VariantCreateDraft, canViewCost: boolean, prefix: string): BuildResult<ProductVariantCreateInput> {
  const errors: Record<string, string> = {};
  const field = (name: string) => prefix ? `${prefix}.${name}` : name;

  if (!slugPattern.test(draft.id) || draft.id.length < 2 || draft.id.length > 100) errors[field('id')] = 'Use a unique lowercase ID with letters, numbers and hyphens (2–100 characters).';
  const sku = draft.sku.trim();
  if (sku.length < 2 || sku.length > 60) errors[field('sku')] = 'SKU must be 2–60 characters.';
  const title = draft.title.trim();
  if (title.length < 1 || title.length > 80) errors[field('title')] = 'Variant title must be 1–80 characters.';

  const pricePaise = parseMoney(draft.price, 1, 100_000_000);
  if (pricePaise === null) errors[field('price')] = 'Enter a positive price in rupees, up to ₹10,00,000, with at most two decimal places.';
  const compareAtPricePaise = draft.compareAtPrice.trim() ? parseMoney(draft.compareAtPrice, 0, 100_000_000) : null;
  if (draft.compareAtPrice.trim() && compareAtPricePaise === null) errors[field('compareAtPrice')] = 'Enter a valid compare-at price in rupees.';
  if (pricePaise !== null && compareAtPricePaise !== null && compareAtPricePaise < pricePaise) {
    errors[field('compareAtPrice')] = 'Compare-at price must not be below the selling price.';
  }

  const weightGrams = parseOptionalWhole(draft.weightGrams, 1, 50_000);
  if (weightGrams === null) errors[field('weightGrams')] = 'Weight must be a whole number from 1 to 50,000 grams.';
  const dimensions = [draft.lengthMm, draft.widthMm, draft.heightMm];
  const dimensionCount = dimensions.filter((value) => value.trim()).length;
  if (dimensionCount > 0 && dimensionCount < 3) errors[field('dimensions')] = 'Enter all three package dimensions, or leave all three blank.';
  const [lengthMm, widthMm, heightMm] = dimensions.map((value) => parseOptionalWhole(value, 1, 2_000));
  if (lengthMm === null || widthMm === null || heightMm === null) errors[field('dimensions')] = 'Each package dimension must be a whole number from 1 to 2,000 mm.';

  const hsnCode = draft.hsnCode.trim();
  if (hsnCode && !/^[0-9]{4,8}$/u.test(hsnCode)) errors[field('hsnCode')] = 'HSN must contain 4–8 digits.';
  const barcode = draft.barcode.trim();
  if (barcode && (barcode.length < 4 || barcode.length > 40)) errors[field('barcode')] = 'Barcode must be 4–40 characters.';
  const costPricePaise = draft.costPrice.trim() ? parseMoney(draft.costPrice, 0) : undefined;
  if (!canViewCost && draft.costPrice.trim()) errors[field('costPrice')] = 'Cost price is available to Admin only.';
  if (canViewCost && draft.costPrice.trim() && costPricePaise === null) errors[field('costPrice')] = 'Enter a valid cost price in rupees.';
  const lowStockThreshold = parseOptionalWhole(draft.lowStockThreshold, 0, 100_000);
  if (lowStockThreshold === null) errors[field('lowStockThreshold')] = 'Threshold must be a whole number from 0 to 100,000.';

  if (Object.keys(errors).length > 0 || pricePaise === null) return { ok: false, errors };

  const candidate = {
    id: draft.id,
    sku,
    title,
    pricePaise,
    compareAtPricePaise,
    active: false as const,
    ...(weightGrams !== undefined ? { weightGrams } : {}),
    ...(lengthMm !== undefined ? { lengthMm } : {}),
    ...(widthMm !== undefined ? { widthMm } : {}),
    ...(heightMm !== undefined ? { heightMm } : {}),
    ...(hsnCode ? { hsnCode } : {}),
    ...(barcode ? { barcode } : {}),
    ...(canViewCost && costPricePaise !== undefined ? { costPricePaise } : {}),
    ...(lowStockThreshold !== undefined ? { lowStockThreshold } : {}),
  };
  const parsed = productVariantCreateInputSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, errors: { [field('id')]: 'Variant details do not match the supported catalogue contract.' } };
  return { ok: true, payload: parsed.data };
}

export function buildVariantCreatePayload(draft: VariantCreateDraft, canViewCost: boolean): BuildResult<ProductVariantCreateInput> {
  return buildVariant(draft, canViewCost, '');
}

export function buildProductCreatePayload(
  draft: ProductCreateDraft,
  categories: ProductCreateCategory[],
  canViewCost: boolean,
): BuildResult<ProductCreateInput> {
  const errors: Record<string, string> = {};
  if (!slugPattern.test(draft.id) || draft.id.length < 2 || draft.id.length > 100) errors.id = 'Use a unique lowercase product ID with letters, numbers and hyphens (2–100 characters).';
  const name = draft.name.trim();
  if (name.length < 2 || name.length > 160) errors.name = 'Product name must be 2–160 characters.';
  if (draft.subtitle.trim().length > 200) errors.subtitle = 'Subtitle must be no longer than 200 characters.';
  if (draft.description.trim().length > 5_000) errors.description = 'Description must be no longer than 5,000 characters.';
  const category = categories.find((item) => item.id === draft.categoryId && item.active);
  if (!category) errors.categoryId = 'Choose an active category returned by the backend.';

  const benefits = lines(draft.keyBenefits, 10, 120);
  if (benefits.length > 10 || draft.keyBenefits.split(/\r?\n/u).filter((line) => line.trim()).some((line) => line.trim().length > 120)) errors.keyBenefits = 'Enter up to 10 benefits, each no longer than 120 characters.';
  const tags = lines(draft.tags, 20, 40, true);
  if (tags.length > 20 || draft.tags.split(/\r?\n/u).filter((line) => line.trim()).some((line) => line.trim().length > 40)) errors.tags = 'Enter up to 20 tags, each no longer than 40 characters.';
  if (draft.suitableSurfaces.trim().length > 1_000) errors.suitableSurfaces = 'Suitable surfaces must be no longer than 1,000 characters.';
  if (draft.boxContents.trim().length > 1_000) errors.boxContents = 'Box contents must be no longer than 1,000 characters.';
  if (draft.seoTitle.trim().length > 120) errors.seoTitle = 'SEO title must be no longer than 120 characters.';
  if (draft.seoDescription.trim().length > 320) errors.seoDescription = 'SEO description must be no longer than 320 characters.';
  const sortOrder = parseOptionalWhole(draft.sortOrder, 0, 100_000);
  if (sortOrder === null) errors.sortOrder = 'Display order must be a whole number from 0 to 100,000.';
  if (draft.variants.length < 1 || draft.variants.length > 20) errors.variants = 'A product needs 1–20 variants.';

  const variants = draft.variants.map((variant, index) => buildVariant(variant, canViewCost, `variants.${index}`));
  variants.forEach((variant) => {
    if (!variant.ok) Object.assign(errors, variant.errors);
  });
  const validVariants = variants.flatMap((variant) => variant.ok ? [variant.payload] : []);
  if (validVariants.length === draft.variants.length) {
    if (new Set(validVariants.map((variant) => variant.id)).size !== validVariants.length) errors.variants = 'Variant IDs must be unique within the product.';
    if (new Set(validVariants.map((variant) => variant.sku.toLowerCase())).size !== validVariants.length) errors.variants = 'Variant SKUs must be unique within the product.';
  }

  if (Object.keys(errors).length > 0 || sortOrder === undefined || validVariants.length !== draft.variants.length) return { ok: false, errors };

  const candidate = {
    id: draft.id,
    name,
    subtitle: draft.subtitle.trim(),
    description: draft.description.trim(),
    categoryId: draft.categoryId,
    keyBenefits: benefits,
    suitableSurfaces: draft.suitableSurfaces.trim() || null,
    boxContents: draft.boxContents.trim() || null,
    tags,
    seoTitle: draft.seoTitle.trim() || null,
    seoDescription: draft.seoDescription.trim() || null,
    active: false as const,
    sortOrder,
    variants: validVariants,
    media: [],
  };
  const parsed = productCreateInputSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, errors: { _form: 'Product details do not match the supported catalogue contract.' } };
  return { ok: true, payload: parsed.data };
}

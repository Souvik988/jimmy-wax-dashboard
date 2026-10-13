'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { FormLeaveGuard } from '@/components/forms/draft-protection';
import { Badge, Button, Input, Select, Textarea } from '@/components/ui/core';
import { Card, EmptyState, ErrorState, NotAllowedState, OfflineState, Skeleton } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { createProduct, getCategories, getProduct, type Category, type ProductCreateInput } from '@/lib/api/resources/catalog';
import { formatMoney } from '@/lib/format/money';

import { buildProductCreatePayload, type ProductCreateDraft, type VariantCreateDraft } from './product-create-model';
import styles from './product-create.module.css';

function emptyVariant(): VariantCreateDraft {
  return { id: '', sku: '', title: '', price: '', compareAtPrice: '', weightGrams: '', lengthMm: '', widthMm: '', heightMm: '', hsnCode: '', barcode: '', costPrice: '', lowStockThreshold: '' };
}

function emptyDraft(): ProductCreateDraft {
  return {
    id: '', name: '', subtitle: '', description: '', categoryId: '', keyBenefits: '', suitableSurfaces: '',
    boxContents: '', tags: '', seoTitle: '', seoDescription: '', sortOrder: '0', variants: [emptyVariant(), emptyVariant()],
  };
}

function apiError(error: unknown): ApiError | null {
  return error instanceof ApiError ? error : null;
}

function uncertain(error: unknown): boolean {
  const parsed = apiError(error);
  return parsed ? parsed.status === 0 || parsed.status >= 500 : true;
}

function requestReference(error: unknown): string {
  const parsed = apiError(error);
  return parsed?.requestId ? ` Request ID: ${parsed.requestId}` : '';
}

function priceText(paise: number | null): string {
  return paise === null ? 'Not set' : formatMoney(paise, { showPaise: true });
}

function reviewProductRows(product: ProductCreateInput): React.ReactNode {
  return <>
    <dl className={styles.reviewRows}>
      <div><dt>Product ID</dt><dd><code>{product.id}</code></dd></div>
      <div><dt>Name</dt><dd>{product.name}</dd></div>
      <div><dt>Subtitle</dt><dd>{product.subtitle || 'Not set'}</dd></div>
      <div><dt>Description</dt><dd>{product.description || 'Not set'}</dd></div>
      <div><dt>Category ID</dt><dd><code>{product.categoryId}</code></dd></div>
      <div><dt>Key benefits</dt><dd>{product.keyBenefits.join(' · ') || 'Not set'}</dd></div>
      <div><dt>Suitable surfaces</dt><dd>{product.suitableSurfaces || 'Not set'}</dd></div>
      <div><dt>Box contents</dt><dd>{product.boxContents || 'Not set'}</dd></div>
      <div><dt>Tags</dt><dd>{product.tags.join(', ') || 'Not set'}</dd></div>
      <div><dt>SEO title</dt><dd>{product.seoTitle || 'Not set'}</dd></div>
      <div><dt>SEO description</dt><dd>{product.seoDescription || 'Not set'}</dd></div>
      <div><dt>Display order</dt><dd>{product.sortOrder}</dd></div>
      <div><dt>Storefront state</dt><dd><Badge>Inactive · not available for purchase</Badge></dd></div>
    </dl>
    <h3 className={styles.reviewHeading}>Variants · all inactive</h3>
    <ol className={styles.reviewVariants}>{product.variants.map((variant) => <li key={variant.id}>
      <strong>{variant.title}</strong><code>{variant.id} · {variant.sku}</code>
      <span>Selling price · {priceText(variant.pricePaise)} · GST included</span>
      <span>Compare-at · {priceText(variant.compareAtPricePaise)}</span>
      <span>Stock · starts at 0; added separately in Inventory</span>
      {variant.weightGrams ? <span>Weight · {variant.weightGrams} g</span> : null}
      {variant.lengthMm && variant.widthMm && variant.heightMm ? <span>Package · {variant.lengthMm} × {variant.widthMm} × {variant.heightMm} mm</span> : null}
      {variant.hsnCode ? <span>HSN · {variant.hsnCode}</span> : null}
      {variant.barcode ? <span>Barcode · {variant.barcode}</span> : null}
      {variant.lowStockThreshold !== undefined ? <span>Low-stock threshold · {variant.lowStockThreshold}</span> : null}
      {variant.costPricePaise !== undefined ? <span>Cost price · {priceText(variant.costPricePaise)} · Admin only</span> : null}
      <Badge>Inactive</Badge>
    </li>)}</ol>
  </>;
}

export function ProductCreate({ canWrite, canViewCost = false }: { canWrite: boolean; canViewCost?: boolean }): React.ReactNode {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ProductCreateDraft>(emptyDraft);
  const [attempted, setAttempted] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<{ tone: 'error' | 'status'; message: string; href?: string } | null>(null);
  const [locked, setLocked] = useState(false);
  const submissionStarted = useRef(false);
  const categories = useQuery({
    queryKey: queryKeys.catalog.categories,
    queryFn: ({ signal }) => getCategories(signal),
    staleTime: 60_000,
    retry: false,
    enabled: canWrite,
  });
  const activeCategories = (categories.data?.items ?? []).filter((category) => category.active);
  const categoryRows = useMemo(() => (categories.data?.items ?? []).map((category) => ({ id: category.id, active: category.active })), [categories.data]);
  const built = useMemo(() => buildProductCreatePayload(draft, categoryRows, canViewCost), [canViewCost, categoryRows, draft]);
  const mutation = useMutation({ mutationFn: (input: ProductCreateInput) => createProduct(input), retry: false });

  if (!canWrite) return <NotAllowedState title="Catalogue creation is unavailable">Only operators with the backend-matched catalog:write capability can create products.</NotAllowedState>;

  const update = <K extends keyof ProductCreateDraft>(key: K, value: ProductCreateDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setOutcome(null);
    setServerFieldErrors({});
    mutation.reset();
  };
  const updateVariant = <K extends keyof VariantCreateDraft>(index: number, key: K, value: VariantCreateDraft[K]) => {
    setDraft((previous) => ({ ...previous, variants: previous.variants.map((variant, row) => row === index ? { ...variant, [key]: value } : variant) }));
    setOutcome(null);
    setServerFieldErrors({});
    mutation.reset();
  };
  const review = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    if (categories.isError || categories.isLoading || activeCategories.length === 0 || !built.ok || locked || mutation.isPending) return;
    setReviewOpen(true);
  };
  const submit = async () => {
    if (!built.ok || mutation.isPending || submissionStarted.current || locked) return;
    submissionStarted.current = true;
    try {
      const product = await mutation.mutateAsync(built.payload);
      setReviewOpen(false);
      setOutcome({ tone: 'status', message: 'Product created by the backend in an inactive state. It is not available for purchase.' });
      setDraft(emptyDraft());
      setServerFieldErrors({});
      await queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
      router.push(`/products/${encodeURIComponent(product.id)}`);
    } catch (error) {
      const parsed = apiError(error);
      if (uncertain(error)) {
        setLocked(true);
        setReviewOpen(false);
        let message = `The create response was uncertain. No request was repeated; the result could not be attributed.${requestReference(error)}`;
        let href: string | undefined;
        try {
          const found = await getProduct(built.payload.id);
          href = `/products/${encodeURIComponent(found.id)}`;
          const safetyMismatch = found.active || found.archived || found.variants.some((variant) => variant.active || variant.onHand !== 0 || variant.reserved !== 0);
          message = safetyMismatch
            ? `The backend record is active, archived, or has nonzero stock despite the inactive, zero-stock request. Stop and review the record; attribution cannot be confirmed and no request was repeated.${requestReference(error)}`
            : `A product with this ID was found, but this create request cannot be attributed to that record. No request was repeated.${requestReference(error)}`;
        } catch {
          message = `The create response was uncertain, and a product could not be confirmed by ID. This does not prove the request failed. No request was repeated.${requestReference(error)}`;
        }
        setOutcome({ tone: 'status', message, ...(href ? { href } : {}) });
      } else {
        submissionStarted.current = false;
        setReviewOpen(false);
        setServerFieldErrors(parsed?.fields ?? {});
        setOutcome({ tone: 'error', message: `${parsed?.message ?? 'The backend rejected the product request. Review the fields and current catalogue before trying again.'}${requestReference(error)}` });
      }
    }
  };

  const activeCategoryChoices = activeCategories.map((category: Category) => category);
  const fieldError = (key: string) => {
    const variantField = /^variants\.(\d+)\.(price|compareAtPrice|costPrice)$/u.exec(key);
    const serverKey = variantField
      ? `variants.${variantField[1]}.${variantField[2] === 'price' ? 'pricePaise' : variantField[2] === 'compareAtPrice' ? 'compareAtPricePaise' : 'costPricePaise'}`
      : key;
    return serverFieldErrors[key] ?? serverFieldErrors[serverKey] ?? (attempted && !built.ok ? built.errors[key] : undefined);
  };
  const disabled = mutation.isPending || locked || categories.isLoading || categories.isError || activeCategoryChoices.length === 0;

  return <FormLeaveGuard dirty={JSON.stringify(draft) !== JSON.stringify(emptyDraft())}>
    <div className={styles.root}>
      <header className={styles.header}>
        <div><p className="eyebrow">CATALOGUE · NEW RECORD</p><h1>Create product</h1><p>New products and variants are saved inactive. They are not available to customers until a separate reviewed activation.</p></div>
        <Link className="ui-button ui-button--secondary ui-button--md" href="/products">Back to products</Link>
      </header>

      {outcome ? <p className={outcome.tone === 'error' ? styles.error : styles.notice} role={outcome.tone === 'error' ? 'alert' : 'status'}>{outcome.message} {outcome.href ? <Link href={outcome.href}>Open product record</Link> : null}</p> : null}
      {categories.isLoading ? <Card title="Loading categories"><Skeleton lines={3} /></Card> : null}
      {categories.isError ? (categories.error instanceof ApiError && (categories.error.status === 0 || categories.error.status >= 500)
        ? <OfflineState title="Categories are unavailable" requestId={apiError(categories.error)?.requestId} actionLabel="Try again" onAction={() => void categories.refetch()}>The backend must return an active category before a product can be created. No local categories are substituted.</OfflineState>
        : <ErrorState title="Categories could not be loaded" requestId={apiError(categories.error)?.requestId} actionLabel="Retry" onAction={() => void categories.refetch()}>{apiError(categories.error)?.message ?? 'The backend response did not match the category contract.'}</ErrorState>) : null}
      {!categories.isLoading && !categories.isError && activeCategoryChoices.length === 0 ? <EmptyState title="Create an active category first">Product creation requires a category returned by the backend. <Link href="/catalogue">Open Categories &amp; collections</Link>.</EmptyState> : null}

      {!categories.isLoading && !categories.isError && activeCategoryChoices.length > 0 ? <form className={styles.form} onSubmit={review} noValidate>
        <Card title="Product details">
          <p className={styles.cardIntro}>Product ID is permanent. Use lowercase letters, digits and hyphens. Text and prices are sent only after the review below.</p>
          <div className={styles.fields}>
            <Input label="Product ID" required value={draft.id} maxLength={100} disabled={disabled} error={fieldError('id')} description="Immutable URL and API identifier; 2–100 lowercase characters." onChange={(event) => update('id', event.target.value)} />
            <Input label="Product name" required value={draft.name} maxLength={160} disabled={disabled} error={fieldError('name')} onChange={(event) => update('name', event.target.value)} />
            <Input label="Subtitle" value={draft.subtitle} maxLength={200} disabled={disabled} error={fieldError('subtitle')} onChange={(event) => update('subtitle', event.target.value)} />
            <Select label="Category" required value={draft.categoryId} disabled={disabled} error={fieldError('categoryId')} onChange={(event) => update('categoryId', event.target.value)}>
              <option value="">Choose an active category</option>
              {activeCategoryChoices.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
            </Select>
            <Textarea label="Description" value={draft.description} rows={4} maxLength={5_000} disabled={disabled} error={fieldError('description')} onChange={(event) => update('description', event.target.value)} />
            <Textarea label="Key benefits · one per line" value={draft.keyBenefits} rows={3} maxLength={1_500} disabled={disabled} error={fieldError('keyBenefits')} onChange={(event) => update('keyBenefits', event.target.value)} description="Up to 10 benefits, each up to 120 characters." />
            <Textarea label="Suitable surfaces" value={draft.suitableSurfaces} rows={2} maxLength={1_000} disabled={disabled} error={fieldError('suitableSurfaces')} onChange={(event) => update('suitableSurfaces', event.target.value)} />
            <Textarea label="Box contents" value={draft.boxContents} rows={2} maxLength={1_000} disabled={disabled} error={fieldError('boxContents')} onChange={(event) => update('boxContents', event.target.value)} />
            <Textarea label="Tags · one per line" value={draft.tags} rows={2} maxLength={1_000} disabled={disabled} error={fieldError('tags')} description="Up to 20 tags; saved in lowercase." onChange={(event) => update('tags', event.target.value)} />
            <Input label="SEO title" value={draft.seoTitle} maxLength={120} disabled={disabled} error={fieldError('seoTitle')} onChange={(event) => update('seoTitle', event.target.value)} />
            <Textarea label="SEO description" value={draft.seoDescription} rows={2} maxLength={320} disabled={disabled} error={fieldError('seoDescription')} onChange={(event) => update('seoDescription', event.target.value)} />
            <Input label="Display order" type="number" inputMode="numeric" min={0} max={100_000} step={1} value={draft.sortOrder} disabled={disabled} error={fieldError('sortOrder')} onChange={(event) => update('sortOrder', event.target.value)} description="Lower values appear earlier in backend catalogue ordering." />
          </div>
        </Card>

        <Card title="Variants · GST-inclusive prices">
          <p className={styles.cardIntro}>Each variant starts with zero stock and is inactive. Add stock later through the separate reasoned, MFA-protected Inventory workflow. Prices include GST.</p>
          {draft.variants.map((variant, index) => <fieldset className={styles.variant} key={index}>
            <legend>Variant {index + 1}</legend>
            <div className={styles.fields}>
              <Input label={`Variant ${index + 1} ID`} required value={variant.id} maxLength={100} disabled={disabled} error={fieldError(`variants.${index}.id`)} description="Immutable lowercase ID." onChange={(event) => updateVariant(index, 'id', event.target.value)} />
              <Input label={`Variant ${index + 1} SKU`} required value={variant.sku} maxLength={60} disabled={disabled} error={fieldError(`variants.${index}.sku`)} onChange={(event) => updateVariant(index, 'sku', event.target.value)} />
              <Input label={`Variant ${index + 1} title`} required value={variant.title} maxLength={80} disabled={disabled} error={fieldError(`variants.${index}.title`)} onChange={(event) => updateVariant(index, 'title', event.target.value)} />
              <Input label={`Variant ${index + 1} selling price (₹)`} inputMode="decimal" required value={variant.price} disabled={disabled} error={fieldError(`variants.${index}.price`)} description="Positive rupees, up to 2 decimals; GST included." onChange={(event) => updateVariant(index, 'price', event.target.value)} />
              <Input label={`Variant ${index + 1} compare-at price (₹)`} inputMode="decimal" value={variant.compareAtPrice} disabled={disabled} error={fieldError(`variants.${index}.compareAtPrice`)} description="Optional; must not be below selling price." onChange={(event) => updateVariant(index, 'compareAtPrice', event.target.value)} />
              <Input label={`Variant ${index + 1} weight (g)`} inputMode="numeric" value={variant.weightGrams} disabled={disabled} error={fieldError(`variants.${index}.weightGrams`)} onChange={(event) => updateVariant(index, 'weightGrams', event.target.value)} />
              <Input label={`Variant ${index + 1} length (mm)`} inputMode="numeric" value={variant.lengthMm} disabled={disabled} error={fieldError(`variants.${index}.dimensions`)} onChange={(event) => updateVariant(index, 'lengthMm', event.target.value)} />
              <Input label={`Variant ${index + 1} width (mm)`} inputMode="numeric" value={variant.widthMm} disabled={disabled} error={fieldError(`variants.${index}.dimensions`)} onChange={(event) => updateVariant(index, 'widthMm', event.target.value)} />
              <Input label={`Variant ${index + 1} height (mm)`} inputMode="numeric" value={variant.heightMm} disabled={disabled} error={fieldError(`variants.${index}.dimensions`)} onChange={(event) => updateVariant(index, 'heightMm', event.target.value)} />
              <Input label={`Variant ${index + 1} HSN`} value={variant.hsnCode} maxLength={8} disabled={disabled} error={fieldError(`variants.${index}.hsnCode`)} description="4–8 digits." onChange={(event) => updateVariant(index, 'hsnCode', event.target.value)} />
              <Input label={`Variant ${index + 1} barcode`} value={variant.barcode} maxLength={40} disabled={disabled} error={fieldError(`variants.${index}.barcode`)} onChange={(event) => updateVariant(index, 'barcode', event.target.value)} />
              <Input label={`Variant ${index + 1} low-stock alert (units)`} inputMode="numeric" value={variant.lowStockThreshold} disabled={disabled} error={fieldError(`variants.${index}.lowStockThreshold`)} description="Optional threshold for this new variant." onChange={(event) => updateVariant(index, 'lowStockThreshold', event.target.value)} />
              {canViewCost ? <Input label={`Variant ${index + 1} cost price (₹) · Admin only`} inputMode="decimal" value={variant.costPrice} disabled={disabled} error={fieldError(`variants.${index}.costPrice`)} onChange={(event) => updateVariant(index, 'costPrice', event.target.value)} /> : null}
            </div>
            {draft.variants.length > 1 ? <Button variant="quiet" disabled={disabled} onClick={() => update('variants', draft.variants.filter((_, row) => row !== index))}>Remove variant {index + 1}</Button> : null}
          </fieldset>)}
          <div className={styles.variantActions}>
            <Button variant="secondary" disabled={disabled || draft.variants.length >= 20} onClick={() => update('variants', [...draft.variants, emptyVariant()])}>Add another variant</Button>
            {fieldError('variants') ? <p className={styles.error} role="alert">{fieldError('variants')}</p> : null}
          </div>
          {!built.ok && attempted ? <div className={styles.errors} role="alert">{Object.entries(built.errors).map(([field, message]) => <p key={field}><strong>{field.replaceAll('.', ' · ')}:</strong> {message}</p>)}</div> : null}
          <div className={styles.footerActions}>
            <Button type="submit" disabled={disabled}>Review new product</Button>
            <Link href="/products" className="ui-button ui-button--quiet ui-button--md">Cancel</Link>
          </div>
        </Card>
      </form> : null}

      <Dialog open={reviewOpen && built.ok} onOpenChange={setReviewOpen} title="Review new product" dismissible={!mutation.isPending} className={styles.reviewDialog!} footer={built.ok ? <>
        <Button variant="secondary" disabled={mutation.isPending} onClick={() => setReviewOpen(false)}>Back to editing</Button>
        <Button loading={mutation.isPending} disabled={locked} onClick={() => void submit()}>Create inactive product</Button>
      </> : null}>
        {built.ok ? <>
          <p className={styles.notice}>This sends one backend request. The product and variants will remain inactive; no stock or media attachment is included. This API has no idempotency key, so an uncertain response will not be retried.</p>
          {reviewProductRows(built.payload)}
        </> : null}
        {reviewOpen && mutation.error ? <p className={styles.error} role="alert">{apiError(mutation.error)?.message ?? 'The backend did not confirm the create request.'}{requestReference(mutation.error)}</p> : null}
      </Dialog>
    </div>
  </FormLeaveGuard>;
}

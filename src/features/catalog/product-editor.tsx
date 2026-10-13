'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { z } from 'zod';

import { FormDraftNotice, FormLeaveGuard, useFormDraft } from '@/components/forms/draft-protection';
import { Badge, Button, Input, Select, Switch, Textarea } from '@/components/ui/core';
import { Card, EmptyState, ErrorState, NotAllowedState, OfflineState, Skeleton } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import {
  addProductVariant,
  getCatalogVariants,
  getCategories,
  getProduct,
  updateProduct,
  updateVariant,
  type CatalogVariant,
  type Product,
  type ProductPatchInput,
  type ProductVariantCreateInput,
  type VariantPatchInput,
} from '@/lib/api/resources/catalog';
import { formatMoney } from '@/lib/format/money';
import { formatIst } from '@/lib/format/time';

import {
  buildProductPatch,
  buildVariantPatch,
  productDraftFrom,
  variantPriceDraftFrom,
  type ProductChange,
  type ProductEditorDraft,
  type VariantChange,
  type VariantPriceDraft,
} from './product-editor-model';
import { buildVariantCreatePayload, type VariantCreateDraft } from './product-create-model';
import styles from './product-editor.module.css';

const productDraftSchema = z.object({
  name: z.string().max(160),
  subtitle: z.string().max(200),
  description: z.string().max(5000),
  categoryId: z.string().max(100),
  keyBenefits: z.string().max(1500),
  suitableSurfaces: z.string().max(1000),
  boxContents: z.string().max(1000),
  tags: z.string().max(1000),
  seoTitle: z.string().max(120),
  seoDescription: z.string().max(320),
  sortOrder: z.string().max(6),
  active: z.boolean(),
}).strict();

function parseProductDraft(value: unknown): ProductEditorDraft | null {
  const result = productDraftSchema.safeParse(value);
  return result.success ? result.data : null;
}

function apiError(error: unknown): ApiError | null {
  return error instanceof ApiError ? error : null;
}

function isOffline(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.code === 'UNAVAILABLE');
}

function isUncertain(error: unknown): boolean {
  return error instanceof ApiError ? error.status === 0 || error.status >= 500 : true;
}

function displayChangeValue(change: ProductChange | VariantChange, value: string | number | boolean | null): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Active' : 'Inactive';
  if ((change.path === 'pricePaise' || change.path === 'comparePaise') && typeof value === 'number') return formatMoney(value);
  return String(value);
}

function changeRows(changes: ProductChange[] | VariantChange[]): React.ReactNode {
  return <dl className={styles.changeList}>{changes.map((change) => <div key={change.path}>
    <dt>{change.label}</dt>
    <dd><span>{displayChangeValue(change, change.before)}</span><span aria-hidden="true">→</span><strong>{displayChangeValue(change, change.after)}</strong></dd>
  </div>)}</dl>;
}

function emptyVariantCreateDraft(): VariantCreateDraft {
  return { id: '', sku: '', title: '', price: '', compareAtPrice: '', weightGrams: '', lengthMm: '', widthMm: '', heightMm: '', hsnCode: '', barcode: '', costPrice: '', lowStockThreshold: '' };
}

function ProductEditorForm({ product, operatorId, canWrite, canViewCost }: {
  product: Product;
  operatorId: string;
  canWrite: boolean;
  canViewCost: boolean;
}): React.ReactNode {
  const queryClient = useQueryClient();
  const [baseProduct, setBaseProduct] = useState(product);
  const [draft, setDraft] = useState<ProductEditorDraft>(() => productDraftFrom(product));
  const [reviewOpen, setReviewOpen] = useState(false);
  const [conflict, setConflict] = useState<{ latest: Product; requestId: string | null } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [priceVariant, setPriceVariant] = useState<CatalogVariant | null>(null);
  const [priceDraft, setPriceDraft] = useState<VariantPriceDraft | null>(null);
  const [priceReviewOpen, setPriceReviewOpen] = useState(false);
  const [priceOutcomeNeedsReload, setPriceOutcomeNeedsReload] = useState(false);
  const [priceFieldErrors, setPriceFieldErrors] = useState<Record<string, string>>({});
  const [priceReadMessage, setPriceReadMessage] = useState<string | null>(null);
  const [priceMutationMessage, setPriceMutationMessage] = useState<string | null>(null);
  const [addVariantOpen, setAddVariantOpen] = useState(false);
  const [addVariantReviewOpen, setAddVariantReviewOpen] = useState(false);
  const [addVariantDraft, setAddVariantDraft] = useState<VariantCreateDraft>(emptyVariantCreateDraft);
  const [addVariantAttempted, setAddVariantAttempted] = useState(false);
  const [addVariantReason, setAddVariantReason] = useState('');
  const [addVariantLocked, setAddVariantLocked] = useState(false);
  const [addVariantMessage, setAddVariantMessage] = useState<string | null>(null);
  const [addVariantServerErrors, setAddVariantServerErrors] = useState<Record<string, string>>({});
  const addVariantSubmissionStarted = useRef(false);

  const draftBuild = useMemo(() => buildProductPatch(baseProduct, draft), [baseProduct, draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(productDraftFrom(baseProduct));
  const draftSaved = useFormDraft({
    resource: `product-${product.id}`,
    operatorId,
    value: draft,
    dirty,
    parseDraft: parseProductDraft,
    sensitive: false,
    onRestore: setDraft,
  });
  const categories = useQuery({
    queryKey: queryKeys.catalog.categories,
    queryFn: ({ signal }) => getCategories(signal),
    staleTime: 60_000,
    retry: 1,
  });
  const catalogVariants = useQuery({
    queryKey: queryKeys.catalog.variants,
    queryFn: ({ signal }) => getCatalogVariants(signal),
    enabled: false,
    staleTime: 0,
    retry: false,
  });

  const productMutation = useMutation({
    mutationFn: (input: ProductPatchInput) => updateProduct(baseProduct.id, input),
    retry: false,
  });
  const variantMutation = useMutation({
    mutationFn: (input: { variantId: string; patch: VariantPatchInput }) => updateVariant(input.variantId, input.patch),
    retry: false,
  });
  const addVariantMutation = useMutation({
    mutationFn: (input: ProductVariantCreateInput) => addProductVariant(baseProduct.id, input, { expectedVersion: baseProduct.version, reason: addVariantReason.trim() }),
    retry: false,
  });

  const updateDraft = <K extends keyof ProductEditorDraft>(key: K, value: ProductEditorDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setFieldErrors((previous) => ({ ...previous, [key]: '' }));
    setSavedMessage(null);
    productMutation.reset();
  };

  const openProductReview = () => {
    if (!canWrite || baseProduct.archived) return;
    const result = buildProductPatch(baseProduct, draft);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      return;
    }
    setFieldErrors({});
    if (!result.patch) {
      setFieldErrors({ _form: 'There are no product changes to save.' });
      return;
    }
    setReviewOpen(true);
  };

  const saveProduct = async () => {
    if (!draftBuild.ok || !draftBuild.patch || productMutation.isPending) return;
    try {
      const updated = await productMutation.mutateAsync(draftBuild.patch);
      setBaseProduct(updated);
      setDraft(productDraftFrom(updated));
      setReviewOpen(false);
      setConflict(null);
      setSavedMessage('Product changes saved by the backend.');
      draftSaved.discard();
      await queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all });
    } catch (error) {
      setReviewOpen(false);
      const parsed = apiError(error);
      if (parsed?.fields) setFieldErrors(parsed.fields);
      if (parsed?.status === 409 && parsed.code === 'CART_VERSION_CONFLICT') {
        try {
          const latest = await queryClient.fetchQuery({
            queryKey: queryKeys.catalog.product(product.id),
            queryFn: ({ signal }) => getProduct(product.id, signal),
            staleTime: 0,
          });
          setConflict({ latest, requestId: parsed.requestId ?? null });
        } catch {
          setSavedMessage(`The product version changed. Reload the record before another save. ${parsed.requestId ? `Request ID: ${parsed.requestId}` : ''}`);
        }
      } else if (isUncertain(error)) {
        try {
          const latest = await queryClient.fetchQuery({
            queryKey: queryKeys.catalog.product(product.id),
            queryFn: ({ signal }) => getProduct(product.id, signal),
            staleTime: 0,
          });
          setBaseProduct(latest);
          setSavedMessage(`The save response was not confirmed. The latest server record was loaded; review your changes again before saving. ${parsed?.requestId ? `Request ID: ${parsed.requestId}` : ''}`);
        } catch {
          setSavedMessage(`The save outcome is unknown. Do not repeat it until the product has been refreshed. ${parsed?.requestId ? `Request ID: ${parsed.requestId}` : ''}`);
        }
      }
    }
  };

  const beginPriceEdit = async (variantId: string, preserveDraft = false) => {
    if (!canWrite || baseProduct.archived || catalogVariants.isFetching) return;
    const priorVariant = preserveDraft ? priceVariant : null;
    const priorDraft = preserveDraft ? priceDraft : null;
    setPriceReadMessage(null);
    setPriceMutationMessage(null);
    setPriceVariant(null);
    if (!preserveDraft) setPriceDraft(null);
    setPriceReviewOpen(false);
    setPriceOutcomeNeedsReload(false);
    variantMutation.reset();
    const result = await catalogVariants.refetch();
    if (result.error) {
      const error = apiError(result.error);
      setPriceReadMessage(`Price editing is unavailable until the server variant timestamp loads. ${error?.requestId ? `Request ID: ${error.requestId}` : error?.message ?? 'The variant list could not be verified.'}`);
      return;
    }
    const authoritative = result.data?.items.find((variant) => variant.id === variantId);
    if (!authoritative) {
      setPriceReadMessage('Price editing is unavailable because the backend did not return this variant in its catalogue list. Refresh the product record before trying again.');
      return;
    }
    setPriceVariant(authoritative);
    const freshDraft = variantPriceDraftFrom(authoritative);
    if (priorVariant && priorDraft) {
      const oldBase = variantPriceDraftFrom(priorVariant);
      setPriceDraft({
        price: priorDraft.price === oldBase.price ? freshDraft.price : priorDraft.price,
        compareAtPrice: priorDraft.compareAtPrice === oldBase.compareAtPrice ? freshDraft.compareAtPrice : priorDraft.compareAtPrice,
        active: priorDraft.active === oldBase.active ? freshDraft.active : priorDraft.active,
        reason: priorDraft.reason,
      });
    } else {
      setPriceDraft(freshDraft);
    }
    setPriceFieldErrors({});
  };

  const priceBuild = priceVariant && priceDraft ? buildVariantPatch(priceVariant, priceDraft) : null;
  const addVariantBuild = useMemo(() => buildVariantCreatePayload(addVariantDraft, canViewCost), [addVariantDraft, canViewCost]);
  const addVariantError = (key: string) => addVariantServerErrors[key] ?? (addVariantAttempted && !addVariantBuild.ok ? addVariantBuild.errors[key] : undefined);
  const reviewPrice = () => {
    if (!priceBuild?.ok) {
      if (priceBuild) setPriceFieldErrors(priceBuild.fieldErrors);
      return;
    }
    if (!priceBuild.patch) {
      setPriceFieldErrors({ _form: 'There are no variant changes to save.' });
      return;
    }
    setPriceFieldErrors({});
    setPriceReviewOpen(true);
  };

  const savePrice = async () => {
    if (!priceVariant || !priceBuild?.ok || !priceBuild.patch || variantMutation.isPending) return;
    try {
      await variantMutation.mutateAsync({ variantId: priceVariant.id, patch: priceBuild.patch });
      setPriceVariant(null);
      setPriceDraft(null);
      setPriceReviewOpen(false);
      setPriceMutationMessage('Variant change saved by the backend. The catalogue is refreshing.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all });
    } catch (error) {
      const parsed = apiError(error);
      setPriceReviewOpen(false);
      setPriceOutcomeNeedsReload(true);
      setPriceMutationMessage(`Variant change was not confirmed. No request was repeated; load a fresh server timestamp before another review. ${parsed?.requestId ? `Request ID: ${parsed.requestId}` : parsed?.message ?? ''}`.trim());
      await catalogVariants.refetch();
    }
  };

  const updateAddVariantDraft = <K extends keyof VariantCreateDraft>(key: K, value: VariantCreateDraft[K]) => {
    setAddVariantDraft((previous) => ({ ...previous, [key]: value }));
    setAddVariantMessage(null);
    setAddVariantServerErrors({});
    addVariantMutation.reset();
  };

  const openAddVariant = () => {
    if (!canWrite || baseProduct.archived || dirty || priceVariant || addVariantLocked) return;
    setAddVariantDraft(emptyVariantCreateDraft());
    setAddVariantReason('');
    setAddVariantAttempted(false);
    setAddVariantMessage(null);
    setAddVariantServerErrors({});
    addVariantSubmissionStarted.current = false;
    setAddVariantOpen(true);
  };

  const addVariantReasonValid = addVariantReason.trim().length >= 3 && addVariantReason.trim().length <= 300;
  const reviewNewVariant = () => {
    setAddVariantAttempted(true);
    if (dirty || !addVariantBuild.ok || !addVariantReasonValid || addVariantMutation.isPending || addVariantLocked) return;
    const existing = baseProduct.variants.find((variant) => variant.id === addVariantBuild.payload.id || variant.sku.toLowerCase() === addVariantBuild.payload.sku.toLowerCase());
    if (existing) {
      setAddVariantMessage('This variant ID or SKU already exists on the product. Refresh the backend record and choose a unique value.');
      return;
    }
    setAddVariantReviewOpen(true);
  };

  const saveNewVariant = async () => {
    if (!addVariantBuild.ok || !addVariantReasonValid || addVariantMutation.isPending || addVariantSubmissionStarted.current || addVariantLocked || dirty) return;
    addVariantSubmissionStarted.current = true;
    try {
      const updated = await addVariantMutation.mutateAsync(addVariantBuild.payload);
      setBaseProduct(updated);
      setAddVariantOpen(false);
      setAddVariantReviewOpen(false);
      setAddVariantDraft(emptyVariantCreateDraft());
      setAddVariantReason('');
      setAddVariantMessage('Variant added in an inactive state. It is not available for purchase; existing product and variant states were not changed.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    } catch (error) {
      const parsed = apiError(error);
      if (isUncertain(error)) {
        setAddVariantLocked(true);
        setAddVariantReviewOpen(false);
        let message = `The add-variant response was uncertain. No request was repeated; the result could not be reconciled.${parsed?.requestId ? ` Request ID: ${parsed.requestId}` : ''}`;
        try {
          const latest = await getProduct(baseProduct.id);
          setBaseProduct(latest);
          const match = latest.variants.find((variant) => variant.id === addVariantBuild.payload.id || variant.sku.toLowerCase() === addVariantBuild.payload.sku.toLowerCase());
          message = match && (match.active || match.onHand !== 0 || match.reserved !== 0)
            ? `The matching backend variant is active or has nonzero stock despite the inactive, zero-stock request. Stop and review the product; no request was repeated.${parsed?.requestId ? ` Request ID: ${parsed.requestId}` : ''}`
            : match
              ? `A matching variant was found in the refreshed product, but attribution cannot be confirmed for this request. No request was repeated.${parsed?.requestId ? ` Request ID: ${parsed.requestId}` : ''}`
              : `The refreshed product does not show this variant. That does not prove the request failed. No request was repeated.${parsed?.requestId ? ` Request ID: ${parsed.requestId}` : ''}`;
        } catch {
          message = `The add-variant response was uncertain and a fresh product could not be loaded. No request was repeated.${parsed?.requestId ? ` Request ID: ${parsed.requestId}` : ''}`;
        }
        setAddVariantMessage(message);
      } else {
        addVariantSubmissionStarted.current = false;
        setAddVariantReviewOpen(false);
      setAddVariantServerErrors(parsed?.fields ?? {});
        setAddVariantMessage(`${parsed?.message ?? 'The backend rejected this variant. Review the fields and current product before trying again.'}${parsed?.requestId ? ` Request ID: ${parsed.requestId}` : ''}`);
      }
    }
  };

  const editingAllowed = canWrite && !baseProduct.archived;
  const currentProductError = apiError(productMutation.error);

  return <FormLeaveGuard dirty={dirty || priceVariant !== null || addVariantOpen}><div className={styles.root}>
    <header className={styles.header}>
      <div>
        <p className="eyebrow">CATALOGUE · BACKEND RECORD</p>
        <h1>{baseProduct.name}</h1>
        <p>Product ID <code>{baseProduct.id}</code> · Version {baseProduct.version} · Updated {formatIst(baseProduct.updatedAt)} IST</p>
      </div>
      <Badge tone={baseProduct.archived ? 'warning' : baseProduct.active ? 'positive' : 'neutral'}>{baseProduct.archived ? 'Archived' : baseProduct.active ? 'Active' : 'Inactive'}</Badge>
    </header>

    {baseProduct.archived ? <p className={styles.notice} role="status">This product is archived: it is hidden from the storefront and cannot be edited. Use “Restore product” in the gallery section below to bring it back (it stays inactive until you activate it).</p> : null}
    {!canWrite ? <p className={styles.notice} role="status">Read-only access. Your role can inspect catalogue records but cannot change them.</p> : null}
    {savedMessage ? <p className={styles.success} role="status">{savedMessage}</p> : null}
    {currentProductError && !reviewOpen && !conflict ? <p className={styles.error} role="alert">{currentProductError.message} {currentProductError.requestId ? `Request ID: ${currentProductError.requestId}` : ''}</p> : null}

    <FormDraftNotice
      dirty={dirty}
      draftAvailable={draftSaved.draftAvailable}
      draftSaved={draftSaved.draftSaved}
      canPersist={draftSaved.canPersist}
      onRestore={() => { draftSaved.restore(); setFieldErrors({}); }}
      onDiscard={draftSaved.discard}
    />

    <div className={styles.columns}>
      <Card title="Product details" className={styles.editorCard!}>
        <p className={styles.cardIntro}>Edits update the live catalogue after the backend validates the current product version. Existing order snapshots are not changed.</p>
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); openProductReview(); }}>
          <p className={styles.inlineNotice}>Product ID <code>{baseProduct.id}</code> is immutable after creation. Product edits are version-checked and leave past orders unchanged.</p>
          <Input label="Product name" value={draft.name} maxLength={160} disabled={!editingAllowed} error={fieldErrors.name} onChange={(event) => updateDraft('name', event.target.value)} />
          <Input label="Subtitle" value={draft.subtitle} maxLength={200} disabled={!editingAllowed} error={fieldErrors.subtitle} onChange={(event) => updateDraft('subtitle', event.target.value)} />
          <Textarea label="Description" value={draft.description} maxLength={5000} rows={5} disabled={!editingAllowed} error={fieldErrors.description} onChange={(event) => updateDraft('description', event.target.value)} />
          <Select label="Category" value={draft.categoryId} disabled={!editingAllowed || categories.isLoading || categories.isError} error={fieldErrors.categoryId} onChange={(event) => updateDraft('categoryId', event.target.value)}>
          {!(categories.data?.items ?? []).some((category) => category.id === draft.categoryId) ? <option value={draft.categoryId}>{baseProduct.categoryName ?? draft.categoryId}</option> : null}
          {(categories.data?.items ?? []).map((category) => <option value={category.id} key={category.id}>{category.name}{category.active ? '' : ' · inactive'}</option>)}
          </Select>
          {categories.isError ? <p className={styles.inlineNotice} role="status">Categories could not be loaded; category changes are disabled. {apiError(categories.error)?.requestId ? `Request ID: ${apiError(categories.error)?.requestId}` : ''}</p> : null}
          <Textarea label="Key benefits · one per line" value={draft.keyBenefits} maxLength={1500} rows={4} disabled={!editingAllowed} error={fieldErrors.keyBenefits} onChange={(event) => updateDraft('keyBenefits', event.target.value)} description="Up to 10 benefits; each line becomes a separate catalogue benefit." />
          <Textarea label="Suitable surfaces" value={draft.suitableSurfaces} maxLength={1000} rows={3} disabled={!editingAllowed} error={fieldErrors.suitableSurfaces} onChange={(event) => updateDraft('suitableSurfaces', event.target.value)} />
          <Textarea label="Box contents" value={draft.boxContents} maxLength={1000} rows={3} disabled={!editingAllowed} error={fieldErrors.boxContents} onChange={(event) => updateDraft('boxContents', event.target.value)} />
          <Textarea label="Tags · one per line" value={draft.tags} maxLength={1000} rows={3} disabled={!editingAllowed} error={fieldErrors.tags} onChange={(event) => updateDraft('tags', event.target.value)} description="Tags are normalized to lowercase by the editor." />
          <Input label="SEO title" value={draft.seoTitle} maxLength={120} disabled={!editingAllowed} error={fieldErrors.seoTitle} description={`${[...draft.seoTitle].length}/120 characters`} onChange={(event) => updateDraft('seoTitle', event.target.value)} />
          <Textarea label="SEO description" value={draft.seoDescription} maxLength={320} rows={3} disabled={!editingAllowed} error={fieldErrors.seoDescription} description={`${[...draft.seoDescription].length}/320 characters`} onChange={(event) => updateDraft('seoDescription', event.target.value)} />
          <Input label="Display order" type="number" min={0} max={100000} step={1} value={draft.sortOrder} disabled={!editingAllowed} error={fieldErrors.sortOrder} description="A lower number appears earlier in backend catalogue ordering." onChange={(event) => updateDraft('sortOrder', event.target.value)} />
          <Switch label="Visible on the storefront" checked={draft.active} disabled={!editingAllowed} onChange={(value) => updateDraft('active', value)} />
          {fieldErrors._form ? <p className={styles.error} role="alert">{fieldErrors._form}</p> : null}
          {productMutation.error && !currentProductError?.requestId ? <p className={styles.error} role="alert">The product change did not complete. Refresh and review before another save.</p> : null}
          {editingAllowed ? <Button type="submit" disabled={productMutation.isPending || !dirty}>Review product changes</Button> : null}
        </form>
      </Card>

      <div className={styles.sideColumn}>
        <Card title="Variants and pricing" className={styles.variantCard!}>
          <p className={styles.cardIntro}>Selling and compare-at prices are GST-inclusive. Price changes require a fresh server timestamp and a reason; checkout may reject an open quote or require a new quote.</p>
          {editingAllowed ? <div className={styles.variantAddActions}>
            <Button variant="secondary" disabled={dirty || priceVariant !== null || addVariantMutation.isPending || addVariantLocked} onClick={openAddVariant}>Add variant</Button>
            {dirty ? <span>Save or discard product edits before adding a variant.</span> : null}
          </div> : null}
          {addVariantMessage && !addVariantOpen ? <p className={styles.inlineNotice} role="status">{addVariantMessage}</p> : null}
          <ul className={styles.variantList}>
            {baseProduct.variants.map((variant) => <li key={variant.id}>
              <div className={styles.variantTop}>
                <div><strong>{variant.title}</strong><code>{variant.sku}</code></div>
                <Badge tone={variant.active ? 'positive' : 'neutral'}>{variant.active ? 'Available' : 'Inactive'}</Badge>
              </div>
              <dl className={styles.variantFacts}>
                <div><dt>Selling price</dt><dd>{formatMoney(variant.pricePaise)}</dd></div>
                <div><dt>Compare-at price</dt><dd>{variant.compareAtPricePaise === null ? '—' : formatMoney(variant.compareAtPricePaise)}</dd></div>
                <div><dt>On hand · reserved</dt><dd>{variant.onHand} · {variant.reserved}</dd></div>
                <div><dt>Low-stock threshold</dt><dd>{variant.lowStockThreshold === null ? 'Not configured' : variant.lowStockThreshold}</dd></div>
                {canViewCost && variant.costPricePaise !== undefined && variant.costPricePaise !== null ? <div><dt>Cost price · admin only</dt><dd>{formatMoney(variant.costPricePaise)}</dd></div> : null}
                {variant.weightGrams !== null ? <div><dt>Weight</dt><dd>{variant.weightGrams} g</dd></div> : null}
                {variant.hsnCode ? <div><dt>HSN</dt><dd>{variant.hsnCode}</dd></div> : null}
                {variant.barcode ? <div><dt>Barcode</dt><dd>{variant.barcode}</dd></div> : null}
              </dl>
              {editingAllowed ? <Button variant="secondary" className={styles.priceButton!} disabled={catalogVariants.isFetching} loading={catalogVariants.isFetching} onClick={() => void beginPriceEdit(variant.id)}>Edit price for {variant.title}</Button> : null}
            </li>)}
          </ul>
          {priceReadMessage ? <p className={styles.error} role="alert">{priceReadMessage}</p> : null}
          {priceMutationMessage && !priceVariant ? <p className={styles.inlineNotice} role="status">{priceMutationMessage}</p> : null}
        </Card>

        <Card title="Read-only variant metadata" className={styles.guardrails!}>
          <p>The current API can change selling price, compare-at price, and availability only. SKU, variant title, weight, dimensions, HSN, barcode, cost price, and low-stock threshold are intentionally not editable here.</p>
          <p><ShieldCheck size={16} aria-hidden="true" /> The backend enforces role permission and the version/timestamp precondition. This interface cannot grant permission or bypass a conflict.</p>
        </Card>
        <Card title="Search result preview" className={styles.previewCard!}>
          <p className={styles.previewTitle}>{draft.seoTitle.trim() || draft.name.trim() || 'Product title'}</p>
          <p className={styles.previewPath}>Product page · /products/{baseProduct.id}</p>
          <p className={styles.previewDescription}>{draft.seoDescription.trim() || draft.description.trim() || 'Product description will appear here.'}</p>
          <small>This is an editorial preview only; search engines choose how results are displayed.</small>
        </Card>
      </div>
    </div>

    <Dialog open={reviewOpen} onOpenChange={setReviewOpen} title="Review product changes" dismissible={!productMutation.isPending} footer={<>
      <Button variant="secondary" onClick={() => setReviewOpen(false)} disabled={productMutation.isPending}>Back to editing</Button>
      <Button loading={productMutation.isPending} disabled={!draftBuild.ok || !draftBuild.patch} onClick={() => void saveProduct()}>Save reviewed changes</Button>
    </>}>
      <p>Review every changed field. The backend will accept this only if product version {baseProduct.version} is still current.</p>
      {draftBuild.ok ? changeRows(draftBuild.changes) : <p className={styles.error}>Fix the highlighted fields before saving.</p>}
      <p className={styles.guardMessage}><AlertTriangle size={17} aria-hidden="true" /> Saving changes the current storefront catalogue. Historical orders keep their original item details.</p>
      {currentProductError ? <p className={styles.error} role="alert">{currentProductError.message} {currentProductError.requestId ? `Request ID: ${currentProductError.requestId}` : ''}</p> : null}
    </Dialog>

    <Dialog open={Boolean(conflict)} onOpenChange={(open) => { if (!open) setConflict(null); }} title="This changed while you were editing" footer={<>
      <Button variant="secondary" onClick={() => setConflict(null)}>Keep my draft for now</Button>
      <Button onClick={() => { if (!conflict) return; setBaseProduct(conflict.latest); setConflict(null); productMutation.reset(); }}>Review and merge my changes</Button>
    </>}>
      {conflict ? <>
        <p>The backend rejected the save because the product version is no longer current. No automatic retry occurred.</p>
        <p>Latest server name: <strong>{conflict.latest.name}</strong> · version {conflict.latest.version}</p>
        <p>Your unsaved draft name: <strong>{draft.name}</strong></p>
        {conflict.requestId ? <p>Request ID: <code>{conflict.requestId}</code></p> : null}
      </> : null}
    </Dialog>

    <Dialog open={priceVariant !== null} onOpenChange={(open) => { if (!open && !variantMutation.isPending) { setPriceVariant(null); setPriceDraft(null); setPriceReviewOpen(false); } }} title={priceReviewOpen ? 'Review variant price change' : `Edit ${priceVariant?.title ?? 'variant'} price`} dismissible={!variantMutation.isPending} footer={priceVariant && priceDraft ? priceReviewOpen ? <>
      <Button variant="secondary" onClick={() => setPriceReviewOpen(false)} disabled={variantMutation.isPending}>Back to price</Button>
      <Button loading={variantMutation.isPending} disabled={!priceBuild?.ok || !priceBuild.patch} onClick={() => void savePrice()}>Save reviewed price change</Button>
    </> : <>
      <Button variant="secondary" onClick={() => { setPriceVariant(null); setPriceDraft(null); }}>Cancel</Button>
      <Button disabled={priceOutcomeNeedsReload || !priceBuild?.ok || !priceBuild.patch} onClick={reviewPrice}>Review price change</Button>
    </> : null}>
      {priceVariant && priceDraft ? priceReviewOpen ? <>
        <p>{priceVariant.name} · {priceVariant.title} · {priceVariant.sku}. The backend will accept the change only if this variant timestamp remains current.</p>
        {priceBuild?.ok ? changeRows(priceBuild.changes) : <p className={styles.error}>Fix the highlighted price fields before saving.</p>}
        <p className={styles.guardMessage}><AlertTriangle size={17} aria-hidden="true" /> An open checkout quote may be rejected and require a new quote. A variant price update does not bump the store rules version.</p>
        <p className={styles.inlineNotice}>A reason is included in the backend audit record: “{priceDraft.reason.trim()}”</p>
        {priceMutationMessage ? <p className={styles.error} role="alert">{priceMutationMessage}</p> : null}
      </> : <div className={styles.form}>
        <p className={styles.cardIntro}>{priceVariant.name} · {priceVariant.sku}. Prices are entered in rupees and sent as integer paise.</p>
        <Input label="Selling price (₹)" inputMode="decimal" value={priceDraft.price} disabled={variantMutation.isPending} error={priceFieldErrors.price} onChange={(event) => { setPriceDraft({ ...priceDraft, price: event.target.value }); setPriceFieldErrors({}); variantMutation.reset(); setPriceMutationMessage(null); }} />
        <Input label="Compare-at price (₹)" inputMode="decimal" value={priceDraft.compareAtPrice} disabled={variantMutation.isPending} error={priceFieldErrors.compareAtPrice} description="Leave blank when no compare-at price is set." onChange={(event) => { setPriceDraft({ ...priceDraft, compareAtPrice: event.target.value }); setPriceFieldErrors({}); variantMutation.reset(); setPriceMutationMessage(null); }} />
        <Switch label="Variant available for purchase" checked={priceDraft.active} disabled={variantMutation.isPending} onChange={(value) => { setPriceDraft({ ...priceDraft, active: value }); variantMutation.reset(); setPriceMutationMessage(null); }} />
        <Textarea label="Reason for price change" value={priceDraft.reason} minLength={3} maxLength={300} disabled={variantMutation.isPending} error={priceFieldErrors.reason} description="Required by the backend and written to the audit record." onChange={(event) => { setPriceDraft({ ...priceDraft, reason: event.target.value }); setPriceFieldErrors({}); variantMutation.reset(); setPriceMutationMessage(null); }} />
        <p className={styles.inlineNotice}>Current server price: {formatMoney(priceVariant.pricePaise)} · GST included. Timestamp: {formatIst(priceVariant.updatedAt)} IST.</p>
        {priceFieldErrors._form ? <p className={styles.error} role="alert">{priceFieldErrors._form}</p> : null}
        {priceMutationMessage ? <p className={styles.error} role="alert">{priceMutationMessage}</p> : null}
        {priceOutcomeNeedsReload ? <Button variant="secondary" onClick={() => void beginPriceEdit(priceVariant.id, true)}>Load fresh timestamp and review again</Button> : null}
      </div> : null}
    </Dialog>
    <Dialog open={addVariantOpen} onOpenChange={(open) => { if (!open && !addVariantMutation.isPending && !addVariantLocked) { setAddVariantOpen(false); setAddVariantReviewOpen(false); } }} title={addVariantLocked ? 'Add-variant outcome needs reconciliation' : addVariantReviewOpen ? 'Review new variant' : 'Add variant'} dismissible={!addVariantMutation.isPending && !addVariantLocked} footer={addVariantLocked ? <Button variant="secondary" onClick={() => setAddVariantOpen(false)}>Close</Button> : addVariantReviewOpen ? <>
      <Button variant="secondary" disabled={addVariantMutation.isPending} onClick={() => setAddVariantReviewOpen(false)}>Back to editing</Button>
      <Button loading={addVariantMutation.isPending} disabled={!addVariantBuild.ok || !addVariantReasonValid || dirty} onClick={() => void saveNewVariant()}>Add inactive variant</Button>
    </> : <>
      <Button variant="secondary" onClick={() => setAddVariantOpen(false)}>Cancel</Button>
      <Button disabled={!addVariantBuild.ok || !addVariantReasonValid || dirty} onClick={reviewNewVariant}>Review variant</Button>
    </>}>
      {addVariantLocked ? <p className={styles.notice} role="status">{addVariantMessage}</p> : addVariantReviewOpen && addVariantBuild.ok ? <>
        <p>For <strong>{baseProduct.name}</strong> · product status {baseProduct.active ? 'Active' : 'Inactive'}. The request carries product version {baseProduct.version}, your reason and an idempotency key. The new variant will be sent inactive; existing storefront state is unchanged.</p>
        <dl className={styles.changeList}>
          <div><dt>Variant ID</dt><dd><span>New</span><span aria-hidden="true">→</span><strong><code>{addVariantBuild.payload.id}</code></strong></dd></div>
          <div><dt>SKU</dt><dd><span>New</span><span aria-hidden="true">→</span><strong>{addVariantBuild.payload.sku}</strong></dd></div>
          <div><dt>Title</dt><dd><span>New</span><span aria-hidden="true">→</span><strong>{addVariantBuild.payload.title}</strong></dd></div>
          <div><dt>Selling price · GST included</dt><dd><span>New</span><span aria-hidden="true">→</span><strong>{formatMoney(addVariantBuild.payload.pricePaise, { showPaise: true })}</strong></dd></div>
          <div><dt>Compare-at price</dt><dd><span>New</span><span aria-hidden="true">→</span><strong>{addVariantBuild.payload.compareAtPricePaise === null ? 'Not set' : formatMoney(addVariantBuild.payload.compareAtPricePaise, { showPaise: true })}</strong></dd></div>
          <div><dt>Availability</dt><dd><span>New</span><span aria-hidden="true">→</span><strong>Inactive · not available for purchase</strong></dd></div>
          <div><dt>Initial stock</dt><dd><span>New</span><span aria-hidden="true">→</span><strong>0 · adjusted separately</strong></dd></div>
          {addVariantBuild.payload.weightGrams !== undefined ? <div><dt>Weight</dt><dd><span>New</span><span aria-hidden="true">→</span><strong>{addVariantBuild.payload.weightGrams} g</strong></dd></div> : null}
          {addVariantBuild.payload.hsnCode ? <div><dt>HSN</dt><dd><span>New</span><span aria-hidden="true">→</span><strong>{addVariantBuild.payload.hsnCode}</strong></dd></div> : null}
          {addVariantBuild.payload.barcode ? <div><dt>Barcode</dt><dd><span>New</span><span aria-hidden="true">→</span><strong>{addVariantBuild.payload.barcode}</strong></dd></div> : null}
          {addVariantBuild.payload.lowStockThreshold !== undefined ? <div><dt>Low-stock threshold</dt><dd><span>New</span><span aria-hidden="true">→</span><strong>{addVariantBuild.payload.lowStockThreshold}</strong></dd></div> : null}
          {canViewCost && addVariantBuild.payload.costPricePaise !== undefined ? <div><dt>Cost · Admin only</dt><dd><span>New</span><span aria-hidden="true">→</span><strong>{formatMoney(addVariantBuild.payload.costPricePaise, { showPaise: true })}</strong></dd></div> : null}
        </dl>
        <p className={styles.guardMessage}><AlertTriangle size={17} aria-hidden="true" /> Review the exact ID, SKU and GST-inclusive price. Reason: “{addVariantReason.trim()}”. If the product changed meanwhile the backend refuses the request (409) instead of overwriting.</p>
      </> : <div className={styles.form}>
        <p className={styles.cardIntro}>This adds a catalogue variant with zero stock. It will remain inactive until separately activated through a reviewed backend workflow.</p>
        <Input label="Variant ID" required value={addVariantDraft.id} disabled={addVariantMutation.isPending} error={addVariantError('id')} description="Immutable lowercase ID, 2–100 characters." onChange={(event) => updateAddVariantDraft('id', event.target.value)} />
        <Input label="SKU" required value={addVariantDraft.sku} maxLength={60} disabled={addVariantMutation.isPending} error={addVariantError('sku')} onChange={(event) => updateAddVariantDraft('sku', event.target.value)} />
        <Input label="Variant title" required value={addVariantDraft.title} maxLength={80} disabled={addVariantMutation.isPending} error={addVariantError('title')} onChange={(event) => updateAddVariantDraft('title', event.target.value)} />
        <Input label="Selling price (₹)" required inputMode="decimal" value={addVariantDraft.price} disabled={addVariantMutation.isPending} error={addVariantError('pricePaise') ?? addVariantError('price')} description="Positive rupees; GST included." onChange={(event) => updateAddVariantDraft('price', event.target.value)} />
        <Input label="Compare-at price (₹)" inputMode="decimal" value={addVariantDraft.compareAtPrice} disabled={addVariantMutation.isPending} error={addVariantError('compareAtPricePaise') ?? addVariantError('compareAtPrice')} onChange={(event) => updateAddVariantDraft('compareAtPrice', event.target.value)} />
        <Input label="Weight (g)" inputMode="numeric" value={addVariantDraft.weightGrams} disabled={addVariantMutation.isPending} error={addVariantError('weightGrams')} onChange={(event) => updateAddVariantDraft('weightGrams', event.target.value)} />
        <Input label="Length (mm)" inputMode="numeric" value={addVariantDraft.lengthMm} disabled={addVariantMutation.isPending} error={addVariantError('dimensions')} onChange={(event) => updateAddVariantDraft('lengthMm', event.target.value)} />
        <Input label="Width (mm)" inputMode="numeric" value={addVariantDraft.widthMm} disabled={addVariantMutation.isPending} error={addVariantError('dimensions')} onChange={(event) => updateAddVariantDraft('widthMm', event.target.value)} />
        <Input label="Height (mm)" inputMode="numeric" value={addVariantDraft.heightMm} disabled={addVariantMutation.isPending} error={addVariantError('dimensions')} onChange={(event) => updateAddVariantDraft('heightMm', event.target.value)} />
        <Input label="HSN" value={addVariantDraft.hsnCode} maxLength={8} disabled={addVariantMutation.isPending} error={addVariantError('hsnCode')} description="4–8 digits." onChange={(event) => updateAddVariantDraft('hsnCode', event.target.value)} />
        <Input label="Barcode" value={addVariantDraft.barcode} maxLength={40} disabled={addVariantMutation.isPending} error={addVariantError('barcode')} onChange={(event) => updateAddVariantDraft('barcode', event.target.value)} />
        <Input label="Low-stock alert (units)" inputMode="numeric" value={addVariantDraft.lowStockThreshold} disabled={addVariantMutation.isPending} error={addVariantError('lowStockThreshold')} onChange={(event) => updateAddVariantDraft('lowStockThreshold', event.target.value)} />
        {canViewCost ? <Input label="Cost price (₹) · Admin only" inputMode="decimal" value={addVariantDraft.costPrice} disabled={addVariantMutation.isPending} error={addVariantError('costPrice') ?? addVariantError('costPricePaise')} onChange={(event) => updateAddVariantDraft('costPrice', event.target.value)} /> : null}
        <Textarea label="Reason for adding this variant" required value={addVariantReason} minLength={3} maxLength={300} disabled={addVariantMutation.isPending} error={addVariantAttempted && !addVariantReasonValid ? 'Enter 3–300 characters.' : undefined} description="Recorded in the audit log with the product version." onChange={(event) => { setAddVariantReason(event.target.value); setAddVariantMessage(null); }} />
        {addVariantMessage && addVariantOpen ? <p className={styles.error} role="alert">{addVariantMessage}</p> : null}
        {addVariantAttempted && !addVariantBuild.ok ? <div className={styles.errors} role="alert">{Object.entries(addVariantBuild.errors).map(([key, message]) => <p key={key}>{message}</p>)}</div> : null}
      </div>}
    </Dialog>
  </div></FormLeaveGuard>;
}

export function ProductEditor({ id, operatorId, canWrite, canViewCost = false }: {
  id: string;
  operatorId: string;
  canWrite: boolean;
  canViewCost?: boolean;
}): React.ReactNode {
  const product = useQuery({
    queryKey: queryKeys.catalog.product(id),
    queryFn: ({ signal }) => getProduct(id, signal),
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error instanceof ApiError ? error.retryable || error.status === 0 : true),
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 1_500),
  });
  const error = apiError(product.error);

  if (product.isLoading) return <div className={styles.loading}><Skeleton lines={8} /></div>;
  if (!product.data) {
    if (error?.status === 403 && error.code === 'FORBIDDEN') return <NotAllowedState title="Catalogue access denied" {...(error.requestId ? { requestId: error.requestId } : {})}>The backend denied access to this product. Your role permissions remain enforced by the service.</NotAllowedState>;
    if (error?.status === 404) return <EmptyState title="Product not found">The backend returned no product for this identifier. No sample or cached product was substituted.</EmptyState>;
    if (isOffline(product.error)) return <OfflineState title="Product service unavailable" {...(error?.requestId ? { requestId: error.requestId } : {})} actionLabel="Try again" onAction={() => void product.refetch()}>{error?.message ?? 'Reconnect to the backend to load this product.'}</OfflineState>;
    return <ErrorState title="Product could not be loaded" {...(error?.requestId ? { requestId: error.requestId } : {})} actionLabel="Retry" onAction={() => void product.refetch()}>{error?.message ?? 'The backend response did not match the product contract.'}</ErrorState>;
  }

  return <ProductEditorForm key={product.data.id} product={product.data} operatorId={operatorId} canWrite={canWrite} canViewCost={canViewCost} />;
}

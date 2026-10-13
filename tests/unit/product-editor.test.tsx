// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductEditor } from '@/features/catalog/product-editor';
import { ApiError } from '@/lib/api/errors';
import type { CatalogVariant, Category, Product, ProductVariant } from '@/lib/api/resources/catalog';

const resources = vi.hoisted(() => ({
  getProduct: vi.fn(),
  getCategories: vi.fn(),
  getCatalogVariants: vi.fn(),
  updateProduct: vi.fn(),
  updateVariant: vi.fn(),
  addProductVariant: vi.fn(),
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));

vi.mock('@/lib/api/resources/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/resources/catalog')>();
  return {
    ...actual,
    getProduct: resources.getProduct,
    getCategories: resources.getCategories,
    getCatalogVariants: resources.getCatalogVariants,
    updateProduct: resources.updateProduct,
    updateVariant: resources.updateVariant,
    addProductVariant: resources.addProductVariant,
  };
});

const productVariant: ProductVariant = {
  id: 'cleaner-250', sku: 'JWX-CLN-250', title: '250 ml', pricePaise: 49900,
  compareAtPricePaise: 59900, active: true, weightGrams: 300, lengthMm: 80, widthMm: 80,
  heightMm: 160, hsnCode: '34051000', barcode: null, onHand: 12, reserved: 2,
  lowStockThreshold: 4, costPricePaise: 12500,
};

const product: Product = {
  id: 'leather-cleaner', name: 'Leather Cleaner', subtitle: 'Gentle care', description: 'Cleans finished leather.',
  categoryId: 'cleaners', categoryName: 'Cleaners', keyBenefits: ['Lifts everyday dirt'], suitableSurfaces: null,
  boxContents: 'One bottle', tags: ['leather'], seoTitle: null, seoDescription: null, active: true, archived: false,
  sortOrder: 1, version: 7, image: null, variants: [productVariant], updatedAt: '2026-10-07T10:00:00.000Z',
};

const categories: Category[] = [{
  id: 'cleaners', name: 'Cleaners', description: '', imageMediaId: null, seoTitle: null,
  seoDescription: null, active: true, sortOrder: 1, productCount: 1, rev: 1, updatedAt: null,
}];

const catalogVariant: CatalogVariant = {
  id: 'cleaner-250', sku: 'JWX-CLN-250', name: 'Leather Cleaner', title: '250 ml',
  pricePaise: 49900, comparePaise: 59900, active: true, updatedAt: '2026-10-07T10:00:00.000Z',
};

function renderEditor({ canWrite = true, canViewCost = false }: { canWrite?: boolean; canViewCost?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <ProductEditor id="leather-cleaner" operatorId="operator-17" canWrite={canWrite} canViewCost={canViewCost} />
  </QueryClientProvider>);
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
  resources.getProduct.mockResolvedValue(product);
  resources.getCategories.mockResolvedValue({ items: categories });
  resources.getCatalogVariants.mockResolvedValue({ items: [catalogVariant] });
  resources.updateProduct.mockResolvedValue({ ...product, name: 'Leather Cleaner · Refined', version: 8 });
  resources.updateVariant.mockResolvedValue({ id: 'cleaner-250', pricePaise: 52900, comparePaise: 59900, active: true, updatedAt: '2026-10-07T10:02:00.000Z' });
  resources.addProductVariant.mockResolvedValue({ ...product, version: 8, variants: [...product.variants, { ...productVariant, id: 'cleaner-500', sku: 'JWX-CLN-500', title: '500 ml', active: false, onHand: 0, reserved: 0 }] });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear(); });

describe('ProductEditor', () => {
  it('renders the backend version and keeps the designer role read-only without cost data', async () => {
    renderEditor({ canWrite: false, canViewCost: false });

    expect(await screen.findByRole('heading', { name: 'Leather Cleaner' })).toBeInTheDocument();
    expect(screen.getByText(/Version 7/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Product name' })).toBeDisabled();
    expect(screen.getByText(/read-only access/i)).toBeInTheDocument();
    expect(screen.queryByText('₹125')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /archive|restore/i })).not.toBeInTheDocument();
  });

  it('shows exact product changes and sends a versioned patch only after explicit review', async () => {
    renderEditor();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Product name' }), { target: { value: 'Leather Cleaner · Refined' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review product changes' }));

    const dialog = await screen.findByRole('dialog', { name: 'Review product changes' });
    expect(within(dialog).getByText('Leather Cleaner')).toBeInTheDocument();
    expect(within(dialog).getByText('Leather Cleaner · Refined')).toBeInTheDocument();
    expect(resources.updateProduct).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save reviewed changes' }));
    await waitFor(() => expect(resources.updateProduct).toHaveBeenCalledWith('leather-cleaner', {
      name: 'Leather Cleaner · Refined', expectedVersion: 7,
    }));
    expect(await screen.findByText(/product changes saved/i)).toBeInTheDocument();
  });

  it('preserves a draft after a version conflict and requires another human-reviewed save', async () => {
    const latest = { ...product, name: 'Leather Cleaner · Server update', version: 8 };
    resources.getProduct.mockResolvedValueOnce(product).mockResolvedValue(latest);
    resources.updateProduct.mockRejectedValueOnce(new ApiError(409, 'CART_VERSION_CONFLICT', 'Product changed', 'product-conflict-7'));
    renderEditor();

    fireEvent.change(await screen.findByRole('textbox', { name: 'Product name' }), { target: { value: 'Leather Cleaner · Owner draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review product changes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save reviewed changes' }));

    const conflict = await screen.findByRole('dialog', { name: 'This changed while you were editing' });
    expect(within(conflict).getByText('Leather Cleaner · Server update')).toBeInTheDocument();
    expect(within(conflict).getByText('Leather Cleaner · Owner draft')).toBeInTheDocument();
    expect(within(conflict).getByText(/product-conflict-7/)).toBeInTheDocument();
    expect(resources.updateProduct).toHaveBeenCalledTimes(1);

    fireEvent.click(within(conflict).getByRole('button', { name: 'Review and merge my changes' }));
    expect(screen.getByRole('textbox', { name: 'Product name' })).toHaveValue('Leather Cleaner · Owner draft');
    fireEvent.click(screen.getByRole('button', { name: 'Review product changes' }));
    const secondReview = await screen.findByRole('dialog', { name: 'Review product changes' });
    expect(within(secondReview).getByText('Leather Cleaner · Server update')).toBeInTheDocument();
    expect(resources.updateProduct).toHaveBeenCalledTimes(1);
  });

  it('reviews price changes with the backend timestamp, reason, and honest quote warning', async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit price for 250 ml' }));
    await screen.findByRole('textbox', { name: 'Selling price (₹)' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Selling price (₹)' }), { target: { value: '529' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Reason for price change/ }), { target: { value: 'Owner approved the revised selling price' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review price change' }));

    const dialog = await screen.findByRole('dialog', { name: 'Review variant price change' });
    expect(within(dialog).getByText('₹499')).toBeInTheDocument();
    expect(within(dialog).getByText('₹529')).toBeInTheDocument();
    expect(within(dialog).getByText(/open checkout quote may be rejected and require a new quote/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/does not bump the store rules version/i)).toBeInTheDocument();
    expect(resources.updateVariant).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save reviewed price change' }));
    await waitFor(() => expect(resources.updateVariant).toHaveBeenCalledWith('cleaner-250', {
      pricePaise: 52900,
      reason: 'Owner approved the revised selling price',
      expectedUpdatedAt: '2026-10-07T10:00:00.000Z',
    }));
  });

  it('does not expose a price write until the authoritative variant timestamp is available', async () => {
    resources.getCatalogVariants.mockRejectedValue(new ApiError(503, 'UNAVAILABLE', 'Catalogue timestamp unavailable', 'variants-read-42'));
    renderEditor();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit price for 250 ml' }));
    expect(await screen.findByText(/price editing is unavailable until the server variant timestamp loads/i)).toBeInTheDocument();
    expect(screen.getByText(/variants-read-42/)).toBeInTheDocument();
    expect(resources.updateVariant).not.toHaveBeenCalled();
  });

  it('never replays an uncertain price write and requires an explicit fresh timestamp before a second review', async () => {
    resources.updateVariant.mockRejectedValueOnce(new ApiError(503, 'UNAVAILABLE', 'The response was lost', 'price-write-77'));
    renderEditor();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit price for 250 ml' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Selling price (₹)' }), { target: { value: '529' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Reason for price change/ }), { target: { value: 'Owner approved the revised selling price' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review price change' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save reviewed price change' }));

    const reload = await screen.findByRole('button', { name: 'Load fresh timestamp and review again' });
    expect(screen.getByRole('button', { name: 'Review price change' })).toBeDisabled();
    expect(resources.updateVariant).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/price-write-77/)).toBeInTheDocument();

    fireEvent.click(reload);
    await screen.findByRole('textbox', { name: 'Selling price (₹)' });
    expect(screen.getByRole('textbox', { name: 'Selling price (₹)' })).toHaveValue('529');
    expect(resources.updateVariant).toHaveBeenCalledTimes(1);
  });

  it('adds a variant only after review and hard-codes the new variant inactive', async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /^Variant ID/ }), { target: { value: 'cleaner-500' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'SKU' }), { target: { value: 'JWX-CLN-500' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Variant title' }), { target: { value: '500 ml' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Selling price \(₹\)/ }), { target: { value: '799' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Reason for adding this variant/ }), { target: { value: 'Add the 500 ml size' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review variant' }));

    const dialog = await screen.findByRole('dialog', { name: 'Review new variant' });
    expect(within(dialog).getByText('₹799.00')).toBeInTheDocument();
    expect(within(dialog).getByText(/inactive.*not available for purchase/i)).toBeInTheDocument();
    expect(resources.addProductVariant).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add inactive variant' }));

    await waitFor(() => expect(resources.addProductVariant).toHaveBeenCalledWith('leather-cleaner', expect.objectContaining({
      id: 'cleaner-500', sku: 'JWX-CLN-500', pricePaise: 79900, active: false,
    }), { expectedVersion: product.version, reason: 'Add the 500 ml size' }));
    expect(resources.addProductVariant).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/variant added in an inactive state/i)).toBeInTheDocument();
  });

  it('does not retry an uncertain add-variant request and labels a match unattributed', async () => {
    resources.addProductVariant.mockRejectedValueOnce(new ApiError(503, 'UNAVAILABLE', 'Response lost', 'variant-write-6'));
    resources.getProduct.mockResolvedValueOnce(product).mockResolvedValue({ ...product, version: 8, variants: [...product.variants, { ...productVariant, id: 'cleaner-500', sku: 'JWX-CLN-500', title: '500 ml', active: false, onHand: 0, reserved: 0 }] });
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /^Variant ID/ }), { target: { value: 'cleaner-500' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'SKU' }), { target: { value: 'JWX-CLN-500' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Variant title' }), { target: { value: '500 ml' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Selling price \(₹\)/ }), { target: { value: '799' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Reason for adding this variant/ }), { target: { value: 'Add the 500 ml size' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review variant' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add inactive variant' }));

    expect(await screen.findByText(/matching variant.*found.*attribution cannot be confirmed/i)).toBeInTheDocument();
    expect(screen.getByText(/variant-write-6/)).toBeInTheDocument();
    expect(resources.addProductVariant).toHaveBeenCalledTimes(1);
    expect(resources.getProduct).toHaveBeenCalledWith('leather-cleaner');
    expect(screen.queryByRole('button', { name: /add inactive variant/i })).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductCreate } from '@/features/catalog/product-create';
import { ApiError } from '@/lib/api/errors';
import type { Product, ProductVariant } from '@/lib/api/resources/catalog';

const resources = vi.hoisted(() => ({ getCategories: vi.fn(), createProduct: vi.fn(), getProduct: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/api/resources/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/resources/catalog')>();
  return { ...actual, getCategories: resources.getCategories, createProduct: resources.createProduct, getProduct: resources.getProduct };
});

const variant: ProductVariant = {
  id: 'care-kit-small', sku: 'JWX-CARE-S', title: 'Small', pricePaise: 49950, compareAtPricePaise: null,
  active: false, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, hsnCode: null, barcode: null,
  onHand: 0, reserved: 0, lowStockThreshold: null,
};
const product: Product = {
  id: 'care-kit', name: 'Care Kit', subtitle: '', description: '', categoryId: 'care', categoryName: 'Care',
  keyBenefits: [], suitableSurfaces: null, boxContents: null, tags: [], seoTitle: null, seoDescription: null,
  active: false, archived: false, sortOrder: 0, version: 1, image: null, variants: [variant], updatedAt: '2026-10-07T10:00:00.000Z',
};

function renderCreate({ canWrite = true, canViewCost = false }: { canWrite?: boolean; canViewCost?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ProductCreate canWrite={canWrite} canViewCost={canViewCost} /></QueryClientProvider>);
}

function fillMinimumProduct() {
  fireEvent.change(screen.getByRole('textbox', { name: /^Product ID/ }), { target: { value: 'care-kit' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Product name' }), { target: { value: 'Care Kit' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'care' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^Variant 1 ID/ }), { target: { value: 'care-kit-small' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Variant 1 SKU' }), { target: { value: 'JWX-CARE-S' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Variant 1 title' }), { target: { value: 'Small' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^Variant 1 selling price \(₹\)/ }), { target: { value: '499.50' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^Variant 2 ID/ }), { target: { value: 'care-kit-large' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Variant 2 SKU' }), { target: { value: 'JWX-CARE-L' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Variant 2 title' }), { target: { value: 'Large' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^Variant 2 selling price \(₹\)/ }), { target: { value: '799' } });
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
  resources.getCategories.mockResolvedValue({ items: [{ id: 'care', name: 'Care', description: '', imageMediaId: null, seoTitle: null, seoDescription: null, active: true, sortOrder: 1 }] });
  resources.createProduct.mockResolvedValue(product);
  resources.getProduct.mockResolvedValue(product);
});

afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear(); });

describe('ProductCreate', () => {
  it('requires catalog write capability and does not expose the form to read-only roles', () => {
    renderCreate({ canWrite: false });
    expect(screen.getByText(/catalogue creation is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Product ID' })).not.toBeInTheDocument();
    expect(resources.getCategories).not.toHaveBeenCalled();
  });

  it('loads active categories and presents two blank variants without stock/media/activation controls', async () => {
    renderCreate();
    expect(await screen.findByRole('combobox', { name: 'Category' })).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Care' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Variant 2 ID/ })).toBeInTheDocument();
    expect(screen.getByText(/each variant starts with zero stock/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/on hand|media|available for purchase/i)).not.toBeInTheDocument();
  });

  it('reviews exact inactive product and variants before one submission', async () => {
    renderCreate();
    await screen.findByRole('combobox', { name: 'Category' });
    fillMinimumProduct();
    fireEvent.click(screen.getByRole('button', { name: 'Review new product' }));

    const dialog = await screen.findByRole('dialog', { name: 'Review new product' });
    expect(dialog).toHaveTextContent('₹499.50');
    expect(within(dialog).getByText(/inactive.*not available for purchase/i)).toBeInTheDocument();
    expect(resources.createProduct).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create inactive product' }));

    await waitFor(() => expect(resources.createProduct).toHaveBeenCalledWith(expect.objectContaining({
      id: 'care-kit', active: false, media: [],
      variants: [expect.objectContaining({ id: 'care-kit-small', pricePaise: 49950, active: false }), expect.objectContaining({ id: 'care-kit-large', pricePaise: 79900, active: false })],
    })));
    expect(resources.createProduct).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/products/care-kit');
  });

  it('fails closed without an active backend category', async () => {
    resources.getCategories.mockResolvedValue({ items: [{ id: 'care', name: 'Care', description: '', imageMediaId: null, seoTitle: null, seoDescription: null, active: false, sortOrder: 1 }] });
    renderCreate();
    expect(await screen.findByRole('heading', { name: 'Create an active category first' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Category' })).not.toBeInTheDocument();
    expect(resources.createProduct).not.toHaveBeenCalled();
  });

  it('shows backend field validation inline with the request reference and permits an edited review', async () => {
    resources.createProduct.mockRejectedValueOnce(new ApiError(422, 'VALIDATION_FAILED', 'Product ID is already used.', 'product-id-9', false, { id: 'Choose another immutable product ID.' }));
    renderCreate();
    await screen.findByRole('combobox', { name: 'Category' });
    fillMinimumProduct();
    fireEvent.click(screen.getByRole('button', { name: 'Review new product' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create inactive product' }));

    expect(await screen.findByText('Choose another immutable product ID.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Product ID/ })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/product-id-9/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /^Product ID/ }), { target: { value: 'care-kit-owner' } });
    expect(screen.queryByText('Choose another immutable product ID.')).not.toBeInTheDocument();
    expect(resources.createProduct).toHaveBeenCalledTimes(1);
  });

  it('never retries an uncertain create and labels a read-after-write match as unattributed', async () => {
    resources.createProduct.mockRejectedValueOnce(new ApiError(503, 'UNAVAILABLE', 'Response unavailable', 'product-create-8'));
    renderCreate();
    await screen.findByRole('combobox', { name: 'Category' });
    fillMinimumProduct();
    fireEvent.click(screen.getByRole('button', { name: 'Review new product' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create inactive product' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/found.*cannot be attributed to that record/i);
    expect(screen.getByText(/product-create-8/)).toBeInTheDocument();
    expect(resources.createProduct).toHaveBeenCalledTimes(1);
    expect(resources.getProduct).toHaveBeenCalledWith('care-kit');
    expect(screen.queryByRole('button', { name: /create inactive product/i })).not.toBeInTheDocument();
  });
});

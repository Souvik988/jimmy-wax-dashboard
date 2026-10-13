// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCategoryPatch, CategoryList } from '@/features/catalog/category-list';
import { CollectionDelete } from '@/features/catalog/collection-delete';
import { ApiError } from '@/lib/api/errors';
import type { Category, Collection } from '@/lib/api/resources/catalog';

const resources = vi.hoisted(() => ({ updateCategory: vi.fn(), reorderCategories: vi.fn(), deleteCategory: vi.fn(), deleteCollection: vi.fn() }));
vi.mock('@/lib/api/resources/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/resources/catalog')>()), ...resources }));

const polish: Category = { id: 'polish', name: 'Polish', description: 'Shoe polish', imageMediaId: null, seoTitle: null, seoDescription: null, active: true, sortOrder: 1, productCount: 2, archivedProductCount: 0, rev: 4, updatedAt: '2026-10-07T10:00:00.000Z' };
const brushes: Category = { ...polish, id: 'brushes', name: 'Brushes', sortOrder: 2, productCount: 0, archivedProductCount: 0, rev: 9 };
const retired: Category = { ...polish, id: 'retired', name: 'Retired', sortOrder: 3, productCount: 0, archivedProductCount: 2, rev: 2 };
const collection: Collection = {
  id: 'gift-sets', name: 'Gift sets', description: '', kind: 'manual', productIds: [], rule: null, visible: true, seoTitle: null, seoDescription: null, rev: 6, updatedAt: '2026-10-07T10:00:00.000Z',
};

function wrap(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
}

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('buildCategoryPatch', () => {
  it('sends only changed fields plus the loaded revision', () => {
    expect(buildCategoryPatch(polish, { name: 'Polish', description: 'Shoe polish', seoTitle: '', seoDescription: '', active: true })).toBeNull();
    expect(buildCategoryPatch(polish, { name: 'Polishes ', description: 'Shoe polish', seoTitle: 'Buy polish', seoDescription: '', active: false })).toEqual({ expectedRev: 4, name: 'Polishes', seoTitle: 'Buy polish', active: false });
  });
});

describe('CategoryList', () => {
  it('offers no write controls to a read-only operator', () => {
    wrap(<CategoryList categories={[polish, brushes]} canWrite={false} />);
    expect(screen.queryByRole('button', { name: /edit|delete|move/i })).not.toBeInTheDocument();
  });

  it('disables deleting while live or archived products still use a category', () => {
    wrap(<CategoryList categories={[polish, brushes, retired]} canWrite />);
    expect(screen.getByRole('button', { name: 'Delete Polish' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Retired' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Brushes' })).toBeEnabled();
  });

  it('edits with the loaded revision and refuses to save an untouched form', async () => {
    resources.updateCategory.mockResolvedValue({ ...polish, name: 'Polishes', rev: 5 });
    wrap(<CategoryList categories={[polish, brushes]} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Polish' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Polish' });
    const save = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Save changes')!;
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /Category name/ }), { target: { value: 'Polishes' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(resources.updateCategory).toHaveBeenCalledWith('polish', { expectedRev: 4, name: 'Polishes' }));
  });

  it('saves a new order with every loaded revision', async () => {
    resources.reorderCategories.mockResolvedValue(undefined);
    wrap(<CategoryList categories={[polish, brushes]} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Brushes up' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save category order' }));
    await waitFor(() => expect(resources.reorderCategories).toHaveBeenCalledWith(['brushes', 'polish'], { polish: 4, brushes: 9 }));
  });

  it('lists the products that block a delete', async () => {
    resources.deleteCategory.mockRejectedValue(new ApiError(409, 'ILLEGAL_STATE', 'In use.', 'req-1', false, undefined, [{ type: 'product', id: 'old-brush', label: 'Old brush', archived: true }]));
    wrap(<CategoryList categories={[polish, brushes]} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Brushes' }));
    fireEvent.change(await screen.findByLabelText(/Type DELETE CATEGORY to continue/), { target: { value: 'DELETE CATEGORY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('list', { name: 'Products that block deleting this category' })).toHaveTextContent('Old brush');
    expect(screen.getByText(/Not deleted: products still use this category/)).toBeInTheDocument();
  });
});

describe('CollectionDelete', () => {
  it('sends the loaded revision and a reason', async () => {
    resources.deleteCollection.mockResolvedValue(undefined);
    const onResult = vi.fn();
    wrap(<CollectionDelete collection={collection} onResult={onResult} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Gift sets' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Gift sets' });
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: 'Season is over' } });
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Continue')!);
    await waitFor(() => expect(resources.deleteCollection).toHaveBeenCalledWith('gift-sets', { expectedRev: 6, reason: 'Season is over' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ kind: 'deleted', message: 'Deleted Gift sets.' }));
  });

  it('reports Studio references that block the delete', async () => {
    resources.deleteCollection.mockRejectedValue(new ApiError(409, 'ILLEGAL_STATE', 'In use.', 'req-2', false, undefined, [{ type: 'studio_live', id: 'web', label: 'Live website release #5' }]));
    const onResult = vi.fn();
    wrap(<CollectionDelete collection={collection} onResult={onResult} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Gift sets' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Gift sets' });
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: 'Season is over' } });
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Continue')!);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ kind: 'blocked', blockers: [{ type: 'studio_live', id: 'web', label: 'Live website release #5' }] })));
  });
});

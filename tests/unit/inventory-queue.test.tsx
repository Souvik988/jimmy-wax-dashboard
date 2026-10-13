// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InventoryQueue } from '@/features/catalog/inventory-queue';
import { ApiError } from '@/lib/api/errors';
import type { InventoryMovement, InventoryRow } from '@/lib/api/resources/catalog';

const resources = vi.hoisted(() => ({ getInventory: vi.fn(), getInventoryMovements: vi.fn(), adjustInventory: vi.fn() }));
vi.mock('@/lib/api/resources/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/resources/catalog')>();
  return {
    ...actual,
    getInventory: resources.getInventory,
    getInventoryMovements: resources.getInventoryMovements,
    adjustInventory: resources.adjustInventory,
  };
});

const inventory: InventoryRow[] = [
  { variantId: 'cleaner-250', sku: 'JWX-CLN-250', name: 'Leather Cleaner', variantTitle: '250 ml', onHand: 12, reserved: 2, available: 10, lowStockThreshold: 4, version: 3 },
  { variantId: 'conditioner-250', sku: 'JWX-CND-250', name: 'Leather Conditioner', variantTitle: '250 ml', onHand: 0, reserved: 0, available: 0, lowStockThreshold: null, version: 1 },
];

const firstMovement: InventoryMovement = {
  id: 91, kind: 'adjustment', deltaOnHand: -2, deltaReserved: 0,
  reason: 'Damaged units removed', refType: 'admin', createdAt: '2026-10-07T10:00:00.000Z',
};
const secondMovement: InventoryMovement = {
  id: 90, kind: 'receipt', deltaOnHand: 5, deltaReserved: 0,
  reason: 'Supplier delivery received', refType: 'admin', createdAt: '2026-10-07T09:00:00.000Z',
};

function renderQueue(rows: InventoryRow[] = inventory, canAdjust = false) {
  resources.getInventory.mockResolvedValue({ items: rows });
  resources.getInventoryMovements.mockResolvedValue({ items: [firstMovement], nextCursor: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><InventoryQueue canAdjust={canAdjust} /></QueryClientProvider>);
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.replaceState({}, '', '/'); });

describe('InventoryQueue', () => {
  it('shows backend balances and read-only thresholds without offering a stock mutation', async () => {
    renderQueue();

    expect(await screen.findByText('Leather Cleaner')).toBeInTheDocument();
    const balance = within(screen.getByLabelText('Stock balance for Leather Cleaner 250 ml'));
    expect(balance.getByText('Available')).toBeInTheDocument();
    expect(balance.getByText('10')).toBeInTheDocument();
    expect(balance.getByText('On hand')).toBeInTheDocument();
    expect(balance.getByText('12')).toBeInTheDocument();
    expect(balance.getByText('Reserved')).toBeInTheDocument();
    expect(balance.getByText('2')).toBeInTheDocument();
    expect(balance.getByText('Low-stock threshold')).toBeInTheDocument();
    expect(balance.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /adjust stock|receive stock/i })).not.toBeInTheDocument();
  });

  it('filters only the complete, non-cursor inventory snapshot and identifies that scope', async () => {
    renderQueue();
    await screen.findByText('Leather Cleaner');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search inventory' }), { target: { value: 'conditioner' } });

    await waitFor(() => expect(screen.queryByText('Leather Cleaner')).not.toBeInTheDocument());
    expect(screen.getByText('Leather Conditioner')).toBeInTheDocument();
    expect(screen.getByText(/search applies to the complete inventory snapshot/i)).toBeInTheDocument();
    expect(resources.getInventory).toHaveBeenCalledTimes(1);
  });

  it('opens the selected variant ledger and follows only its returned opaque cursor', async () => {
    resources.getInventory.mockResolvedValue({ items: inventory });
    resources.getInventoryMovements
      .mockResolvedValueOnce({ items: [firstMovement], nextCursor: 'older-movements' })
      .mockResolvedValueOnce({ items: [secondMovement], nextCursor: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><InventoryQueue /></QueryClientProvider>);
    await screen.findByText('Leather Cleaner');

    fireEvent.click(screen.getByRole('button', { name: 'View movement history for Leather Cleaner · 250 ml' }));
    expect(await screen.findByText('Damaged units removed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load older movements' }));
    expect(await screen.findByText('Supplier delivery received')).toBeInTheDocument();
    expect(resources.getInventoryMovements).toHaveBeenNthCalledWith(2, 'cleaner-250', 'older-movements', expect.any(AbortSignal));
  });

  it('shows a real empty inventory response without placeholder variants', async () => {
    renderQueue([]);

    expect(await screen.findByRole('heading', { name: 'No inventory positions' })).toBeInTheDocument();
    expect(screen.getByText(/No sample inventory is shown/i)).toBeInTheDocument();
    expect(screen.queryByText('Leather Cleaner')).not.toBeInTheDocument();
  });

  it('offers no adjustment control to inventory readers without inventory:write', async () => {
    renderQueue(inventory, false);

    await screen.findByText('Leather Cleaner');
    expect(screen.queryByRole('button', { name: /adjust stock for/i })).not.toBeInTheDocument();
  });

  it('previews the signed change and submits exactly one versioned adjustment after review', async () => {
    resources.adjustInventory.mockResolvedValue({ variantId: 'cleaner-250', onHand: 13, reserved: 2, version: 4 });
    renderQueue(inventory, true);
    await screen.findByText('Leather Cleaner');
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock for Leather Cleaner · 250 ml' }));

    expect(await screen.findByRole('dialog', { name: /Review stock adjustment/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Signed change in on-hand units/ }), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Reason · required/ }), { target: { value: 'Physical stock count' } });
    expect(screen.getByText('Projected available').parentElement).toHaveTextContent('11');
    fireEvent.click(screen.getByRole('button', { name: 'Apply adjustment' }));

    expect(await screen.findByText('Adjustment recorded')).toBeInTheDocument();
    expect(resources.adjustInventory).toHaveBeenCalledTimes(1);
    expect(resources.adjustInventory).toHaveBeenCalledWith('cleaner-250', { delta: 1, reason: 'Physical stock count', expectedVersion: 3 });
  });

  it('blocks a reduction that would consume units already reserved by checkout', async () => {
    renderQueue(inventory, true);
    await screen.findByText('Leather Cleaner');
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock for Leather Cleaner · 250 ml' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /Signed change in on-hand units/ }), { target: { value: '-11' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Reason · required/ }), { target: { value: 'Physical stock count' } });

    expect(screen.getByRole('alert')).toHaveTextContent('below the 2 units already reserved');
    expect(screen.getByRole('button', { name: 'Apply adjustment' })).toBeDisabled();
    expect(resources.adjustInventory).not.toHaveBeenCalled();
  });

  it('does not retry a stale adjustment and asks the operator to start from the refreshed version', async () => {
    resources.adjustInventory.mockRejectedValueOnce(new ApiError(409, 'CART_VERSION_CONFLICT', 'Stock changed since you loaded it.', 'req-inv-conflict', false));
    renderQueue(inventory, true);
    await screen.findByText('Leather Cleaner');
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock for Leather Cleaner · 250 ml' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /Signed change in on-hand units/ }), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Reason · required/ }), { target: { value: 'Physical stock count' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply adjustment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Stock changed or the adjustment is no longer valid');
    expect(screen.getByRole('button', { name: 'Apply adjustment' })).toBeDisabled();
    expect(resources.adjustInventory).toHaveBeenCalledTimes(1);
  });

  it('withholds another adjustment after an uncertain response and preserves the request id', async () => {
    resources.adjustInventory.mockRejectedValueOnce(new ApiError(503, 'UNAVAILABLE', 'The response was not confirmed.', 'req-inv-unknown', true));
    renderQueue(inventory, true);
    await screen.findByText('Leather Cleaner');
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock for Leather Cleaner · 250 ml' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /Signed change in on-hand units/ }), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Reason · required/ }), { target: { value: 'Physical stock count' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply adjustment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Outcome not confirmed');
    expect(screen.getByRole('alert')).toHaveTextContent('req-inv-unknown');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Adjustment outcome unknown for Leather Cleaner · 250 ml' })).toBeDisabled();
    expect(resources.adjustInventory).toHaveBeenCalledTimes(1);
  });

  it('shows the backend request id when inventory is unavailable', async () => {
    resources.getInventory.mockRejectedValueOnce(new ApiError(503, 'UNAVAILABLE', 'Inventory backend is not ready.', 'req-inv-503', false));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><InventoryQueue /></QueryClientProvider>);

    expect(await screen.findByRole('heading', { name: 'Inventory service unavailable' })).toBeInTheDocument();
    expect(screen.getByText(/req-inv-503/)).toBeInTheDocument();
  });
});

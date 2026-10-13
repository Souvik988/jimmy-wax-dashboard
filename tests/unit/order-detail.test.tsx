// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrderDetail } from '@/features/orders/order-detail';
import type { AdminOrderDetail } from '@/lib/api/resources/orders';
import type { SafeOperator } from '@/lib/auth/permissions';

const resources = vi.hoisted(() => ({
  getOrder: vi.fn(),
  getOrderNotes: vi.fn(),
  getOrderInvoice: vi.fn(),
  issueOrderInvoice: vi.fn(),
}));

vi.mock('@/lib/api/resources/orders', () => ({
  getOrder: resources.getOrder,
  getOrderNotes: resources.getOrderNotes,
  getOrderInvoice: resources.getOrderInvoice,
  issueOrderInvoice: resources.issueOrderInvoice,
  addOrderNote: vi.fn(),
  cancelOrder: vi.fn(),
  resendOrderConfirmation: vi.fn(),
  transitionOrder: vi.fn(),
}));

const operator: SafeOperator = { userId: '11111111-1111-4111-8111-111111111111', role: 'support', permissions: ['orders:read', 'customers:read', 'customers:write', 'reviews:moderate', 'media:read', 'shipping:read'], mfa: false, aal: 'aal1' };
const order: AdminOrderDetail = {
  id: '22222222-2222-4222-8222-222222222222', orderNumber: 'JW-20261007-TEST', status: 'cancelled', paymentStatus: 'refunded', paymentMethod: 'online', version: 4,
  subtotalPaise: 29900, discountPaise: 0, taxPaise: 4561, shippingPaise: 0, codFeePaise: 0, taxInclusive: true, totalPaise: 29900, currency: 'INR',
  address: { name: 'Buyer', city: 'Pune', state: 'MH', pin: '411001' }, createdAt: '2026-10-07T04:00:00.000Z',
  lines: [{ sku: 'POLISH-50', productName: 'Leather polish', variantTitle: '50 ml', unitPricePaise: 29900, quantity: 1, lineTotalPaise: 29900 }],
  paymentAttempts: [],
  refunds: [{ id: '33333333-3333-4333-8333-333333333333', status: 'processed', amountPaise: 29900, reason: 'Customer requested cancellation' }],
};

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('OrderDetail', () => {
  it('shows backend-provided refund state, amount and reason without exposing a processing control', async () => {
    resources.getOrder.mockResolvedValue(order);
    resources.getOrderNotes.mockResolvedValue({ items: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><OrderDetail id={order.id} operator={operator} /></QueryClientProvider>);

    expect(await screen.findByRole('heading', { name: 'Refunds' })).toBeTruthy();
    expect(screen.getByText('processed · ₹299')).toBeTruthy();
    expect(screen.getByText('Customer requested cancellation')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /process refund/i })).toBeNull();
  });

  it('lets support read an issued invoice but never offers to issue one', async () => {
    resources.getOrder.mockResolvedValue({ ...order, status: 'processing' });
    resources.getOrderNotes.mockResolvedValue({ items: [] });
    resources.getOrderInvoice.mockResolvedValue(null);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><OrderDetail id={order.id} operator={operator} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole('button', { name: 'View GST invoice' }));
    expect(await screen.findByText(/No invoice has been issued for this order yet\./u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Issue GST invoice' })).toBeNull();
    expect(resources.issueOrderInvoice).not.toHaveBeenCalled();
  });

  it('issues the invoice with POST and a reason, only after a read finds none', async () => {
    const fulfillment: SafeOperator = { ...operator, role: 'fulfillment', permissions: ['orders:read', 'orders:fulfil', 'orders:cancel', 'inventory:read', 'inventory:write', 'customers:read', 'shipping:read', 'shipping:write', 'analytics:read'] };
    resources.getOrder.mockResolvedValue({ ...order, status: 'processing' });
    resources.getOrderNotes.mockResolvedValue({ items: [] });
    resources.getOrderInvoice.mockResolvedValue(null);
    resources.issueOrderInvoice.mockRejectedValue(new Error('stop after assertion'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><OrderDetail id={order.id} operator={fulfillment} /></QueryClientProvider>);

    expect(screen.queryByRole('button', { name: 'Issue GST invoice' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'View GST invoice' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Issue GST invoice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Issue this GST invoice' });
    await userEvent.type(dialog.querySelector('textarea')!, 'Customer asked for a tax invoice');
    await userEvent.click(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Continue')!);
    await waitFor(() => expect(resources.issueOrderInvoice).toHaveBeenCalledWith(order.id, 'Customer asked for a tax invoice'));
  });
});

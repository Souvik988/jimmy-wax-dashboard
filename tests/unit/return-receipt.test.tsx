// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReturnReceipt } from '@/features/shipping/return-receipt';
const resources = vi.hoisted(() => ({ receiveReturn: vi.fn() }));
vi.mock('@/lib/api/resources/shipping', () => ({ receiveReturn: resources.receiveReturn }));
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('requires physical receipt confirmation and distinguishes manual COD refunds from payment', async () => {
  const item = { id: '11111111-1111-4111-8111-111111111111', orderId: '22222222-2222-4222-8222-222222222222', orderNumber: 'JW-TEST', status: 'approved' as const, reason: 'Damaged', items: [], createdAt: '2026-10-25T00:00:00Z' };
  resources.receiveReturn.mockResolvedValue({ id: item.id, status: 'received', refundValuePaise: 59900, refundQueued: false, manualRefundRequired: true });
  render(<QueryClientProvider client={new QueryClient()}><ReturnReceipt item={item} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Receive return JW-TEST' }));
  expect(resources.receiveReturn).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Type RECEIVE RETURN to continue/), { target: { value: 'RECEIVE RETURN' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(resources.receiveReturn).toHaveBeenCalledExactlyOnceWith(item.id));
  expect(await screen.findByRole('status')).toHaveTextContent('Arrange and reconcile the COD refund manually');
});

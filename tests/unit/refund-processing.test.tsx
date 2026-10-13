// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReturnsRefunds } from '@/features/shipping/returns-refunds';
import { ApiError } from '@/lib/api/errors';

const resources = vi.hoisted(() => ({ getReturns: vi.fn(), getRefunds: vi.fn(), decideReturn: vi.fn(), processRefund: vi.fn(), getSettings: vi.fn() }));
vi.mock('@/lib/api/resources/shipping', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/resources/shipping')>()), getReturns: resources.getReturns, getRefunds: resources.getRefunds, decideReturn: resources.decideReturn, processRefund: resources.processRefund }));
vi.mock('@/lib/api/resources/overview', () => ({ getSettings: resources.getSettings }));

const base = { orderId: '11111111-1111-4111-8111-111111111111', amountPaise: 29900, reason: 'Return approved', createdAt: '2026-10-07T01:00:00.000Z' };
const ready = { ...base, id: 'aaaaaaaa-1111-4111-8111-111111111111', status: 'requested', processable: true, blockedReason: null };
const cod = { ...base, id: 'bbbbbbbb-1111-4111-8111-111111111111', status: 'requested', processable: false, blockedReason: 'no_online_payment' };
const done = { ...base, id: 'cccccccc-1111-4111-8111-111111111111', status: 'processed', processable: false, blockedReason: 'already_processed' };
const connected = { configured: true, provider: 'razorpay', mode: 'test' };

function renderCenter(canProcessRefunds: boolean): void {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <ReturnsRefunds canDecideReturns={false} canViewRefunds canProcessRefunds={canProcessRefunds} canViewReturnPolicy={false} />
  </QueryClientProvider>);
}

beforeEach(() => {
  resources.getReturns.mockResolvedValue({ items: [] });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('refund processing', () => {
  it('offers Process refund only for rows the backend marks processable, and only to roles that may send refunds', async () => {
    resources.getRefunds.mockResolvedValue({ items: [ready, cod, done], nextCursor: null, paymentCapability: connected });
    renderCenter(true);
    expect(await screen.findAllByRole('button', { name: 'Process refund' })).toHaveLength(1);
    expect(screen.getByText('Not an online payment: pay this one manually')).toBeInTheDocument();
    expect(screen.getByText(/connected through razorpay in test mode/i)).toBeInTheDocument();
  });

  it('is read-only for a role without refunds:write, even when a refund is processable', async () => {
    resources.getRefunds.mockResolvedValue({ items: [ready], nextCursor: null, paymentCapability: connected });
    renderCenter(false);
    expect(await screen.findByText(/Your role can see refund status but not send refunds/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Process refund' })).not.toBeInTheDocument();
  });

  it('says plainly that nothing can be sent when no gateway is connected', async () => {
    resources.getRefunds.mockResolvedValue({ items: [{ ...ready, processable: false, blockedReason: 'no_gateway' }], nextCursor: null, paymentCapability: { configured: false, provider: null, mode: null } });
    renderCenter(true);
    expect(await screen.findByText(/No payment gateway is connected, so no refund can be sent/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Process refund' })).not.toBeInTheDocument();
  });

  it('needs the typed confirmation before sending and then reloads the register', async () => {
    resources.getRefunds.mockResolvedValue({ items: [ready], nextCursor: null, paymentCapability: connected });
    resources.processRefund.mockResolvedValue({ id: ready.id, status: 'processed' });
    renderCenter(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Process refund' }));
    expect(resources.processRefund).not.toHaveBeenCalled();
    fireEvent.change(await screen.findByLabelText(/Type PROCESS REFUND to continue/), { target: { value: 'PROCESS REFUND' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(resources.processRefund).toHaveBeenCalledWith(ready.id));
    expect(await screen.findByText(/was processed/)).toBeInTheDocument();
    await waitFor(() => expect(resources.getRefunds).toHaveBeenCalledTimes(2));
  });

  it('reports a gateway failure without claiming success', async () => {
    resources.getRefunds.mockResolvedValue({ items: [ready], nextCursor: null, paymentCapability: connected });
    resources.processRefund.mockResolvedValue({ id: ready.id, status: 'failed' });
    renderCenter(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Process refund' }));
    fireEvent.change(await screen.findByLabelText(/Type PROCESS REFUND to continue/), { target: { value: 'PROCESS REFUND' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not complete the refund/i);
  });

  it('explains a missing gateway when the backend refuses', async () => {
    resources.getRefunds.mockResolvedValue({ items: [ready], nextCursor: null, paymentCapability: connected });
    resources.processRefund.mockRejectedValue(new ApiError(422, 'UNSUPPORTED_PAYMENT_METHOD', 'raw backend text', 'req-5'));
    renderCenter(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Process refund' }));
    fireEvent.change(await screen.findByLabelText(/Type PROCESS REFUND to continue/), { target: { value: 'PROCESS REFUND' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No payment gateway is configured/);
    expect(screen.getByRole('alert')).toHaveTextContent('req-5');
  });
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReturnsRefunds } from '@/features/shipping/returns-refunds';
import { ApiError } from '@/lib/api/errors';
import type { AdminReturn, RefundRecord, ReturnStatus } from '@/lib/api/resources/shipping';

const resources = vi.hoisted(() => ({
  getReturns: vi.fn(),
  getRefunds: vi.fn(),
  decideReturn: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock('@/lib/api/resources/shipping', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api/resources/shipping')>(),
  getReturns: resources.getReturns,
  getRefunds: resources.getRefunds,
  decideReturn: resources.decideReturn,
}));
vi.mock('@/lib/api/resources/overview', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api/resources/overview')>(),
  getSettings: resources.getSettings,
}));

const requested: AdminReturn = {
  id: '08fb8ac0-b78b-46a4-8733-412bb2cd01c1',
  orderId: '5396faa7-139e-4054-8c4e-ac6c73525118',
  orderNumber: 'JW-20261007-5396FAA7',
  status: 'requested',
  reason: 'The bottle arrived damaged.',
  items: [{ sku: 'LEATHER-CARE-KIT', name: 'Leather Care Kit', quantity: 1 }],
  createdAt: '2026-10-06T20:00:00.000Z',
};
const approved: AdminReturn = { ...requested, id: '304c824a-f2e0-4ad2-b295-849bf0f7c2b7', status: 'approved' };
const refund: RefundRecord = {
  id: 'b88ba65a-a646-4cd4-8183-e5a5a7c1c7ab',
  orderId: requested.orderId,
  amountPaise: 123456,
  status: 'queued',
  reason: 'Return approved',
  createdAt: '2026-10-07T01:00:00.000Z',
};

function renderCenter({
  canDecideReturns = false,
  canViewRefunds = false,
  canViewReturnPolicy = false,
}: { canDecideReturns?: boolean; canViewRefunds?: boolean; canViewReturnPolicy?: boolean } = {}): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>
    <ReturnsRefunds canDecideReturns={canDecideReturns} canViewRefunds={canViewRefunds} canViewReturnPolicy={canViewReturnPolicy} />
  </QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});

describe('returns and refunds centre', () => {
  it('shows the backend empty state and does not request refunds without payments:read', async () => {
    resources.getReturns.mockResolvedValue({ items: [] });
    renderCenter();

    expect(await screen.findByRole('heading', { name: 'No return requests' })).toBeInTheDocument();
    expect(screen.getByText(/most recent 100/i)).toBeInTheDocument();
    expect(resources.getReturns).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
    expect(resources.getRefunds).not.toHaveBeenCalled();
    expect(resources.getSettings).not.toHaveBeenCalled();
  });

  it('keeps return decisions and inventory receipt role-gated', async () => {
    resources.getReturns.mockResolvedValue({ items: [requested, approved] });
    renderCenter();

    expect(await screen.findAllByRole('link', { name: 'Open order JW-20261007-5396FAA7' })).toHaveLength(2);
    expect(screen.getByText(/receipt requires fulfilment and inventory write/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve return/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /decline return/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /receive return|restock/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /process refund/i })).not.toBeInTheDocument();
  });

  it('requires a decision note, records approval once, then refreshes the authoritative list', async () => {
    const user = userEvent.setup();
    resources.getReturns.mockResolvedValue({ items: [requested] });
    resources.decideReturn.mockResolvedValue(undefined);
    renderCenter({ canDecideReturns: true });

    await user.click(await screen.findByRole('button', { name: 'Approve return JW-20261007-5396FAA7' }));
    expect(screen.getByText(/does not receive or restock the item/i)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Record approval' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /Decision note/ }), 'Inspection confirms the reported damage.');
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(resources.decideReturn).toHaveBeenCalledTimes(1);
    expect(resources.decideReturn).toHaveBeenCalledWith(requested.id, { approve: true, note: 'Inspection confirms the reported damage.' });
    expect(await screen.findByRole('status')).toHaveTextContent(/decision recorded/i);
    await waitFor(() => expect(resources.getReturns).toHaveBeenCalledTimes(2));
  });

  it('uses backend status filters and shows refunds as read-only integer paise', async () => {
    const user = userEvent.setup();
    resources.getReturns.mockImplementation(async (status?: ReturnStatus) => ({ items: status === 'approved' ? [approved] : [] }));
    resources.getRefunds.mockResolvedValue({ items: [refund] });
    renderCenter({ canViewRefunds: true });

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Return status' }), 'approved');
    expect(await screen.findByText('₹1,234.56')).toBeInTheDocument();
    expect(resources.getReturns).toHaveBeenCalledWith('approved', expect.any(AbortSignal));
    expect(screen.getByText(/provider readiness and captured-payment eligibility are not available/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /process refund/i })).not.toBeInTheDocument();
    expect(screen.getByText('Queued', { exact: true })).toBeInTheDocument();
  });

  it('loads only the non-sensitive return window for operators allowed to read settings', async () => {
    resources.getReturns.mockResolvedValue({ items: [] });
    resources.getSettings.mockResolvedValue({ settings: { returnWindowDays: 14 } });
    renderCenter({ canViewReturnPolicy: true });

    expect(await screen.findByRole('heading', { name: 'Return window' })).toBeInTheDocument();
    expect(await screen.findByText('14 days')).toBeInTheDocument();
    expect(resources.getSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/GSTIN|merchant legal name/i)).not.toBeInTheDocument();
  });

  it('surfaces a decision refusal with its request id without retrying', async () => {
    const user = userEvent.setup();
    resources.getReturns.mockResolvedValue({ items: [requested] });
    resources.decideReturn.mockRejectedValue(new ApiError(409, 'ILLEGAL_STATE', 'This return is no longer pending.', 'return-conflict-7'));
    renderCenter({ canDecideReturns: true });

    await user.click(await screen.findByRole('button', { name: 'Decline return JW-20261007-5396FAA7' }));
    await user.type(screen.getByRole('textbox', { name: /Decision note/ }), 'The item does not match policy.');
    await user.click(screen.getByRole('button', { name: 'Record decline' }));

    expect(await screen.findByText(/Request ID: return-conflict-7/i)).toBeInTheDocument();
    expect(resources.decideReturn).toHaveBeenCalledTimes(1);
  });

  it('reconciles an ambiguous decision through a fresh read and never replays the write', async () => {
    const user = userEvent.setup();
    resources.getReturns.mockResolvedValueOnce({ items: [requested] }).mockResolvedValue({ items: [approved] });
    resources.decideReturn.mockRejectedValueOnce(new ApiError(0, 'UNAVAILABLE', 'The backend could not confirm the decision.', undefined, true));
    renderCenter({ canDecideReturns: true });

    await user.click(await screen.findByRole('button', { name: 'Approve return JW-20261007-5396FAA7' }));
    await user.type(screen.getByRole('textbox', { name: /Decision note/ }), 'Inspection confirms the reported damage.');
    await user.click(screen.getByRole('button', { name: 'Record approval' }));

    expect(await screen.findByText(/backend no longer lists JW-20261007-5396FAA7 as requested/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Approve return?' })).not.toBeInTheDocument();
    expect(resources.decideReturn).toHaveBeenCalledTimes(1);
    expect(resources.getReturns).toHaveBeenCalledTimes(2);
  });
});

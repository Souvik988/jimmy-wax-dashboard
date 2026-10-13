import { afterEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/client')>()), apiGet: client.apiGet, apiPost: client.apiPost }));

import { getRefunds, processRefund, refundPageSchema } from '@/lib/api/resources/shipping';

afterEach(() => vi.resetAllMocks());

const id = '11111111-1111-4111-8111-111111111111';

describe('refund resource', () => {
  it('parses processability and the display-safe payment capability, and still accepts an older backend without them', async () => {
    const row = { id, orderId: id, amountPaise: 29900, status: 'requested', reason: 'Return approved', createdAt: '2026-10-07T01:00:00.000Z' };
    expect(refundPageSchema.parse({ items: [row] }).paymentCapability).toBeUndefined();
    client.apiGet.mockResolvedValue({ items: [{ ...row, processable: false, blockedReason: 'no_gateway' }], nextCursor: null, paymentCapability: { configured: false, provider: null, mode: null } });
    const page = await getRefunds();
    expect(page.items[0]?.blockedReason).toBe('no_gateway');
    expect(page.paymentCapability).toEqual({ configured: false, provider: null, mode: null });
    expect(refundPageSchema.safeParse({ items: [{ ...row, blockedReason: 'because' }] }).success).toBe(false);
  });

  it('posts to the process endpoint for a valid refund id and parses the documented result', async () => {
    client.apiPost.mockResolvedValue({ id, status: 'processed' });
    await expect(processRefund(id)).resolves.toEqual({ id, status: 'processed' });
    expect(client.apiPost).toHaveBeenCalledWith(`admin/refunds/${id}/process`, {});
    await expect(processRefund('../orders')).rejects.toThrow();
    client.apiPost.mockResolvedValue({ id, status: 'settled' });
    await expect(processRefund(id)).rejects.toThrow();
  });
});

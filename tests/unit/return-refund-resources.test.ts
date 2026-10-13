import { afterEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGet: client.apiGet, apiPost: client.apiPost };
});

import { checkShippingServiceability, decideReturn, getRefunds, getReturns, getShippingPickupLocations, getShippingPins, getShippingSettings } from '@/lib/api/resources/shipping';

afterEach(() => vi.clearAllMocks());

describe('return and refund resource calls', () => {
  it('requests the selected return status from the backend and parses its envelope', async () => {
    client.apiGet.mockResolvedValue({ items: [] });
    const abort = new AbortController();

    await expect(getReturns('requested', abort.signal)).resolves.toEqual({ items: [] });
    expect(client.apiGet).toHaveBeenCalledWith('admin/returns', { params: { status: 'requested' }, signal: abort.signal });
  });

  it('reads refunds without inventing a cursor or process capability', async () => {
    client.apiGet.mockResolvedValue({ items: [] });

    await expect(getRefunds()).resolves.toEqual({ items: [] });
    expect(client.apiGet).toHaveBeenCalledWith('admin/refunds', {});
  });

  it('sends only the backend-supported approve flag and note to the decision route', async () => {
    const returnId = '5396faa7-139e-4054-8c4e-ac6c73525118';
    client.apiPost.mockResolvedValue(null);

    await expect(decideReturn(returnId, { approve: false, note: 'Customer window has ended' })).resolves.toBeUndefined();
    expect(client.apiPost).toHaveBeenCalledWith(`admin/returns/${returnId}/decide`, { approve: false, note: 'Customer window has ended' });
  });

  it('refuses a malformed return identifier before building a backend path', async () => {
    await expect(decideReturn('not-a-uuid', { approve: true, note: 'Return verified' })).rejects.toThrow();
    expect(client.apiPost).not.toHaveBeenCalled();
  });
});

describe('shipping support resource calls', () => {
  it('reads shipping settings and allow-list prefixes through the same-origin API client', async () => {
    const settings = {
      pickupLocation: null, pickupPin: null, defaultWeightGrams: 300, defaultLengthMm: 200,
      defaultWidthMm: 150, defaultHeightMm: 100, courierRule: 'balanced', preferredCouriers: [],
      autoShip: false, bulkConfirmThreshold: 20, requireProviderCheck: true, stuckAfterHours: 48,
    };
    client.apiGet.mockResolvedValueOnce(settings).mockResolvedValueOnce({ items: [{ prefix: '743', note: null }] });
    const signal = new AbortController().signal;

    await expect(getShippingSettings(signal)).resolves.toEqual(settings);
    await expect(getShippingPins(signal)).resolves.toEqual({ items: [{ prefix: '743', note: null }] });
    expect(client.apiGet).toHaveBeenNthCalledWith(1, 'admin/shipping/settings', { signal });
    expect(client.apiGet).toHaveBeenNthCalledWith(2, 'admin/shipping/pins', { signal });
  });

  it('checks a delivery PIN with only the documented fields and parses the live manual result', async () => {
    const input = { pin: '743287', weightGrams: 600, cod: true, declaredValuePaise: 36400 };
    client.apiPost.mockResolvedValue({ pin: '743287', allowListed: true, allowListConfigured: true, provider: null });

    await expect(checkShippingServiceability(input)).resolves.toMatchObject({ allowListed: true, provider: null });
    expect(client.apiPost).toHaveBeenCalledWith('admin/shipping/serviceability/check', input);
  });

  it('loads provider pickup locations only through the explicit provider capability resource', async () => {
    client.apiGet.mockResolvedValue({ items: ['Main warehouse'] });

    await expect(getShippingPickupLocations()).resolves.toEqual({ items: ['Main warehouse'] });
    expect(client.apiGet).toHaveBeenCalledWith('admin/shipping/pickup-locations', {});
  });
});

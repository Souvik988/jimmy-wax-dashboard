// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PinListEditor, ShippingSettingsEditor } from '@/features/shipping/shipping-config-editors';
import { buildPinChange, buildSettingsPatch, isRiskySettingsChange, parsePinPrefixes, settingsDraftFrom } from '@/features/shipping/shipping-config-model';
import { ApiError } from '@/lib/api/errors';
import type { ShippingSettings } from '@/lib/api/resources/shipping';

const resources = vi.hoisted(() => ({ updateShippingSettings: vi.fn(), updateShippingPins: vi.fn() }));
vi.mock('@/lib/api/resources/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/resources/shipping')>();
  return { ...actual, updateShippingSettings: resources.updateShippingSettings, updateShippingPins: resources.updateShippingPins };
});

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const settings: ShippingSettings = {
  pickupLocation: 'Primary', pickupPin: '400001', defaultWeightGrams: 300, defaultLengthMm: 100, defaultWidthMm: 100, defaultHeightMm: 100,
  courierRule: 'balanced', preferredCouriers: [], autoShip: false, bulkConfirmThreshold: 20, requireProviderCheck: true, stuckAfterHours: 72,
  updatedAt: '2026-10-09T10:00:00.000Z',
};
const etag = 'a'.repeat(64);

describe('shipping settings patch', () => {
  it('sends only changed fields with a before/after review', () => {
    const draft = { ...settingsDraftFrom(settings), defaultWeightGrams: '450', courierRule: 'fastest' as const };
    const result = buildSettingsPatch(settings, draft);
    expect(result.ok && result.patch).toEqual({ defaultWeightGrams: 450, courierRule: 'fastest' });
    expect(result.ok && result.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`)).toEqual(['Default weight (g): 300 → 450', 'Courier selection: balanced → fastest']);
  });

  it('rejects out-of-range, fractional and non-numeric values per field', () => {
    const result = buildSettingsPatch(settings, { ...settingsDraftFrom(settings), stuckAfterHours: '2', bulkConfirmThreshold: '1.5', defaultLengthMm: 'abc', pickupPin: '12' });
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(['bulkConfirmThreshold', 'defaultLengthMm', 'pickupPin', 'stuckAfterHours']);
  });

  it('requires a pickup location for auto-dispatch and couriers for the preferred rule', () => {
    const noPickup = { ...settings, pickupLocation: null };
    expect(buildSettingsPatch(noPickup, { ...settingsDraftFrom(noPickup), autoShip: true }).ok).toBe(false);
    const preferred = buildSettingsPatch(settings, { ...settingsDraftFrom(settings), courierRule: 'preferred' });
    expect(!preferred.ok && preferred.errors.preferredCouriers).toBeTruthy();
    const withCouriers = buildSettingsPatch(settings, { ...settingsDraftFrom(settings), courierRule: 'preferred', preferredCouriers: 'Blue Dart, Delhivery, Blue Dart' });
    expect(withCouriers.ok && withCouriers.patch.preferredCouriers).toEqual(['Blue Dart', 'Delhivery']);
  });

  it('clears the pickup PIN with null and flags risky changes', () => {
    const cleared = buildSettingsPatch(settings, { ...settingsDraftFrom(settings), pickupPin: '' });
    expect(cleared.ok && cleared.patch).toEqual({ pickupPin: null });
    const risky = buildSettingsPatch(settings, { ...settingsDraftFrom(settings), autoShip: true, requireProviderCheck: false });
    expect(risky.ok && isRiskySettingsChange(risky.changes)).toBe(true);
    const safe = buildSettingsPatch(settings, { ...settingsDraftFrom(settings), stuckAfterHours: '96' });
    expect(safe.ok && isRiskySettingsChange(safe.changes)).toBe(false);
  });
});

describe('PIN prefix change', () => {
  it('parses unique valid prefixes and reports invalid ones instead of dropping them', () => {
    expect(parsePinPrefixes('400, 4001 400;560001\n12')).toEqual({ prefixes: ['400', '4001', '560001'], invalid: ['12'] });
    expect(buildPinChange([], '400 abc', new Set()).ok).toBe(false);
  });

  it('skips prefixes already listed, honours removals and refuses empty or contradictory changes', () => {
    expect(buildPinChange(['400', '560'], '400 110', new Set(['560']))).toEqual({ ok: true, add: ['110'], remove: ['560'] });
    expect(buildPinChange(['400'], '400', new Set()).ok).toBe(false);
    expect(buildPinChange(['400'], '400', new Set(['400'])).ok).toBe(false);
  });
});

function renderWith(node: React.ReactNode): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe('shipping settings editor', () => {
  it('reviews the diff, needs a reason, and sends the loaded version stamp', async () => {
    const user = userEvent.setup();
    resources.updateShippingSettings.mockResolvedValue({ ...settings, defaultWeightGrams: 450 });
    renderWith(<ShippingSettingsEditor settings={settings} />);
    await user.click(screen.getByRole('button', { name: 'Edit shipping settings' }));
    const weight = screen.getByLabelText('Default weight (g)');
    await user.clear(weight);
    await user.type(weight, '450');
    await user.click(screen.getByRole('button', { name: 'Review changes' }));

    expect(await screen.findByText(/300 → 450/)).toBeInTheDocument();
    const apply = screen.getByRole('button', { name: 'Apply change' });
    expect(apply).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), 'Boxes re-measured');
    await user.click(apply);

    expect(resources.updateShippingSettings).toHaveBeenCalledWith({ defaultWeightGrams: 450 }, { expectedUpdatedAt: '2026-10-09T10:00:00.000Z', reason: 'Boxes re-measured' });
    expect(await screen.findByText(/saved and recorded in the audit log/i)).toBeInTheDocument();
  });

  it('shows a conflict without retrying and leaves nothing half-applied', async () => {
    const user = userEvent.setup();
    resources.updateShippingSettings.mockRejectedValue(new ApiError(409, 'CART_VERSION_CONFLICT', 'changed', 'req-1'));
    renderWith(<ShippingSettingsEditor settings={settings} />);
    await user.click(screen.getByRole('button', { name: 'Edit shipping settings' }));
    await user.click(screen.getByLabelText('Automatic provider dispatch'));
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(await screen.findByText(/without a person reviewing/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Reason/), 'Enable dispatch');
    await user.click(screen.getByRole('button', { name: 'Apply change' }));

    expect(await screen.findByText(/changed since you loaded it/i)).toBeInTheDocument();
    expect(resources.updateShippingSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Edit shipping settings' })).toBeInTheDocument();
  });

  it('offers no edit control when the backend gave no version stamp', () => {
    renderWith(<ShippingSettingsEditor settings={{ ...settings, updatedAt: null }} />);
    expect(screen.getByRole('button', { name: 'Edit shipping settings' })).toBeDisabled();
  });
});

describe('delivery area editor', () => {
  it('sends add/remove with the loaded etag and a reason', async () => {
    const user = userEvent.setup();
    resources.updateShippingPins.mockResolvedValue(undefined);
    renderWith(<PinListEditor list={{ items: [{ prefix: '400', note: 'Mumbai' }, { prefix: '560', note: null }], etag }} />);
    await user.click(screen.getByRole('button', { name: 'Edit delivery areas' }));
    await user.type(screen.getByLabelText('Add PIN prefixes'), '110 400');
    await user.click(screen.getByLabelText('Remove 560'));
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await user.type(await screen.findByLabelText(/Reason/), 'Expanding to Delhi');
    await user.click(screen.getByRole('button', { name: 'Apply change' }));

    expect(resources.updateShippingPins).toHaveBeenCalledWith({ add: ['110'], remove: ['560'], expectedEtag: etag, reason: 'Expanding to Delhi' });
    expect(await screen.findByText(/Delivery areas updated/i)).toBeInTheDocument();
  });

  it('blocks invalid prefixes before any request', async () => {
    const user = userEvent.setup();
    renderWith(<PinListEditor list={{ items: [], etag }} />);
    await user.click(screen.getByRole('button', { name: 'Edit delivery areas' }));
    await user.type(screen.getByLabelText('Add PIN prefixes'), '12 abcd');
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Not valid PIN prefixes/);
    expect(resources.updateShippingPins).not.toHaveBeenCalled();
  });
});

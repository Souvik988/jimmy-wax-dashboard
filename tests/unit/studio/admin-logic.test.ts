import { describe, expect, it } from 'vitest';

import { overlappingCampaigns } from '@/features/studio/campaigns-panel';
import { couponPayload } from '@/features/marketing/marketing';
import { settingsDiff, toDraft } from '@/features/platform/platform';
import { duplicateBlock, moveBlock, newBlock, paletteFor, parsePastedBlock, refinementErrors } from '@/features/studio/doc-model';

const base = { code: 'DIWALI10', description: '', kind: 'percentage' as const, value: '10', minOrder: '499', maxDiscount: '', startsAt: '', endsAt: '', totalLimit: '', perCustomer: '1', firstOrderOnly: false, products: '', active: true };

describe('coupon payload', () => {
  it('converts percent and rupees to bps and paise', () => {
    const result = couponPayload(base, false);
    expect('input' in result && result.input.valueBps).toBe(1000);
    expect('input' in result && result.input.minOrderPaise).toBe(49900);
  });
  it('rejects bad codes, ranges and windows', () => {
    const result = couponPayload({ ...base, code: 'x', value: '120', startsAt: '2026-10-10T10:00', endsAt: '2026-10-09T10:00' }, false);
    expect('errors' in result && Object.keys(result.errors).sort()).toEqual(['code', 'endsAt', 'value']);
  });
  it('flat coupons need a rupee amount', () => {
    expect('errors' in couponPayload({ ...base, kind: 'flat', value: '' }, false)).toBe(true);
    const ok = couponPayload({ ...base, kind: 'flat', value: '50' }, false);
    expect('input' in ok && ok.input.valuePaise).toBe(5000);
  });
});

describe('settings diff', () => {
  const s = { shippingFeePaise: 4000, freeShippingThresholdPaise: 200000, codEnabled: true, codMaxOrderPaise: 500000, onlinePaymentsEnabled: true, paymentWindowMinutes: 30, checkoutEnabled: false, checkoutPolicyConfirmed: true, codFeePaise: 2500, gstRateBps: 1800, taxInclusive: true, returnWindowDays: null, merchantLegalName: null, merchantGstin: null, merchantState: null, merchantAddress: null, brandName: 'JIMMY WAX', supportEmail: null, supportPhone: null, ordersPaused: false, pauseMessage: '', version: 16 };
  it('sends nothing when unchanged and only changed fields otherwise', () => {
    expect(settingsDiff(s, toDraft(s)).changes).toHaveLength(0);
    const d = { ...toDraft(s), shippingFee: '49', gstin: '27AAPFU0939F1ZV' };
    const diff = settingsDiff(s, d);
    expect(diff.patch).toEqual({ shippingFeePaise: 4900, merchantGstin: '27AAPFU0939F1ZV' });
    expect(diff.errors).toEqual({});
  });
  it('validates GSTIN, email and money', () => {
    const diff = settingsDiff(s, { ...toDraft(s), gstin: 'bad', supportEmail: 'nope', shippingFee: 'abc' });
    expect(Object.keys(diff.errors).sort()).toEqual(['gstin', 'shippingFee', 'supportEmail']);
  });
});

describe('campaign overlap + block model', () => {
  it('detects overlapping active campaigns only', () => {
    const c = (id: string, a: string, b: string, status = 'active') => ({ id, name: id, startsAt: a, endsAt: b, status });
    expect(overlappingCampaigns([c('a', '2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z'), c('b', '2026-10-09T00:00:00Z', '2026-10-20T00:00:00Z')])).toEqual([['a', 'b']]);
    expect(overlappingCampaigns([c('a', '2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z'), c('b', '2026-10-09T00:00:00Z', '2026-10-20T00:00:00Z', 'draft')])).toEqual([]);
  });
  it('duplicates with a new id, moves, enforces per-type limits and paste rules', () => {
    const hero = newBlock('app.hero_carousel');
    const two = duplicateBlock([hero], 0);
    expect(two[1]!.id).not.toBe(hero.id);
    expect(moveBlock(two, 0, 1)[1]!.id).toBe(hero.id);
    expect(paletteFor('app', two).find((e) => e.type === 'app.hero_carousel')?.disabledReason).toMatch(/Only 2/);
    expect('error' in parsePastedBlock('{"type":"app.nope"}')).toBe(true);
    const pasted = parsePastedBlock(JSON.stringify(hero));
    expect('block' in pasted && pasted.block.id).not.toBe(hero.id);
  });
  it('enforces the ritual_steps refinement and starts valid', () => {
    const ritual = newBlock('web.ritual_steps');
    expect(refinementErrors('web.ritual_steps', ritual.props)).toEqual({});
    expect(Object.keys(refinementErrors('web.ritual_steps', { headline: 'x', guideId: 'a-b', steps: [] }))).toHaveLength(1);
  });
});

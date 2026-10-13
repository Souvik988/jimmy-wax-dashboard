import { describe, expect, it } from 'vitest';

import { checkContrast, checkTypeScale, contrastRatio } from '@/features/studio/contrast';

describe('contrast guard-rails', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#ffffff')).toBeGreaterThan(4.4);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.6);
    expect(contrastRatio('not-a-colour', '#ffffff')).toBeNull();
  });
  it('flags a failing role pair and reports unknown roles as unchecked', () => {
    const results = checkContrast({ 'bg.base': '#120C08', 'text.primary': '#FFF9F1', 'text.secondary': '#2a2a2a' });
    expect(results.find((r) => r.rule.id === 'text.primary/bg.base')?.pass).toBe(true);
    expect(results.find((r) => r.rule.id === 'text.secondary/bg.base')?.pass).toBe(false);
    expect(results.find((r) => r.rule.id === 'text.primary/bg.raised')?.ratio).toBeNull();
  });
  it('enforces minimum type sizes per channel', () => {
    expect(checkTypeScale('web', { body: { size: 14 } })).toHaveLength(1);
    expect(checkTypeScale('app', { body: { size: 14 } })).toHaveLength(0);
    expect(checkTypeScale('app', { label: { size: 9 } })).toHaveLength(1);
  });
});

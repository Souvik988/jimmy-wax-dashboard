import { describe, expect, it } from 'vitest';

import { formatMoney, parseRupeesToPaise } from '@/lib/format/money';
import { formatIst, formatRelativeIst } from '@/lib/format/time';

describe('money formatting', () => {
  it('formats integer paise in Indian grouping without floating point drift', () => {
    expect(formatMoney(245000)).toBe('₹2,450');
    expect(formatMoney(123456789, { showPaise: true })).toBe('₹12,34,567.89');
  });

  it('parses valid rupee entries into paise and rejects unsafe precision', () => {
    expect(parseRupeesToPaise('2,450.50')).toBe(245050);
    expect(parseRupeesToPaise('-25.25')).toBe(-2525);
    expect(parseRupeesToPaise('12.999')).toBeNull();
  });
});

describe('IST time formatting', () => {
  it('renders API instants using the explicit Asia/Kolkata time zone', () => {
    expect(formatIst('2026-10-06T00:00:00.000Z', { dateStyle: 'medium', timeStyle: 'short' })).toBe('6 Oct 2026, 5:30 am');
  });

  it('uses a supplied reference time for deterministic relative labels', () => {
    expect(formatRelativeIst('2026-10-06T00:00:00.000Z', new Date('2026-10-06T00:02:00.000Z'))).toBe('2 minutes ago');
  });
});

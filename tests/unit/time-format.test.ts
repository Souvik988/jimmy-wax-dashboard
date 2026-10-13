import { describe, expect, it } from 'vitest';

import { formatIst } from '@/lib/format/time';

describe('formatIst', () => {
  it('uses a concise date and time by default', () => {
    expect(formatIst('2026-10-06T12:00:00.000Z')).toMatch(/6 Oct 2026/u);
    expect(formatIst('2026-10-06T12:00:00.000Z')).toMatch(/5:30 pm/u);
  });

  it('accepts component fields without mixing them with dateStyle/timeStyle', () => {
    expect(() => formatIst('2026-10-06T12:00:00.000Z', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
    })).not.toThrow();
    expect(formatIst('2026-10-06T12:00:00.000Z', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
    })).toMatch(/5:30:00 pm/u);
  });

  it('keeps the timezone pinned to IST even if a caller passes another zone', () => {
    expect(formatIst('2026-10-06T12:00:00.000Z', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })).toMatch(/5:30 pm/u);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(resolve(process.cwd(), 'src/features/orders/order-detail.module.css'), 'utf8');

describe('order action styles', () => {
  it('provides layout and non-colour-only error treatment for live order actions', () => {
    expect(stylesheet).toMatch(/\.actions\s*\{/u);
    expect(stylesheet).toMatch(/\.actionError\s*\{/u);
    expect(stylesheet).toMatch(/border/u);
  });
});

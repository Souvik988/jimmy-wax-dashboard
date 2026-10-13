import { createHmac } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * Live proof of the guarded writes against the LOCAL dev stack: shipping settings, delivery areas, product archive/restore.
 * Every change is reverted. Needs disposable admin credentials; skipped otherwise.
 */
const enabled = process.env.DASHBOARD_RUN_GUARDED_WRITES === '1';
const email = process.env.DASHBOARD_TEST_ADMIN_EMAIL ?? '';
const password = process.env.DASHBOARD_TEST_ADMIN_PASSWORD ?? '';
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const probePrefix = '999';

function currentTotp(secret: string): string {
  let accumulator = 0;
  let bitCount = 0;
  const decoded: number[] = [];
  for (const character of secret.toUpperCase().replace(/=+$/u, '').replace(/\s/gu, '')) {
    accumulator = (accumulator << 5) | base32Alphabet.indexOf(character);
    bitCount += 5;
    if (bitCount >= 8) { bitCount -= 8; decoded.push((accumulator >> bitCount) & 0xff); accumulator &= (1 << bitCount) - 1; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(decoded)).update(counter).digest();
  const offset = (digest[19] ?? 0) & 0x0f;
  const binary = (((digest[offset] ?? 0) & 0x7f) << 24) | (((digest[offset + 1] ?? 0) & 0xff) << 16) | (((digest[offset + 2] ?? 0) & 0xff) << 8) | ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login?next=%2Fshipping');
  await page.getByRole('textbox', { name: 'Work email' }).fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await page.waitForURL((url) => ['/shipping', '/login/enroll'].includes(url.pathname));
  // These writes need a fresh MFA step-up, so a new operator must enrol an authenticator first.
  if (!page.url().includes('/login/enroll')) await page.goto('/login/enroll');
  const begin = page.getByRole('button', { name: 'Begin secure setup' });
  if (await begin.isVisible({ timeout: 5000 }).catch(() => false)) {
    await begin.click();
    await page.getByRole('button', { name: 'Reveal key' }).click();
    const secret = await page.locator('.mfa-secret code').textContent();
    await page.getByRole('textbox', { name: 'Authenticator code' }).fill(currentTotp(secret ?? ''));
    await page.getByRole('button', { name: 'Verify and finish setup' }).click();
    await expect(page.locator('.recovery-code-list li').first()).toBeVisible();
    await page.getByLabel('I stored these codes somewhere private.').check();
    await page.getByRole('button', { name: 'I saved them — continue' }).click();
  }
  await page.goto('/shipping');
  await expect(page.getByRole('heading', { name: 'Delivery tools' })).toBeVisible();
}

type Settings = { stuckAfterHours: number; updatedAt: string };
const getSettings = async (page: Page): Promise<Settings> => (await page.request.get('/api/backend/admin/shipping/settings')).json() as Promise<Settings>;
const getPins = async (page: Page): Promise<{ items: { prefix: string }[]; etag: string }> => (await page.request.get('/api/backend/admin/shipping/pins')).json() as Promise<{ items: { prefix: string }[]; etag: string }>;

/** A raw write through the BFF, with the same-origin and CSRF headers the dashboard client sends. */
async function rawWrite(page: Page, method: 'PUT' | 'POST', path: string, data: unknown) {
  const cookies = await page.context().cookies();
  const token = cookies.find((cookie) => cookie.name === 'jw_csrf')?.value ?? '';
  const origin = new URL(page.url()).origin;
  return page.request.fetch(path, { method, data, headers: { origin, 'x-csrf-token': token } });
}

async function confirmWithReason(page: Page, reason: string): Promise<void> {
  await page.getByRole('dialog').getByLabel(/Reason/).fill(reason);
  await page.getByRole('button', { name: 'Apply change' }).click();
}

test.describe('guarded writes (local stack)', () => {
  test.skip(!enabled || !email || !password, 'Needs DASHBOARD_RUN_GUARDED_WRITES=1 and disposable local admin credentials.');
  test.setTimeout(120_000);
  test.describe.configure({ mode: 'serial' });

  // One sign-in for the whole file: the authenticator secret exists only in this enrolment, so later contexts could not pass the MFA prompt.
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    page = await (await browser.newContext()).newPage();
    await signIn(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('shipping settings: reviewed edit, audit reason, and revert', async () => {
    await page.goto('/shipping');
    const before = await getSettings(page);
    const changed = before.stuckAfterHours === 96 ? 72 : 96;

    await page.getByRole('button', { name: 'Edit shipping settings' }).click();
    await page.getByLabel('Stuck shipment threshold (hours)').fill(String(changed));
    await page.getByRole('button', { name: 'Review changes' }).click();
    await expect(page.getByText(`${before.stuckAfterHours} → ${changed}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply change' })).toBeDisabled();
    await confirmWithReason(page, 'Live acceptance: temporary threshold change');
    await expect(page.getByText(/saved and recorded in the audit log/i)).toBeVisible();
    expect((await getSettings(page)).stuckAfterHours).toBe(changed);

    // A request with an old stamp must be refused and change nothing.
    const stale = await rawWrite(page, 'PUT', '/api/backend/admin/shipping/settings', { stuckAfterHours: before.stuckAfterHours, expectedUpdatedAt: before.updatedAt, reason: 'Live acceptance: stale stamp' });
    expect(stale.status()).toBe(409);
    expect((await getSettings(page)).stuckAfterHours).toBe(changed);

    // Revert through the UI.
    await page.reload();
    await page.getByRole('button', { name: 'Edit shipping settings' }).click();
    await page.getByLabel('Stuck shipment threshold (hours)').fill(String(before.stuckAfterHours));
    await page.getByRole('button', { name: 'Review changes' }).click();
    await confirmWithReason(page, 'Live acceptance: restore threshold');
    await expect(page.getByText(/saved and recorded in the audit log/i)).toBeVisible();
    expect((await getSettings(page)).stuckAfterHours).toBe(before.stuckAfterHours);
  });

  test('delivery areas: add, stale refusal, remove', async () => {
    await page.goto('/shipping');
    const start = await getPins(page);
    expect(start.items.map((item) => item.prefix)).not.toContain(probePrefix);

    await page.getByRole('button', { name: 'Edit delivery areas' }).click();
    await page.getByLabel('Add PIN prefixes').fill(probePrefix);
    await page.getByRole('button', { name: 'Review changes' }).click();
    await confirmWithReason(page, 'Live acceptance: add probe prefix');
    await expect(page.getByText(/Delivery areas updated/i)).toBeVisible();
    expect((await getPins(page)).items.map((item) => item.prefix)).toContain(probePrefix);

    const stale = await rawWrite(page, 'PUT', '/api/backend/admin/shipping/pins', { add: ['998'], remove: [], expectedEtag: start.etag, reason: 'Live acceptance: stale etag' });
    expect(stale.status()).toBe(409);
    expect((await getPins(page)).items.map((item) => item.prefix)).not.toContain('998');

    await page.reload();
    await page.getByRole('button', { name: 'Edit delivery areas' }).click();
    await page.getByLabel(`Remove ${probePrefix}`).check();
    await page.getByRole('button', { name: 'Review changes' }).click();
    await confirmWithReason(page, 'Live acceptance: remove probe prefix');
    await expect(page.getByText(/Delivery areas updated/i)).toBeVisible();
    expect((await getPins(page)).items.map((item) => item.prefix)).not.toContain(probePrefix);
  });

  test('product: archive with reason, stale refusal, restore (on a disposable inactive copy)', async () => {
    // A product can only be duplicated once (the backend derives the copy's SKU from the source), so reuse an existing inactive *-copy.
    const list = await (await page.request.get('/api/backend/admin/products?q=copy&status=inactive&limit=50')).json() as { items: { id: string; active: boolean; archived?: boolean }[] };
    const target = list.items.find((item) => item.id.endsWith('-copy') && !item.active && !item.archived);
    expect(target, 'needs a disposable inactive *-copy product').toBeTruthy();
    const copyId = target!.id;
    await page.goto(`/products/${copyId}`);

    const copy = async (): Promise<{ version: number; archived: boolean; active: boolean }> => (await page.request.get(`/api/backend/admin/products/${copyId}`)).json() as Promise<{ version: number; archived: boolean; active: boolean }>;
    const original = await copy();
    expect(original.archived).toBe(false);

    await page.getByRole('button', { name: 'Archive product' }).click();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await page.getByRole('dialog').getByLabel(/Reason/).fill('Live acceptance: archive test copy');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/Product archived/i)).toBeVisible();
    const archived = await copy();
    expect(archived.archived).toBe(true);
    expect(archived.active).toBe(false);

    const stale = await rawWrite(page, 'POST', `/api/backend/admin/products/${copyId}/restore`, { expectedVersion: original.version, reason: 'Live acceptance: stale version' });
    expect(stale.status()).toBe(409);
    expect((await copy()).archived).toBe(true);

    await page.reload();
    await page.getByRole('button', { name: 'Restore product' }).click();
    await page.getByRole('dialog').getByLabel(/Reason/).fill('Live acceptance: restore test copy');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/Product restored/i)).toBeVisible();
    const restored = await copy();
    expect(restored.archived).toBe(false);
    expect(restored.active).toBe(false);
  });
});

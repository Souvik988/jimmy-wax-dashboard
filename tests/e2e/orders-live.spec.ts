import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const email = process.env.DASHBOARD_TEST_ORDERS_EMAIL;
const password = process.env.DASHBOARD_TEST_ORDERS_PASSWORD;
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function currentTotp(secret: string): string {
  let accumulator = 0;
  let bitCount = 0;
  const decoded: number[] = [];
  for (const character of secret.toUpperCase().replace(/=+$/u, '').replace(/\s/gu, '')) {
    const index = base32Alphabet.indexOf(character);
    if (index < 0) throw new Error('The local MFA setup response was invalid.');
    accumulator = (accumulator << 5) | index;
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

async function completeEnrollment(page: import('@playwright/test').Page): Promise<string | null> {
  if (!page.url().includes('/login/enroll')) return null;
  await page.getByRole('button', { name: 'Begin secure setup' }).click();
  await page.getByRole('button', { name: 'Reveal key' }).click();
  const secret = await page.locator('.mfa-secret code').textContent();
  if (!secret) throw new Error('The local MFA setup key was unavailable.');
  await page.getByRole('textbox', { name: 'Authenticator code' }).fill(currentTotp(secret));
  await page.getByRole('button', { name: 'Verify and finish setup' }).click();
  await expect(page.locator('.recovery-code-list li').first()).toBeVisible();
  await page.getByLabel('I stored these codes somewhere private.').check();
  await page.getByRole('button', { name: 'I saved them — continue' }).click();
  return secret;
}

test('live Orders reference uses real cursor data, URL filters, MFA CSV and responsive accessible table', async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(!email || !password, 'Supply a temporary DASHBOARD_TEST_ORDERS_EMAIL/PASSWORD for a real local-backend run.');

  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Work email' }).fill(email!);
  await page.getByLabel('Password').fill(password!);
  const loginResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  expect((await loginResponse).status()).toBe(200);
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/login/enroll');
  let totpSecret = await completeEnrollment(page);
  if (!totpSecret) {
    const sessionResponse = await page.request.get('/api/auth/session');
    const session = await sessionResponse.json() as { user?: { mfa?: boolean } | null };
    if (!session.user?.mfa) {
      await page.goto('/login/enroll?next=%2F');
      totpSecret = await completeEnrollment(page);
    }
  }
  await page.waitForURL((url) => url.pathname === '/');

  const listResponse = page.waitForResponse((response) => response.url().includes('/api/backend/admin/orders') && response.request().method() === 'GET');
  await page.goto('/orders');
  expect((await listResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
  await expect(page.getByText('LIVE BACKEND · OPERATOR QUEUE')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Export orders' })).toBeVisible();
  await expect(page.getByLabel('Loading orders')).toHaveCount(0);

  const rows = page.locator('.ui-table tbody tr');
  if (await rows.count()) {
    const orderNumber = (await rows.first().locator('td').first().innerText()).split('\n')[0]?.trim();
    expect(orderNumber).toMatch(/^JW-/u);
    await page.getByRole('textbox', { name: 'Search order number' }).fill(orderNumber ?? '');
    await expect(page).toHaveURL(/q=JW-/u);
    await expect(rows).toHaveCount(1);
    const statusSelect = page.getByLabel('Filter orders by status');
    const availableStatuses = await statusSelect.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    console.info('Visible order status filters:', availableStatuses.join(','));
    await statusSelect.selectOption('placed');
    await expect(page).toHaveURL(/status=placed/u);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/status=|q=/u);
  } else {
    await expect(page.getByRole('heading', { name: 'No orders yet' })).toBeVisible();
  }

  const startDate = page.getByLabel('Start date · included');
  const endDate = page.getByLabel('End date · excluded');
  await startDate.fill('2026-10-01');
  await endDate.fill('2026-10-02');
  console.info('Export form dates:', await startDate.inputValue(), await endDate.inputValue());
  let exportRequestCount = 0;
  const exportStatuses: number[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/backend/admin/exports/orders.csv') && request.method() === 'GET') exportRequestCount += 1; });
  page.on('response', (response) => { if (response.url().includes('/api/backend/admin/exports/orders.csv')) exportStatuses.push(response.status()); });
  const firstExportResponsePromise = page.waitForResponse((response) => response.url().includes('/api/backend/admin/exports/orders.csv') && response.request().method() === 'GET', { timeout: 30_000 });
  const downloadEvent = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const firstExportResponse = await firstExportResponsePromise;
  let response = firstExportResponse;
  const steppedUp = firstExportResponse.status() === 403;
  if (steppedUp) {
    const stepUpDialog = page.getByRole('dialog', { name: 'Verify this action' });
    await expect(stepUpDialog).toBeVisible();
    if (!totpSecret) throw new Error('The fresh local operator had no authenticator secret for step-up.');
    const retryResponse = page.waitForResponse((candidate) => candidate.url().includes('/api/backend/admin/exports/orders.csv') && candidate.request().method() === 'GET' && candidate.status() === 200, { timeout: 30_000 });
    await stepUpDialog.getByRole('textbox', { name: 'Authenticator code' }).fill(currentTotp(totpSecret));
    await stepUpDialog.getByRole('button', { name: 'Verify' }).click();
    await expect(stepUpDialog).toBeHidden();
    response = await retryResponse;
  }
  console.info('Export step-up trace:', exportStatuses.join(' → '), 'requests:', exportRequestCount);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/csv');
  const download = await downloadEvent;
  expect(exportStatuses).toEqual(steppedUp ? [403, 200] : [200]);
  expect(exportRequestCount).toBe(steppedUp ? 2 : 1);
  expect(download.suggestedFilename()).toContain('orders-2026-10-01-2026-10-02.csv');

  const evidenceDirectory = resolve(process.cwd(), 'docs/build/evidence/phase-04');
  mkdirSync(evidenceDirectory, { recursive: true });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: resolve(evidenceDirectory, `orders-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(accessibility.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
});

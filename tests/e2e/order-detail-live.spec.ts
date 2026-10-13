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
    if (index < 0) throw new Error('The local MFA setup key was invalid.');
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

async function signInAsFreshFulfilmentOperator(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Work email' }).fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/login/enroll');
  let secret: string;
  if (page.url().includes('/login/enroll')) {
    await page.getByRole('button', { name: 'Begin secure setup' }).click();
    await page.getByRole('button', { name: 'Reveal key' }).click();
    const setupSecret = await page.locator('.mfa-secret code').textContent();
    if (!setupSecret) throw new Error('The local MFA setup key was unavailable.');
    secret = setupSecret;
    await page.getByRole('textbox', { name: 'Authenticator code' }).fill(currentTotp(setupSecret));
    await page.getByRole('button', { name: 'Verify and finish setup' }).click();
    await expect(page.locator('.recovery-code-list li').first()).toBeVisible();
    await page.getByLabel('I stored these codes somewhere private.').check();
    await page.getByRole('button', { name: 'I saved them — continue' }).click();
  } else {
    const sessionResponse = await page.request.get('/api/auth/session');
    const session = await sessionResponse.json() as { user?: { mfa?: boolean } | null };
    if (session.user?.mfa) throw new Error('The temporary local operator already had an MFA enrollment; use a fresh account.');
    await page.goto('/login/enroll?next=%2F');
    await page.getByRole('button', { name: 'Begin secure setup' }).click();
    await page.getByRole('button', { name: 'Reveal key' }).click();
    const setupSecret = await page.locator('.mfa-secret code').textContent();
    if (!setupSecret) throw new Error('The local MFA setup key was unavailable.');
    secret = setupSecret;
    await page.getByRole('textbox', { name: 'Authenticator code' }).fill(currentTotp(setupSecret));
    await page.getByRole('button', { name: 'Verify and finish setup' }).click();
    await expect(page.locator('.recovery-code-list li').first()).toBeVisible();
    await page.getByLabel('I stored these codes somewhere private.').check();
    await page.getByRole('button', { name: 'I saved them — continue' }).click();
  }
  await page.waitForURL((url) => url.pathname === '/');
  return secret;
}

test('live order record and packing slip use verified backend data and a clean print layout', async ({ page }) => {
  test.skip(!email || !password, 'Supply a temporary DASHBOARD_TEST_ORDERS_EMAIL/PASSWORD for a real local-backend run.');
  test.setTimeout(90_000);

  const totpSecret = await signInAsFreshFulfilmentOperator(page);
  const listResponse = page.waitForResponse((response) => response.url().includes('/api/backend/admin/orders') && response.request().method() === 'GET');
  await page.goto('/orders?status=processing');
  expect((await listResponse).status()).toBe(200);
  const firstOrder = page.locator('.ui-table tbody tr').first().getByRole('link');
  await expect(firstOrder).toBeVisible();
  const detailResponse = page.waitForResponse((response) => /\/api\/backend\/admin\/orders\/[0-9a-f-]+$/u.test(new URL(response.url()).pathname) && response.request().method() === 'GET');
  await firstOrder.click();
  expect((await detailResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: /^JW-/u })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Order actions' })).toBeVisible();
  await expect(page.getByText('The backend does not provide a per-line GST or coupon allocation for this admin record.')).toBeVisible();

  const evidenceDirectory = resolve(process.cwd(), 'docs/build/evidence/phase-06');
  mkdirSync(evidenceDirectory, { recursive: true });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: resolve(evidenceDirectory, `order-detail-${width}.png`), fullPage: true });
    if (width === 375) {
      const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
      expect(accessibility.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  const orderId = new URL(page.url()).pathname.split('/').at(-1);
  const invoicePath = `/api/backend/admin/orders/${orderId}/invoice`;
  const viewResponse = page.waitForResponse((response) => response.url().includes(invoicePath) && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'View GST invoice' }).click();
  // Viewing is read-only: it never issues anything. A 404 means "not issued yet".
  expect([200, 404]).toContain((await viewResponse).status());
  const issueButton = page.getByRole('button', { name: 'Issue GST invoice' });
  await expect(issueButton).toBeVisible();
  await issueButton.click();
  const invoiceDialog = page.getByRole('dialog', { name: 'Issue this GST invoice' });
  await expect(invoiceDialog).toBeVisible();
  await expect(invoiceDialog.getByText(/immutable financial record once/u)).toBeVisible();
  const sessionResponse = await page.request.get('/api/auth/session');
  const session = await sessionResponse.json() as { user?: { aal?: string } | null };
  const needsStepUp = session.user?.aal !== 'aal2';
  const issueResponse = page.waitForResponse((response) => response.url().includes(invoicePath) && response.request().method() === 'POST');
  await invoiceDialog.getByLabel('Reason').fill('Live acceptance check of invoice issuing');
  await invoiceDialog.getByRole('button', { name: 'Continue', exact: true }).click();
  let invoiceResult = await issueResponse;
  if (needsStepUp) {
    expect(invoiceResult.status()).toBe(403);
    const initialInvoiceError = await invoiceResult.json() as { error?: { code?: string } };
    expect(initialInvoiceError.error?.code).toBe('MFA_REQUIRED');
    const stepUpDialog = page.getByRole('dialog', { name: 'Verify this action' });
    await expect(stepUpDialog).toBeVisible();
    const invoiceRetry = page.waitForResponse((response) => response.url().includes(invoicePath) && response.request().method() === 'POST' && response.status() === 503);
    await stepUpDialog.getByRole('textbox', { name: 'Authenticator code' }).fill(currentTotp(totpSecret));
    await stepUpDialog.getByRole('button', { name: 'Verify' }).click();
    invoiceResult = await invoiceRetry;
    await expect(stepUpDialog).toBeHidden();
  }
  // The local store has no seller GST profile, so issuing is refused without consuming an invoice number.
  expect(invoiceResult.status()).toBe(503);
  await expect(page.getByRole('alert').filter({ hasText: 'The seller GST details are not configured yet' })).toBeVisible();
  await expect(invoiceDialog).toBeHidden();

  await page.getByRole('link', { name: 'Packing slip' }).click();
  await expect(page.getByRole('heading', { name: /^JW-/u })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print slip' })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.shell-sidebar')).toBeHidden();
  await expect(page.locator('.shell-topbar')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print slip' })).toBeHidden();
  await page.locator('.packing-slip-document').screenshot({ path: resolve(evidenceDirectory, 'packing-slip-print.png') });
});

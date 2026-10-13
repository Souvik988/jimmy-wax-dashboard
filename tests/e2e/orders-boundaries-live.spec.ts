import { createHmac } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

const fulfilmentEmail = process.env.DASHBOARD_TEST_ORDERS_EMAIL;
const fulfilmentPassword = process.env.DASHBOARD_TEST_ORDERS_PASSWORD;
const supportEmail = process.env.DASHBOARD_TEST_SUPPORT_EMAIL;
const supportPassword = process.env.DASHBOARD_TEST_SUPPORT_PASSWORD;
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

async function finishEnrollment(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Begin secure setup' }).click();
  await page.getByRole('button', { name: 'Reveal key' }).click();
  const secret = await page.locator('.mfa-secret code').textContent();
  if (!secret) throw new Error('The local MFA setup key was unavailable.');
  await page.getByRole('textbox', { name: 'Authenticator code' }).fill(currentTotp(secret));
  await page.getByRole('button', { name: 'Verify and finish setup' }).click();
  await expect(page.locator('.recovery-code-list li').first()).toBeVisible();
  await page.getByLabel('I stored these codes somewhere private.').check();
  await page.getByRole('button', { name: 'I saved them — continue' }).click();
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Work email' }).fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/login/enroll');
  if (page.url().includes('/login/enroll')) await finishEnrollment(page);
  await page.waitForURL((url) => url.pathname === '/');
}

type OrderSnapshot = { id: string; orderNumber: string; status: string; version: number };

async function openFirstOrder(page: Page): Promise<{ href: string; order: OrderSnapshot }> {
  const listResponse = page.waitForResponse((response) => response.url().includes('/api/backend/admin/orders') && response.request().method() === 'GET');
  await page.goto('/orders');
  expect((await listResponse).status()).toBe(200);
  const firstOrderLink = page.locator('.ui-table tbody tr').first().getByRole('link');
  await expect(firstOrderLink).toBeVisible();
  const href = await firstOrderLink.getAttribute('href');
  if (!href) throw new Error('The live Orders row did not link to its record.');
  const detailResponse = page.waitForResponse((response) => response.url().includes(`/api/backend/admin/orders/${href.split('/').at(-1)}`) && response.request().method() === 'GET');
  await firstOrderLink.click();
  const response = await detailResponse;
  expect(response.status()).toBe(200);
  return { href, order: await response.json() as OrderSnapshot };
}

test('support receives a redacted live order and no fulfilment or invoice controls', async ({ page }) => {
  test.skip(!supportEmail || !supportPassword, 'Supply a temporary DASHBOARD_TEST_SUPPORT_EMAIL/PASSWORD for a real local-backend run.');
  test.setTimeout(90_000);

  await signIn(page, supportEmail!, supportPassword!);
  const { order } = await openFirstOrder(page);
  await expect(page.getByRole('heading', { name: order.orderNumber })).toBeVisible();
  await expect(page.getByText('Redacted view')).toBeVisible();
  await expect(page.getByText('Street and phone are redacted for this role.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Order actions' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Packing slip' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Issue GST invoice' })).toHaveCount(0);
  // Support may read an already-issued invoice (404 when none) but the backend blanks the buyer's street address for this role.
  const invoiceResponse = await page.request.get(`/api/backend/admin/orders/${order.id}/invoice`);
  expect([200, 404]).toContain(invoiceResponse.status());
  if (invoiceResponse.status() === 200) {
    const invoice = await invoiceResponse.json() as { buyer?: { address?: string } };
    expect(invoice.buyer?.address ?? '').toBe('');
  }

  const sessionResponse = await page.request.get('/api/auth/session');
  expect(sessionResponse.status()).toBe(200);
  const session = await sessionResponse.json() as { user?: { role?: string } | null };
  expect(session.user?.role).toBe('support');
});

test('two live browser contexts reject stale order versions without changing the order', async ({ page, browser }) => {
  test.skip(!fulfilmentEmail || !fulfilmentPassword, 'Supply a temporary DASHBOARD_TEST_ORDERS_EMAIL/PASSWORD for a real local-backend run.');
  test.setTimeout(90_000);

  await signIn(page, fulfilmentEmail!, fulfilmentPassword!);
  const { href, order } = await openFirstOrder(page);
  const secondContext = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    const secondPage = await secondContext.newPage();
    await secondPage.goto(href);
    const secondRead = await secondPage.evaluate(async (id) => {
      const response = await fetch(`/api/backend/admin/orders/${id}`);
      const payload = await response.json() as { status: string; version: number };
      return { httpStatus: response.status, ...payload };
    }, order.id);
    expect(secondRead.httpStatus).toBe(200);
    expect(secondRead.version).toBe(order.version);
    expect(secondRead.status).toBe(order.status);

    const expectedVersion = order.version - 1;
    const postStaleVersion = async (targetPage: Page) => targetPage.evaluate(async ({ id, expectedVersion: staleVersion }) => {
      const csrfCookie = document.cookie.split('; ').find((entry) => entry.startsWith('jw_csrf='));
      if (!csrfCookie) throw new Error('The same-origin CSRF proof cookie was unavailable.');
      const csrfToken = decodeURIComponent(csrfCookie.slice('jw_csrf='.length));
      const response = await fetch(`/api/backend/admin/orders/${id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ to: 'shipped', expectedVersion: staleVersion }),
      });
      const payload = await response.json() as { error?: { code?: string } };
      return { status: response.status, code: payload.error?.code };
    }, { id: order.id, expectedVersion });

    const results = await Promise.all([postStaleVersion(page), postStaleVersion(secondPage)]);
    expect(results).toEqual([
      { status: 409, code: 'CART_VERSION_CONFLICT' },
      { status: 409, code: 'CART_VERSION_CONFLICT' },
    ]);

    const latest = await page.evaluate(async (id) => {
      const response = await fetch(`/api/backend/admin/orders/${id}`);
      const payload = await response.json() as { status: string; version: number };
      return { httpStatus: response.status, status: payload.status, version: payload.version };
    }, order.id);
    expect(latest).toEqual({ httpStatus: 200, status: order.status, version: order.version });
  } finally {
    await secondContext.close();
  }
});

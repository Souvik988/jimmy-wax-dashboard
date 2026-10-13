import { createHmac } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

const email = process.env.DASHBOARD_TEST_ORDERS_EMAIL;
const password = process.env.DASHBOARD_TEST_ORDERS_PASSWORD;
const adminEmail = process.env.DASHBOARD_TEST_ADMIN_EMAIL;
const adminPassword = process.env.DASHBOARD_TEST_ADMIN_PASSWORD;
const orderId = process.env.DASHBOARD_TEST_ORDER_ID;
const cancellationReason = 'Phase 06 local COD fixture cleanup';
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
type StockSnapshot = { onHand: number; reserved: number; available: number };

async function stockSnapshot(page: Page): Promise<StockSnapshot> {
  const response = await page.request.get('/api/backend/admin/inventory');
  expect(response.status()).toBe(200);
  const inventory = await response.json() as { items: { sku: string; onHand: number; reserved: number; available: number }[] };
  const product = inventory.items.find((item) => item.sku === 'JW-TS-100');
  if (!product) throw new Error('The local test variant was not present in the live inventory response.');
  return { onHand: product.onHand, reserved: product.reserved, available: product.available };
}

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

async function finishEnrollment(page: Page): Promise<string> {
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

async function signInFreshOperator(page: Page, loginEmail: string, loginPassword: string): Promise<string> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Work email' }).fill(loginEmail);
  await page.getByLabel('Password').fill(loginPassword);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/login/enroll');
  let secret: string;
  if (page.url().includes('/login/enroll')) {
    secret = await finishEnrollment(page);
  } else {
    const sessionResponse = await page.request.get('/api/auth/session');
    const session = await sessionResponse.json() as { user?: { mfa?: boolean } | null };
    if (session.user?.mfa) throw new Error('The temporary local operator already had MFA; use a fresh account.');
    await page.goto('/login/enroll?next=%2F');
    secret = await finishEnrollment(page);
  }
  await page.waitForURL((url) => url.pathname === '/');
  return secret;
}

test('fulfillment cancels its local COD fixture with a reason and the backend restores stock', async ({ page, browser }) => {
  test.skip(!email || !password || !adminEmail || !adminPassword || !orderId, 'Supply fresh local admin/fulfillment operators and an explicitly identified Phase 06 COD fixture.');
  test.setTimeout(120_000);

  const totpSecret = await signInFreshOperator(page, email!, password!);

  const orderResponse = await page.request.get(`/api/backend/admin/orders/${orderId}`);
  expect(orderResponse.status()).toBe(200);
  const order = await orderResponse.json() as { id: string; status: string; paymentMethod: string; address: { name: string }; refunds: { id: string }[] };
  expect(order.status).toBe('processing');
  expect(order.paymentMethod).toBe('cod');
  expect(order.address.name).toBe('Phase 06 local test');

  const stockBefore = await stockSnapshot(page);

  await page.goto(`/orders/${order.id}`);
  await expect(page.getByRole('heading', { name: /^JW-/u })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel order' }).click();
  const reasonDialog = page.getByRole('dialog', { name: 'Cancel this order' });
  await expect(reasonDialog.getByText(/restocks committed stock/u)).toBeVisible();
  await reasonDialog.getByLabel('Reason').fill(cancellationReason);
  const firstCancelResponse = page.waitForResponse((response) => response.url().includes(`/api/backend/admin/orders/${order.id}/cancel`) && response.request().method() === 'POST');
  await reasonDialog.getByRole('button', { name: 'Continue' }).click();
  let cancelResponse = await firstCancelResponse;
  if (cancelResponse.status() === 403) {
    const refusal = await cancelResponse.json() as { error?: { code?: string } };
    expect(refusal.error?.code).toBe('MFA_REQUIRED');
    const stepUp = page.getByRole('dialog', { name: 'Verify this action' });
    await expect(stepUp).toBeVisible();
    const retry = page.waitForResponse((response) => response.url().includes(`/api/backend/admin/orders/${order.id}/cancel`) && response.request().method() === 'POST' && response.status() === 200);
    await stepUp.getByRole('textbox', { name: 'Authenticator code' }).fill(currentTotp(totpSecret));
    await stepUp.getByRole('button', { name: 'Verify' }).click();
    cancelResponse = await retry;
    await expect(stepUp).toBeHidden();
  }
  expect(cancelResponse.status()).toBe(200);
  await expect(page.getByText('cancelled', { exact: true })).toBeVisible();

  const latestOrderResponse = await page.request.get(`/api/backend/admin/orders/${order.id}`);
  const latestOrder = await latestOrderResponse.json() as { status: string; refunds: { id: string }[] };
  expect(latestOrder.status).toBe('cancelled');
  expect(latestOrder.refunds).toHaveLength(0);
  const stockAfter = await stockSnapshot(page);
  expect(stockAfter.onHand).toBe(stockBefore.onHand + 1);
  expect(stockAfter.available).toBe(stockBefore.available + 1);
  expect(stockAfter.reserved).toBe(stockBefore.reserved);

  const fulfillmentAuditResponse = await page.request.get('/api/backend/admin/audit');
  expect(fulfillmentAuditResponse.status()).toBe(403);

  const auditContext = await browser.newContext();
  try {
    const adminPage = await auditContext.newPage();
    await signInFreshOperator(adminPage, adminEmail!, adminPassword!);
    const auditResponse = await adminPage.request.get('/api/backend/admin/audit');
  expect(auditResponse.status()).toBe(200);
  const audit = await auditResponse.json() as { items: { action: string; reason: string | null; resourceId: string }[] };
  expect(audit.items.some((item) => item.action === 'order.cancel' && item.resourceId === order.id && item.reason === cancellationReason)).toBe(true);
  } finally {
    await auditContext.close();
  }
});

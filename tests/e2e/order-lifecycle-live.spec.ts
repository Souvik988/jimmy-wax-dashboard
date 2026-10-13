import { createHmac, randomUUID } from 'node:crypto';

import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';

const adminEmail = process.env.DASHBOARD_TEST_ADMIN_EMAIL;
const adminPassword = process.env.DASHBOARD_TEST_ADMIN_PASSWORD;
const fulfilmentEmail = process.env.DASHBOARD_TEST_ORDERS_EMAIL;
const fulfilmentPassword = process.env.DASHBOARD_TEST_ORDERS_PASSWORD;
const demoPhone = '9800000001';
const deliveryPin = '743287';
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

async function signInFreshOperator(page: Page, email: string, password: string): Promise<string> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Work email' }).fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/login/enroll');
  let secret: string;
  if (page.url().includes('/login/enroll')) {
    secret = await finishEnrollment(page);
  } else {
    const sessionResponse = await page.request.get('/api/auth/session');
    const session = await sessionResponse.json() as { user?: { mfa?: boolean } | null };
    if (session.user?.mfa) throw new Error('The temporary local operator already had an MFA enrollment; use a fresh account.');
    await page.goto('/login/enroll?next=%2F');
    secret = await finishEnrollment(page);
  }
  await page.waitForURL((url) => url.pathname === '/');
  return secret;
}

async function disableCheckoutFallback(page: Page): Promise<void> {
  const statusResponse = await page.request.get('/api/backend/admin/store-status');
  if (!statusResponse.ok()) throw new Error('The local checkout cleanup status could not be read.');
  const status = await statusResponse.json() as { checkoutOpen: boolean };
  if (!status.checkoutOpen) return;
  const result = await page.evaluate(async () => {
    const cookie = document.cookie.split('; ').find((entry) => entry.startsWith('jw_csrf='));
    if (!cookie) throw new Error('The same-origin CSRF proof cookie was unavailable for checkout cleanup.');
    const response = await fetch('/api/backend/admin/checkout/disable', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(cookie.slice('jw_csrf='.length)) },
      body: JSON.stringify({ reason: 'Phase 06 interrupted test cleanup; restore local checkout safety lock.' }),
    });
    return response.status;
  });
  if (result !== 204) throw new Error('The local checkout safety lock could not be restored.');
}

test('admin activates checkout with MFA, fulfillment moves a real COD order, and checkout is safely disabled', async ({ page, browser }) => {
  test.skip(!adminEmail || !adminPassword || !fulfilmentEmail || !fulfilmentPassword, 'Supply temporary local admin and fulfillment credentials for a real customer-to-operator order flow.');
  test.setTimeout(180_000);

  let checkoutMayBeOpen = false;
  let addressId: string | null = null;
  let customerApi: Awaited<ReturnType<typeof playwrightRequest.newContext>> | null = null;
  let testVariantId: string | null = null;
  let orderCreated = false;

  try {
    const adminTotpSecret = await signInFreshOperator(page, adminEmail!, adminPassword!);
    await page.getByRole('heading', { name: 'Store controls' }).waitFor();
    const activateButton = page.getByRole('button', { name: 'Activate checkout', exact: true });
    await expect(activateButton).toBeEnabled();
    await activateButton.click();
    const activationDialog = page.getByRole('dialog', { name: 'Activate checkout' });
    await activationDialog.getByLabel('Reason').fill('Phase 06 local customer-to-operator verification');
    await activationDialog.getByLabel('Type ACTIVATE to continue').fill('ACTIVATE');
    const activationResponse = page.waitForResponse((response) => response.url().includes('/api/backend/admin/checkout/activate') && response.request().method() === 'POST');
    await activationDialog.getByRole('button', { name: 'Activate checkout', exact: true }).click();
    const initialActivation = await activationResponse;
    if (initialActivation.status() === 403) {
      const stepUp = page.getByRole('dialog', { name: 'Verify this action' });
      await expect(stepUp).toBeVisible();
      await stepUp.getByRole('textbox', { name: 'Authenticator code' }).fill(currentTotp(adminTotpSecret));
      const elevatedActivation = page.waitForResponse((response) => response.url().includes('/api/backend/admin/checkout/activate') && response.request().method() === 'POST' && response.status() === 204);
      await stepUp.getByRole('button', { name: 'Verify' }).click();
      await elevatedActivation;
      checkoutMayBeOpen = true;
      await expect(stepUp).toBeHidden();
    } else {
      expect(initialActivation.status()).toBe(204);
      checkoutMayBeOpen = true;
    }
    await expect(page.getByText('Checkout open')).toBeVisible();

    const unauthenticated = await playwrightRequest.newContext({ baseURL: 'http://localhost:8080' });
    try {
      const otpResponse = await unauthenticated.post('/v1/auth/otp/request', { data: { phone: demoPhone } });
      expect(otpResponse.status()).toBe(202);
      const loginResponse = await unauthenticated.post('/v1/auth/otp/verify', { data: { phone: demoPhone, code: '123456' } });
      expect(loginResponse.status()).toBe(200);
      const login = await loginResponse.json() as { accessToken: string };
      customerApi = await playwrightRequest.newContext({ baseURL: 'http://localhost:8080', extraHTTPHeaders: { authorization: `Bearer ${login.accessToken}` } });
    } finally {
      await unauthenticated.dispose();
    }

    const cartResponse = await customerApi.get('/v1/cart');
    expect(cartResponse.status()).toBe(200);
    const cart = await cartResponse.json() as { version: number; lines: { variantId: string }[] };
    expect(cart.lines).toHaveLength(0);

    const addressResponse = await customerApi.post('/v1/addresses', { data: { recipientName: 'Phase 06 local test', phone: demoPhone, line1: 'Local verification address', landmark: '', city: 'Kolkata', state: 'West Bengal', postalCode: deliveryPin, isDefault: false } });
    expect(addressResponse.status()).toBe(201);
    const address = await addressResponse.json() as { id: string };
    addressId = address.id;

    const productResponse = await customerApi.get('/v1/products/twinkle-shine-leather-polish');
    expect(productResponse.status()).toBe(200);
    const product = await productResponse.json() as { variant: { id: string; available: boolean; availableQuantity: number } };
    expect(product.variant.available).toBe(true);
    expect(product.variant.availableQuantity).toBeGreaterThan(0);
    testVariantId = product.variant.id;

    const lineResponse = await customerApi.put(`/v1/cart/lines/${encodeURIComponent(testVariantId)}`, { data: { quantity: 1, expectedVersion: cart.version } });
    expect(lineResponse.status()).toBe(200);
    const quoteResponse = await customerApi.post('/v1/checkout/quotes', { data: { addressId, paymentMethod: 'cod' } });
    expect(quoteResponse.status()).toBe(201);
    const quote = await quoteResponse.json() as { id: string; stockReserved: false; totalPaise: number };
    expect(quote.stockReserved).toBe(false);
    expect(quote.totalPaise).toBeGreaterThan(0);

    const orderResponse = await customerApi.post('/v1/orders', { headers: { 'Idempotency-Key': randomUUID() }, data: { quoteId: quote.id } });
    expect(orderResponse.status()).toBe(201);
    const order = await orderResponse.json() as { id: string; orderNumber: string; status: string; paymentStatus: string; totalPaise: number };
    expect(order.status).toBe('placed');
    expect(order.paymentStatus).toBe('cod_due');
    expect(order.totalPaise).toBe(quote.totalPaise);
    orderCreated = true;

    const fulfillmentBrowserContext = await browser.newContext();
    try {
      const fulfillmentPage = await fulfillmentBrowserContext.newPage();
      await signInFreshOperator(fulfillmentPage, fulfilmentEmail!, fulfilmentPassword!);
      await fulfillmentPage.goto(`/orders/${order.id}`);
      await expect(fulfillmentPage.getByRole('heading', { name: order.orderNumber })).toBeVisible();
      await expect(fulfillmentPage.getByText(`₹${(order.totalPaise / 100).toLocaleString('en-IN')}`, { exact: true })).toBeVisible();

      const confirmResponse = fulfillmentPage.waitForResponse((response) => response.url().includes(`/api/backend/admin/orders/${order.id}/status`) && response.request().method() === 'POST');
      await fulfillmentPage.getByRole('button', { name: 'Confirm order' }).click();
      expect((await confirmResponse).status()).toBe(200);
      await expect(fulfillmentPage.getByText('confirmed', { exact: true })).toBeVisible();

      const processingResponse = fulfillmentPage.waitForResponse((response) => response.url().includes(`/api/backend/admin/orders/${order.id}/status`) && response.request().method() === 'POST');
      await fulfillmentPage.getByRole('button', { name: 'Start processing' }).click();
      expect((await processingResponse).status()).toBe(200);
      await expect(fulfillmentPage.getByText('processing', { exact: true })).toBeVisible();
    } finally {
      await fulfillmentBrowserContext.close();
    }

    await page.goto('/');
    await page.getByRole('button', { name: 'Disable checkout' }).click();
    const disableDialog = page.getByRole('dialog', { name: 'Disable checkout' });
    await disableDialog.getByLabel('Reason').fill('Phase 06 local verification complete; restore checkout safety lock');
    await disableDialog.getByLabel('Type DISABLE CHECKOUT to continue').fill('DISABLE CHECKOUT');
    const disableResponse = page.waitForResponse((response) => response.url().includes('/api/backend/admin/checkout/disable') && response.request().method() === 'POST');
    await disableDialog.getByRole('button', { name: 'Disable checkout', exact: true }).click();
    expect((await disableResponse).status()).toBe(204);
    checkoutMayBeOpen = false;
    await expect(page.getByText('Checkout off')).toBeVisible();

    const auditResponse = await page.request.get('/api/backend/admin/audit');
    expect(auditResponse.status()).toBe(200);
    const audit = await auditResponse.json() as { items: { action: string; reason: string | null; resourceId: string }[] };
    expect(audit.items.some((item) => item.action === 'checkout.activate' && item.reason === 'Phase 06 local customer-to-operator verification')).toBe(true);
    expect(audit.items.some((item) => item.action === 'checkout.disable' && item.reason === 'Phase 06 local verification complete; restore checkout safety lock')).toBe(true);
  } finally {
    if (customerApi) {
      if (!orderCreated && testVariantId) {
        const currentCartResponse = await customerApi.get('/v1/cart').catch(() => null);
        if (currentCartResponse?.ok()) {
          const currentCart = await currentCartResponse.json() as { version: number; lines: { variantId: string }[] };
          if (currentCart.lines.some((line) => line.variantId === testVariantId)) {
            await customerApi.put(`/v1/cart/lines/${encodeURIComponent(testVariantId)}`, { data: { quantity: 0, expectedVersion: currentCart.version } }).catch(() => null);
          }
        }
      }
      if (addressId) await customerApi.delete(`/v1/addresses/${addressId}`).catch(() => null);
      await customerApi.dispose();
    }
    if (checkoutMayBeOpen) await disableCheckoutFallback(page);
  }
});

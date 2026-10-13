import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';

type LocalOrder = { id: string; orderNumber: string; status: string; demo: boolean };
type AdminOrderDetail = { id: string; orderNumber: string; status: string; address: { name: string } };
type OrderShipment = { id: string; courier: string; trackingNumber: string; status: string; events: { status: string; description: string }[] };
type OrderShipments = { items: OrderShipment[] };
type ShipmentDetail = { id: string; orderId: string; provider: string; awb: string; status: string; events: { status: string; description: string }[] };

const enabled = process.env.DASHBOARD_RUN_PHASE7_SHIPMENT_MUTATION === '1';
const orderId = process.env.DASHBOARD_PHASE7_ORDER_ID ?? '';
const expectedOrderId = '5396faa7-139e-4054-8c4e-ac6c73525118';
const orderNumber = 'JW-20261007-5396FAA7';
const recipientName = 'Phase Six Fixture';
const courier = 'Phase 7 Local Test Courier';
const trackingNumber = 'PHASE7-5396FAA7';
const fulfillmentEmail = process.env.DASHBOARD_TEST_SHIPPING_EMAIL ?? '';
const fulfillmentPassword = process.env.DASHBOARD_TEST_SHIPPING_PASSWORD ?? '';
const evidencePath = resolve(process.cwd(), 'docs/build/evidence/phase-07');
const statuses = ['label_created', 'in_transit', 'out_for_delivery', 'delivered'] as const;
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

async function enrollMfa(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Begin secure setup' }).click();
  await page.getByRole('button', { name: 'Reveal key' }).click();
  const secret = await page.locator('.mfa-secret code').textContent();
  if (!secret) throw new Error('The temporary local operator MFA setup key was unavailable.');
  await page.getByRole('textbox', { name: 'Authenticator code' }).fill(currentTotp(secret));
  await page.getByRole('button', { name: 'Verify and finish setup' }).click();
  await expect(page.locator('.recovery-code-list li').first()).toBeVisible();
  await page.getByLabel('I stored these codes somewhere private.').check();
  await page.getByRole('button', { name: 'I saved them — continue' }).click();
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login?next=%2Fshipping');
  await page.getByRole('textbox', { name: 'Work email' }).fill(fulfillmentEmail);
  await page.getByLabel('Password').fill(fulfillmentPassword);
  const loginResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  expect((await loginResponse).status()).toBe(200);
  await page.waitForURL((url) => ['/shipping', '/login/enroll'].includes(url.pathname));
  if (page.url().includes('/login/enroll')) await enrollMfa(page);
  await page.waitForURL((url) => url.pathname === '/shipping');
  await expect(page.getByText('Signed in · fulfillment', { exact: true })).toBeVisible();
}

async function getJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `Expected a successful same-origin read for ${path}`).toBe(200);
  return await response.json() as T;
}

async function readShipment(page: Page, shipmentId: string): Promise<ShipmentDetail> {
  return getJson<ShipmentDetail>(page, `/api/backend/admin/shipments/${shipmentId}`);
}

async function captureDetail(page: Page, suffix: string): Promise<void> {
  await page.locator('nextjs-portal').evaluateAll((portals) => portals.forEach((portal) => portal.remove()));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: resolve(evidencePath, `shipment-detail-${suffix}-375.png`), fullPage: true });
}

test('records one guarded manual shipment and verifies its customer tracking timeline', async ({ page }, testInfo) => {
  test.skip(!enabled || !orderId || !fulfillmentEmail || !fulfillmentPassword, 'This state-changing acceptance test requires its explicit mutation flag, named local fixture, and disposable fulfillment credentials.');
  test.setTimeout(180_000);
  mkdirSync(evidencePath, { recursive: true });
  expect(orderId).toBe(expectedOrderId);
  await signIn(page);

  // Preflight is read-only. Any mismatch stops before a shipment mutation.
  const provider = await getJson<{ provider: string; configured: boolean }>(page, '/api/backend/admin/shipping/provider');
  expect(provider.provider).toBe('manual');
  expect(provider.configured).toBe(false);
  const health = await getJson<{ policy: { checkoutOpen: boolean } | null }>(page, '/api/health');
  expect(health.policy?.checkoutOpen).toBe(false);
  const orders = await getJson<{ items: LocalOrder[] }>(page, `/api/backend/admin/orders?limit=20&q=${encodeURIComponent(orderNumber)}`);
  const fixture = orders.items.find((candidate) => candidate.id === orderId);
  expect(fixture, 'The exact retained local order must be present in the operator order list.').toBeDefined();
  expect(fixture?.orderNumber).toBe(orderNumber);
  expect(fixture?.demo).toBe(true);
  const order = await getJson<AdminOrderDetail>(page, `/api/backend/admin/orders/${orderId}`);
  expect(order.id).toBe(orderId);
  expect(order.orderNumber).toBe(orderNumber);
  expect(order.address.name).toBe(recipientName);
  expect(['processing', 'shipped']).toContain(order.status);

  const existing = await getJson<OrderShipments>(page, `/api/backend/admin/orders/${orderId}/shipments`);
  const matching = existing.items.filter((shipment) => shipment.courier === courier && shipment.trackingNumber === trackingNumber);
  expect(existing.items.length, 'Stop if this fixture already contains any unrelated shipment.').toBe(matching.length);
  expect(matching.length).toBeLessThanOrEqual(1);

  let shipmentId: string;
  if (matching[0]) {
    expect(order.status).toBe('shipped');
    shipmentId = matching[0].id;
  } else {
    expect(order.status).toBe('processing');
    const ready = await getJson<{ items: { id: string; orderNumber: string }[] }>(page, '/api/backend/admin/shipping/ready?limit=20');
    expect(ready.items.some((item) => item.id === orderId && item.orderNumber === orderNumber)).toBe(true);

    await page.goto('/shipping');
    const orderCard = page.locator('article').filter({ has: page.getByRole('link', { name: `Open order ${orderNumber}` }) });
    await expect(orderCard).toHaveCount(1);
    await orderCard.getByRole('button', { name: 'Add shipment' }).click();
    const dialog = page.getByRole('dialog', { name: `Add manual shipment · ${orderNumber}` });
    await dialog.getByLabel('Courier').fill(courier);
    await dialog.getByLabel('Tracking number').fill(trackingNumber);
    const createResponse = page.waitForResponse((response) => response.url().includes(`/api/backend/admin/orders/${orderId}/shipments`) && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Record shipment' }).click();
    expect((await createResponse).status()).toBe(201);
    await expect(dialog.getByRole('heading', { name: 'Shipment recorded' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    const created = await getJson<OrderShipments>(page, `/api/backend/admin/orders/${orderId}/shipments`);
    const createdMatch = created.items.filter((shipment) => shipment.courier === courier && shipment.trackingNumber === trackingNumber);
    expect(createdMatch).toHaveLength(1);
    shipmentId = createdMatch[0]!.id;
  }

  let current = await readShipment(page, shipmentId);
  expect(current).toMatchObject({ id: shipmentId, orderId, provider: 'manual', awb: trackingNumber });
  expect(statuses).toContain(current.status);
  await page.goto(`/shipping/shipments/${shipmentId}`);
  await expect(page.getByRole('heading', { name: 'Shipment tracking' })).toBeVisible();
  if (current.status === 'label_created') await captureDetail(page, 'label-created');
  const currentIndex = statuses.findIndex((status) => status === current.status);
  expect(currentIndex).toBeGreaterThanOrEqual(0);
  for (const nextStatus of statuses.slice(currentIndex + 1)) {
    if (nextStatus === 'label_created') continue;
    await page.getByLabel('Tracking status event').selectOption(nextStatus);
    await page.getByLabel('Event note · optional').fill(`Phase 7 local verification: carrier-confirmed ${nextStatus} scan.`);
    await page.getByLabel('I confirm this tracking update is accurate and may be visible to the customer.').check();
    const eventResponse = page.waitForResponse((response) => response.url().includes(`/api/backend/admin/shipments/${shipmentId}/events`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Record tracking event' }).click();
    expect((await eventResponse).status()).toBe(204);
    await expect(page.getByRole('status').filter({ hasText: 'The backend confirmed this tracking update' })).toBeVisible();
    current = await readShipment(page, shipmentId);
    expect(current.status).toBe(nextStatus);
    expect(current.events.some((event) => event.status === nextStatus && event.description === `Phase 7 local verification: carrier-confirmed ${nextStatus} scan.`)).toBe(true);
    await page.reload();
    await expect(page.getByRole('main').getByText(nextStatus.replaceAll('_', ' '), { exact: false }).first()).toBeVisible();
    await captureDetail(page, nextStatus.replaceAll('_', '-'));
  }

  current = await readShipment(page, shipmentId);
  expect(current.status).toBe('delivered');
  await page.setViewportSize({ width: 375, height: 812 });
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(accessibility.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  const customerAuth = await playwrightRequest.newContext({ baseURL: process.env.DASHBOARD_TEST_GATEWAY_URL ?? 'http://localhost:8080' });
  let customerApi: Awaited<ReturnType<typeof playwrightRequest.newContext>> | null = null;
  try {
    expect((await customerAuth.post('/v1/auth/otp/request', { data: { phone: '9800000001' } })).status()).toBe(202);
    const loginResponse = await customerAuth.post('/v1/auth/otp/verify', { data: { phone: '9800000001', code: '123456' } });
    expect(loginResponse.status()).toBe(200);
    const login = await loginResponse.json() as { accessToken: string };
    customerApi = await playwrightRequest.newContext({
      baseURL: process.env.DASHBOARD_TEST_GATEWAY_URL ?? 'http://localhost:8080',
      extraHTTPHeaders: { authorization: `Bearer ${login.accessToken}` },
    });
    const trackingResponse = await customerApi.get(`/v1/orders/${orderId}/shipments`);
    expect(trackingResponse.status()).toBe(200);
    const customerTracking = await trackingResponse.json() as OrderShipments;
    const publicShipment = customerTracking.items.find((shipment) => shipment.id === shipmentId);
    expect(publicShipment).toMatchObject({ id: shipmentId, courier, trackingNumber, status: 'delivered' });
    expect(publicShipment?.events.map((event) => event.status)).toEqual(statuses);
  } finally {
    await customerApi?.dispose();
    await customerAuth.dispose();
  }

  await page.setViewportSize({ width: 768, height: 1000 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: resolve(evidencePath, 'shipment-detail-delivered-768.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: resolve(evidencePath, 'shipment-detail-delivered-1440.png'), fullPage: true });
  testInfo.annotations.push({ type: 'fixture', description: 'Retained Phase 06 synthetic COD order; delivery status changed only by this gated acceptance test.' });
});

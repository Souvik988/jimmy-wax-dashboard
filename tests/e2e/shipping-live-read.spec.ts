import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';

type Role = 'admin' | 'support' | 'catalog' | 'fulfillment' | 'finance' | 'designer';
type TestOperator = { role: Role; email: string };
type ShipmentRow = { id: string; orderId: string; orderNumber?: string; provider: string; courier: string; awb: string; status: string };

const operators = process.env.DASHBOARD_TEST_SHIPPING_USERS ? JSON.parse(process.env.DASHBOARD_TEST_SHIPPING_USERS) as TestOperator[] : [];
const password = process.env.DASHBOARD_TEST_SHIPPING_PASSWORD ?? '';
const allowed = new Set<Role>(['admin', 'support', 'fulfillment', 'finance']);
const roles: Role[] = ['admin', 'support', 'catalog', 'fulfillment', 'finance', 'designer'];
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let fixtureShipmentId: string | null = null;

function currentTotp(secret: string): string {
  let accumulator = 0;
  let bitCount = 0;
  const decoded: number[] = [];
  for (const character of secret.toUpperCase().replace(/=+$/u, '').replace(/\s/gu, '')) {
    const index = alphabet.indexOf(character);
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

async function completeEnrollment(page: Page): Promise<void> {
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

async function signIn(page: Page, operator: TestOperator): Promise<void> {
  await page.goto('/login?next=%2Fshipping');
  await page.getByRole('textbox', { name: 'Work email' }).fill(operator.email);
  await page.getByLabel('Password').fill(password);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  expect((await responsePromise).status()).toBe(200);
  await page.waitForURL((url) => ['/shipping', '/login/enroll', '/login/mfa'].includes(url.pathname));
  if (page.url().includes('/login/enroll')) await completeEnrollment(page);
  else if (page.url().includes('/login/mfa')) throw new Error('Use a fresh local operator without an existing MFA secret.');
  await expect(page.getByText(`Signed in · ${operator.role}`, { exact: true })).toBeVisible();
}

test('Shipping Centre reads and role gates use the live local backend', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(180_000);
  test.skip(!password || roles.some((role) => !operators.some((operator) => operator.role === role)), 'Supply disposable dashboard test operators for all six roles.');

  for (const role of roles) {
    const operator = operators.find((candidate) => candidate.role === role);
    if (!operator) throw new Error(`No local test operator provided for ${role}.`);
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3200' });
    const page = await context.newPage();
    const shippingCalls: string[] = [];
    const shipmentCalls: string[] = [];
    const returnCalls: string[] = [];
    const refundCalls: string[] = [];
    const settingsCalls: string[] = [];
    const shippingStatuses = new Map<string, number>();
    page.on('request', (request) => {
      if (request.url().includes('/api/backend/admin/shipping/')) shippingCalls.push(request.url());
      if (request.url().includes('/api/backend/admin/shipments')) shipmentCalls.push(request.url());
      if (request.url().includes('/api/backend/admin/returns')) returnCalls.push(request.url());
      if (request.url().includes('/api/backend/admin/refunds')) refundCalls.push(request.url());
      if (request.url().includes('/api/backend/admin/settings')) settingsCalls.push(request.url());
    });
    page.on('response', (response) => {
      if (response.url().includes('/api/backend/admin/shipping/')) shippingStatuses.set(new URL(response.url()).pathname, response.status());
      if (response.url().includes('/api/backend/admin/shipments')) shippingStatuses.set(new URL(response.url()).pathname, response.status());
      if (response.url().includes('/api/backend/admin/returns')) shippingStatuses.set(new URL(response.url()).pathname, response.status());
      if (response.url().includes('/api/backend/admin/refunds')) shippingStatuses.set(new URL(response.url()).pathname, response.status());
      if (response.url().includes('/api/backend/admin/settings')) shippingStatuses.set(new URL(response.url()).pathname, response.status());
    });
    await signIn(page, operator);

    if (!allowed.has(role)) {
      await expect(page).toHaveURL(/\/forbidden$/u);
      expect(shippingCalls).toEqual([]);
      await page.goto('/shipping/shipments');
      await expect(page).toHaveURL(/\/forbidden$/u);
      expect(shipmentCalls).toEqual([]);
      await page.goto('/shipping/returns');
      await expect(page).toHaveURL(/\/forbidden$/u);
      expect(returnCalls).toEqual([]);
      expect(refundCalls).toEqual([]);
      expect(settingsCalls).toEqual([]);
      if (fixtureShipmentId) {
        await page.goto(`/shipping/shipments/${fixtureShipmentId}`);
        await expect(page).toHaveURL(/\/forbidden$/u);
        expect(shipmentCalls.some((url) => url.endsWith(`/admin/shipments/${fixtureShipmentId}`))).toBe(false);
      }
      await context.close();
      continue;
    }

    await expect(page.getByRole('heading', { name: 'Shipping centre', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Manual courier entry' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ready to ship', exact: true })).toBeVisible();
    const canCreateShipment = role === 'admin' || role === 'fulfillment';
    await expect.poll(() => shippingCalls.some((url) => url.includes('/shipping/provider'))).toBe(true);
    await expect.poll(() => shippingCalls.some((url) => url.includes('/shipping/ready'))).toBe(true);
    await expect.poll(() => [...shippingStatuses].find(([path]) => path.endsWith('/shipping/provider'))?.[1]).toBe(200);
    await expect.poll(() => [...shippingStatuses].find(([path]) => path.endsWith('/shipping/ready'))?.[1]).toBe(200);
    await expect.poll(() => [...shippingStatuses].find(([path]) => path.endsWith('/shipping/settings'))?.[1]).toBe(200);
    await expect.poll(() => [...shippingStatuses].find(([path]) => path.endsWith('/shipping/pins'))?.[1]).toBe(200);
    expect(shippingCalls.some((url) => new URL(url).pathname === '/api/backend/admin/shipping/settings')).toBe(true);
    expect(shippingCalls.some((url) => new URL(url).pathname === '/api/backend/admin/shipping/pins')).toBe(true);
    const readyResponse = await page.request.get('/api/backend/admin/shipping/ready?limit=20');
    expect(readyResponse.status()).toBe(200);
    const readyPage = await readyResponse.json() as { items: { id: string; orderNumber: string }[] };
    await expect(page.getByRole('button', { name: 'Add shipment' })).toHaveCount(canCreateShipment ? readyPage.items.length : 0);
    const providerResponse = await page.request.get('/api/backend/admin/shipping/provider');
    expect(providerResponse.status()).toBe(200);
    const provider = await providerResponse.json() as { provider: string; configured: boolean };
    if (provider.configured) {
      await expect.poll(() => shippingCalls.some((url) => new URL(url).pathname === '/api/backend/admin/shipping/pickup-locations')).toBe(true);
      await expect.poll(() => shippingStatuses.get('/api/backend/admin/shipping/pickup-locations')).toBe(200);
    } else {
      expect(shippingCalls.some((url) => new URL(url).pathname === '/api/backend/admin/shipping/pickup-locations')).toBe(false);
    }
    expect(shippingCalls.some((url) => url.includes('/shipping/serviceability/check'))).toBe(false);

    if (role === 'fulfillment' && !provider.configured) {
      const evidence = resolve(process.cwd(), 'docs/build/evidence/phase-07');
      await page.locator('nextjs-portal').evaluateAll((portals) => portals.forEach((portal) => portal.remove()));
      mkdirSync(evidence, { recursive: true });
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({
          path: resolve(evidence, `shipping-center-${width}.png`),
          fullPage: true,
          mask: [page.locator('[class*="customer"], [class*="location"], [aria-label="Serviceable PIN prefixes"]')],
          maskColor: '#b9a38a',
        });
      }
      await page.setViewportSize({ width: 375, height: 812 });
      const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
      expect(accessibility.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);

      await page.getByRole('textbox', { name: 'Delivery PIN code' }).fill('743287');
      await page.getByRole('spinbutton', { name: 'Parcel weight (grams)' }).fill('300');
      await page.getByRole('radio', { name: 'Prepaid' }).check();
      await page.getByRole('textbox', { name: 'Declared item value' }).fill('500');
      const checkResponse = page.waitForResponse((response) => response.url().endsWith('/api/backend/admin/shipping/serviceability/check') && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Check delivery area' }).click();
      expect((await checkResponse).status()).toBe(200);
      await expect(page.getByText(/No provider result was returned/i)).toBeVisible();
    }

    await page.goto('/shipping/returns');
    await expect(page.getByRole('heading', { name: 'Returns & refunds', exact: true })).toBeVisible();
    await expect.poll(() => returnCalls.some((url) => new URL(url).pathname === '/api/backend/admin/returns')).toBe(true);
    await expect.poll(() => shippingStatuses.get('/api/backend/admin/returns')).toBe(200);
    const returnResponse = await page.request.get('/api/backend/admin/returns');
    expect(returnResponse.status()).toBe(200);
    const returnPage = await returnResponse.json() as { items: { status: string }[] };
    const canViewRefunds = role === 'admin' || role === 'finance';
    const canViewPolicy = role === 'admin';
    await expect(page.getByRole('heading', { name: 'Refund records', exact: true })).toHaveCount(canViewRefunds ? 1 : 0);
    await expect(page.getByRole('heading', { name: 'Return window' })).toHaveCount(canViewPolicy ? 1 : 0);
    if (canViewPolicy) {
      await expect.poll(() => settingsCalls.some((url) => new URL(url).pathname === '/api/backend/admin/settings')).toBe(true);
      await expect.poll(() => shippingStatuses.get('/api/backend/admin/settings')).toBe(200);
    } else {
      expect(settingsCalls).toEqual([]);
    }
    if (canViewRefunds) {
      await expect.poll(() => refundCalls.some((url) => new URL(url).pathname === '/api/backend/admin/refunds')).toBe(true);
      await expect.poll(() => shippingStatuses.get('/api/backend/admin/refunds')).toBe(200);
      expect((await page.request.get('/api/backend/admin/refunds')).status()).toBe(200);
    } else {
      expect(refundCalls).toEqual([]);
    }
    const canDecideReturns = role === 'admin' || role === 'fulfillment';
    const requestedReturns = returnPage.items.filter((item) => item.status === 'requested').length;
    await expect(page.getByRole('button', { name: /^Approve return / })).toHaveCount(canDecideReturns ? requestedReturns : 0);
    await expect(page.getByRole('button', { name: /^Decline return / })).toHaveCount(canDecideReturns ? requestedReturns : 0);
    await expect(page.getByRole('button', { name: /receive return|restock|process refund/i })).toHaveCount(0);
    if (role === 'fulfillment') {
      const evidence = resolve(process.cwd(), 'docs/build/evidence/phase-07');
      await page.locator('nextjs-portal').evaluateAll((portals) => portals.forEach((portal) => portal.remove()));
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({
          path: resolve(evidence, `returns-${width}.png`),
          fullPage: true,
          mask: [page.locator('[aria-label="Customer return reason"]'), page.locator('[class*="refundRow"]')],
          maskColor: '#b9a38a',
        });
      }
      await page.setViewportSize({ width: 375, height: 812 });
      const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
      expect(accessibility.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
    }

    if (role === 'support') {
      const cookies = await context.cookies();
      const csrf = cookies.find((cookie) => cookie.name === 'jw_csrf')?.value;
      if (!csrf) throw new Error('The same-origin CSRF proof was not present.');
      const denied = await page.request.post('/api/backend/admin/orders/5396faa7-139e-4054-8c4e-ac6c73525118/shipments', {
        headers: { origin: 'http://localhost:3200', 'x-csrf-token': csrf },
        data: { courier: 'Local fixture', trackingNumber: 'PHASE7-SUPPORT-DENIAL' },
      });
      expect(denied.status()).toBe(403);
      expect((await denied.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
      if (fixtureShipmentId) {
        const eventDenied = await page.request.post(`/api/backend/admin/shipments/${fixtureShipmentId}/events`, {
          headers: { origin: 'http://localhost:3200', 'x-csrf-token': csrf },
          data: { status: 'in_transit', description: 'Role denial must happen before a shipment write.' },
        });
        expect(eventDenied.status()).toBe(403);
        expect((await eventDenied.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
      }
    }

    await page.goto('/shipping/shipments');
    await expect(page.getByRole('heading', { name: 'Shipment register' })).toBeVisible();
    await expect.poll(() => shipmentCalls.some((url) => new URL(url).pathname === '/api/backend/admin/shipments')).toBe(true);
    await expect.poll(() => shippingStatuses.get('/api/backend/admin/shipments')).toBe(200);
    const listResponse = await page.request.get('/api/backend/admin/shipments');
    expect(listResponse.status()).toBe(200);
    const shipmentPage = await listResponse.json() as { items: ShipmentRow[] };
    const fixtureShipment = shipmentPage.items.find((shipment) => shipment.orderNumber === 'JW-20261007-5396FAA7' && shipment.awb === 'PHASE7-5396FAA7');
    if (fixtureShipment) {
      expect(fixtureShipment).toMatchObject({ provider: 'manual', courier: 'Phase 7 Local Test Courier', status: 'delivered' });
      if (fixtureShipmentId) expect(fixtureShipment.id).toBe(fixtureShipmentId);
      fixtureShipmentId = fixtureShipment.id;
      await expect(page.getByRole('link', { name: 'JW-20261007-5396FAA7', exact: true })).toBeVisible();
    } else if (shipmentPage.items.length === 0) {
      await expect(page.getByRole('heading', { name: 'No shipments recorded yet' })).toBeVisible();
    } else {
      await expect(page.getByLabel('Shipment records')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'No shipments recorded yet' })).toHaveCount(0);
    }
    if (role === 'fulfillment') {
      const evidence = resolve(process.cwd(), 'docs/build/evidence/phase-07');
      await page.locator('nextjs-portal').evaluateAll((portals) => portals.forEach((portal) => portal.remove()));
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.screenshot({ path: resolve(evidence, `shipment-register-${width}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 375, height: 812 });
      const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
      expect(accessibility.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
    }
    const knownShipmentId = fixtureShipmentId;
    if (knownShipmentId) {
      await page.goto(`/shipping/shipments/${knownShipmentId}`);
      await expect(page.getByRole('heading', { name: 'Shipment tracking' })).toBeVisible();
      await expect.poll(() => shippingStatuses.get(`/api/backend/admin/shipments/${knownShipmentId}`)).toBe(200);
      await expect(page.getByRole('main').getByText('Delivered', { exact: true }).first()).toBeVisible();
      if (role === 'admin' || role === 'fulfillment') {
        await expect(page.getByRole('heading', { name: 'Record an event' })).toBeVisible();
      } else {
        await expect(page.getByText('This role can inspect tracking only.')).toBeVisible();
      }
    }
    await context.close();
  }
});

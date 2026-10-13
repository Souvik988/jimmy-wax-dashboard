import { createHmac } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

type Role = 'admin' | 'support' | 'catalog' | 'fulfillment' | 'finance' | 'designer';
type TestOperator = { role: Role; email: string };

const operators = process.env.DASHBOARD_TEST_USERS ? JSON.parse(process.env.DASHBOARD_TEST_USERS) as TestOperator[] : [];
const password = process.env.DASHBOARD_TEST_PASSWORD ?? '';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const studio = ['Experience Studio', 'Releases & publishing', 'Campaigns', 'Content library'];
const expectedNavigation: Record<Role, string[]> = {
  admin: ['Orders', 'Shipping centre', 'Products', 'Categories & collections', 'Inventory', 'Media library', ...studio, 'Customers', 'Reviews', 'Coupons', 'Message templates', 'Analytics', 'GST & finance', 'Audit log', 'Operations', 'Store settings', 'Team', 'Integrations', 'Feature flags & app versions'],
  support: ['Orders', 'Shipping centre', 'Customers', 'Reviews', 'Media library'],
  catalog: ['Products', 'Categories & collections', 'Inventory', 'Media library', ...studio],
  fulfillment: ['Orders', 'Shipping centre', 'Inventory', 'Customers', 'Analytics', 'GST & finance'],
  finance: ['Orders', 'Shipping centre', 'Coupons', 'Analytics', 'GST & finance', 'Audit log'],
  designer: ['Products', 'Categories & collections', 'Media library', ...studio],
};
const forbiddenProbeByRole: Partial<Record<Role, string>> = {
  support: '/api/backend/admin/products',
  catalog: '/api/backend/admin/orders',
  fulfillment: '/api/backend/admin/products',
  finance: '/api/backend/admin/products',
  designer: '/api/backend/admin/orders',
};
const overviewEndpoints = [
  'dashboard', 'analytics/sales', 'store-status', 'settings', 'health', 'integrations', 'audit',
] as const;
const overviewAllowedByRole: Record<Role, readonly (typeof overviewEndpoints)[number][]> = {
  admin: overviewEndpoints,
  support: ['dashboard'],
  catalog: [],
  fulfillment: ['dashboard', 'analytics/sales'],
  finance: ['dashboard', 'analytics/sales', 'audit'],
  designer: [],
};

function decodeBase32(value: string): Buffer {
  let accumulator = 0; let bitCount = 0; const output: number[] = [];
  for (const character of value.toUpperCase().replace(/=+$/u, '').replace(/\s/gu, '')) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('The backend returned an invalid authenticator key.');
    accumulator = (accumulator << 5) | index; bitCount += 5;
    if (bitCount >= 8) { bitCount -= 8; output.push((accumulator >> bitCount) & 0xff); accumulator &= (1 << bitCount) - 1; }
  }
  return Buffer.from(output);
}

function currentTotp(secret: string): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = (digest[19] ?? 0) & 0x0f;
  const binary = (((digest[offset] ?? 0) & 0x7f) << 24) | (((digest[offset + 1] ?? 0) & 0xff) << 16) | (((digest[offset + 2] ?? 0) & 0xff) << 8) | ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function finishRequiredMfa(page: import('@playwright/test').Page): Promise<void> {
  if (page.url().includes('/login/enroll')) {
    await page.getByRole('button', { name: 'Begin secure setup' }).click();
    await expect(page.getByRole('button', { name: 'Reveal key' })).toBeVisible();
    await page.getByRole('button', { name: 'Reveal key' }).click();
    const secret = await page.locator('.mfa-secret code').textContent();
    if (!secret) throw new Error('The MFA setup key was not available for the local authenticator test.');
    await page.getByRole('textbox', { name: 'Authenticator code' }).fill(currentTotp(secret));
    await page.getByRole('button', { name: 'Verify and finish setup' }).click();
    await expect(page.locator('.recovery-code-list li').first()).toBeVisible();
    await page.getByLabel('I stored these codes somewhere private.').check();
    await page.getByRole('button', { name: 'I saved them — continue' }).click();
    return;
  }
  if (page.url().includes('/login/mfa')) {
    throw new Error('An already-enrolled operator needs its local TOTP secret; create a fresh one-time test operator.');
  }
}

for (const role of ['admin', 'support', 'catalog', 'fulfillment', 'finance', 'designer'] as const) {
  test(`real backend operator role ${role} sees only its approved workspaces`, async ({ page }) => {
    const operator = operators.find((item) => item.role === role);
    test.skip(!operator || !password, 'Run with disposable DASHBOARD_TEST_USERS and DASHBOARD_TEST_PASSWORD values.');
    if (!operator) return;

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Work email' }).fill(operator.email);
    await page.getByLabel('Password').fill(password);
    const loginResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign in securely' }).click();
    const response = await loginResponse;
    expect(response.status()).toBe(200);
    const loginJson = await response.json() as Record<string, unknown>;
    expect(loginJson).not.toHaveProperty('accessToken');
    expect(loginJson).not.toHaveProperty('refreshToken');
    const cookiesAfterLogin = await page.context().cookies();
    const sessionCookie = cookiesAfterLogin.find((cookie) => cookie.name === 'jw_operator_session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatchObject({ httpOnly: true, secure: false, sameSite: 'Strict', path: '/' });
    await page.waitForURL((url) => ['/', '/login/enroll', '/login/mfa'].includes(url.pathname));
    let enrolledDuringSignIn = false;
    if (page.url().includes('/login/enroll') || page.url().includes('/login/mfa')) { await finishRequiredMfa(page); enrolledDuringSignIn = true; }
    await expect(page.getByText(`Signed in · ${role}`, { exact: true })).toBeVisible();

    const nav = page.locator('.shell-sidebar nav[aria-label="Primary navigation"]');
    await expect(nav.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
    const expected = expectedNavigation[role];
    for (const label of Object.keys(expectedNavigation).flatMap((key) => expectedNavigation[key as Role])) {
      const shouldBeVisible = expected.includes(label);
      const item = nav.locator(`[data-nav-item="${label}"]`);
      if (shouldBeVisible) await expect(item).toBeVisible();
      else await expect(item).toHaveCount(0);
    }

    const safeSessionResponse = await page.request.get('/api/auth/session');
    const safeSession = await safeSessionResponse.json() as { user: Record<string, unknown> | null };
    expect(safeSessionResponse.status()).toBe(200);
    expect(safeSession.user).not.toBeNull();
    expect(safeSession.user).not.toHaveProperty('accessToken');
    expect(safeSession.user).not.toHaveProperty('refreshToken');
    const forbiddenProbe = forbiddenProbeByRole[role];
    if (forbiddenProbe) {
      const denied = await page.request.get(forbiddenProbe);
      expect(denied.status()).toBe(403);
      expect((await denied.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    }
    const cookies = await page.context().cookies();
    const encrypted = cookies.find((cookie) => cookie.name === 'jw_operator_session');
    const csrf = cookies.find((cookie) => cookie.name === 'jw_csrf');
    expect(encrypted?.httpOnly).toBe(true);
    expect(encrypted?.sameSite).toBe('Strict');
    expect(csrf?.httpOnly).toBe(false);
    expect(`${JSON.stringify(await page.evaluate(() => localStorage))}${JSON.stringify(await page.evaluate(() => sessionStorage))}`).not.toMatch(/accessToken|refreshToken/i);

    const overviewCalls = new Map<string, number>();
    page.on('request', (request) => {
      for (const endpoint of overviewEndpoints) {
        if (request.url().includes(`/api/backend/admin/${endpoint}`) && request.method() === 'GET') overviewCalls.set(endpoint, (overviewCalls.get(endpoint) ?? 0) + 1);
      }
    });
    const overviewDashboard = overviewAllowedByRole[role].includes('dashboard')
      ? page.waitForResponse((candidate) => candidate.url().includes('/api/backend/admin/dashboard') && candidate.request().method() === 'GET')
      : undefined;
    await page.goto('/');
    if (overviewDashboard) expect((await overviewDashboard).status()).toBe(200);
    await expect(page.getByRole('heading', { name: role === 'admin' ? 'Store command centre' : 'Your operational view' })).toBeVisible();
    if (role === 'admin') {
      await expect(page.getByRole('heading', { name: 'System health' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Recent audited activity' })).toBeVisible();
    }
    for (const endpoint of overviewEndpoints) {
      if (!overviewAllowedByRole[role].includes(endpoint)) expect(overviewCalls.get(endpoint) ?? 0).toBe(0);
    }

    await page.goto('/account/security');
    await expect(page.getByRole('heading', { name: 'Account security' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Active operator sessions' })).toBeVisible();
    if (!enrolledDuringSignIn) {
      await page.goto('/login/enroll?next=%2Faccount%2Fsecurity');
      await finishRequiredMfa(page);
      await page.waitForURL((url) => url.pathname === '/account/security');
      await expect(page.locator('.security-facts dd').nth(1)).toHaveText('Enrolled');
    }

    const canReadCatalogue = ['admin', 'catalog', 'designer'].includes(role);
    let categoryReadCount = 0;
    let collectionReadCount = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/backend/admin/categories') && request.method() === 'GET') categoryReadCount += 1;
      if (request.url().includes('/api/backend/admin/collections') && request.method() === 'GET') collectionReadCount += 1;
    });
    if (canReadCatalogue) {
      const categoriesRead = page.waitForResponse((candidate) => candidate.url().includes('/api/backend/admin/categories') && candidate.request().method() === 'GET');
      const collectionsRead = page.waitForResponse((candidate) => candidate.url().includes('/api/backend/admin/collections') && candidate.request().method() === 'GET');
      const catalogueDocument = await page.goto('/catalogue');
      expect(catalogueDocument?.status()).toBe(200);
      expect((await categoriesRead).status()).toBe(200);
      expect((await collectionsRead).status()).toBe(200);
      await expect(page.getByRole('heading', { name: 'Categories & collections' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Categories could not be loaded' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Collections could not be loaded' })).toHaveCount(0);
      expect(categoryReadCount).toBeGreaterThan(0);
      expect(collectionReadCount).toBeGreaterThan(0);
      if (role === 'catalog') {
        await page.getByText('Catalogue CSV tools', { exact: true }).click();
        const exportResponsePromise = page.waitForResponse((candidate) => candidate.url().includes('/api/backend/admin/catalog/export') && candidate.request().method() === 'GET');
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export complete catalogue CSV' }).click();
        const [exportResponse, download] = await Promise.all([exportResponsePromise, downloadPromise]);
        expect(exportResponse.status()).toBe(200);
        expect(exportResponse.headers()['content-type']).toMatch(/^text\/csv/iu);
        expect(download.suggestedFilename()).toBe('jimmywax-catalogue.csv');
        const exportedFile = await download.path();
        if (!exportedFile) throw new Error('The local catalogue export did not produce a downloadable file.');
        const exportedFileInfo = await stat(exportedFile);
        if (exportedFileInfo.size > 2_000_000) test.skip(true, 'The full local export is too large for the backend import limit; no import was sent.');
        await page.getByLabel('Choose catalogue CSV').setInputFiles({ name: download.suggestedFilename(), mimeType: 'text/csv', buffer: await readFile(exportedFile) });
        const dryRunButton = page.getByRole('button', { name: 'Run dry-run, apply nothing' });
        await expect(dryRunButton).toBeEnabled();
        const dryRunResponsePromise = page.waitForResponse((candidate) => candidate.url().includes('/api/backend/admin/catalog/import') && candidate.request().method() === 'POST');
        await dryRunButton.click();
        const dryRunResponse = await dryRunResponsePromise;
        expect([200, 422]).toContain(dryRunResponse.status());
        expect(dryRunResponse.headers()['content-type']).toMatch(/application\/json/iu);
        expect(dryRunResponse.request().headers()['content-type']).toMatch(/^text\/csv/iu);
        expect(dryRunResponse.request().postData()?.startsWith('product_id,name,')).toBe(true);
        expect(await dryRunResponse.json()).toMatchObject({ dryRun: true, applied: false });
        await expect(page.getByText('Nothing was applied', { exact: true })).toBeVisible();
      }
    } else {
      await page.goto('/catalogue');
      await expect(page).toHaveURL(/\/forbidden$/u);
      expect(categoryReadCount).toBe(0);
      expect(collectionReadCount).toBe(0);
    }

    const canReadInventory = ['admin', 'catalog', 'fulfillment'].includes(role);
    const canAdjustInventory = ['admin', 'fulfillment'].includes(role);
    let inventoryReadCount = 0;
    let inventoryWrites = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/backend/admin/inventory') && request.method() === 'GET') inventoryReadCount += 1;
      if (request.url().includes('/api/backend/admin/inventory/') && request.method() !== 'GET') inventoryWrites += 1;
    });
    if (canReadInventory) {
      const inventoryRead = page.waitForResponse((candidate) => candidate.url().includes('/api/backend/admin/inventory') && candidate.request().method() === 'GET');
      const inventoryDocument = await page.goto('/inventory');
      expect(inventoryDocument?.status()).toBe(200);
      expect((await inventoryRead).status()).toBe(200);
      await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
      expect(inventoryReadCount).toBeGreaterThan(0);
      if (!canAdjustInventory) expect(page.getByRole('button', { name: /^Adjust stock/u })).toHaveCount(0);
    } else {
      await page.goto('/inventory');
      await expect(page).toHaveURL(/\/forbidden$/u);
      expect(inventoryReadCount).toBe(0);
    }
    expect(inventoryWrites).toBe(0);
    if (role === 'catalog') {
      const deniedAdjustment = await page.evaluate(async () => {
        const csrf = document.cookie.split('; ').find((part) => part.startsWith('jw_csrf='))?.slice('jw_csrf='.length);
        if (!csrf) return { status: 0, code: 'MISSING_CSRF_COOKIE' };
        const response = await fetch('/api/backend/admin/inventory/phase08-role-probe/adjust', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify({ delta: 1, reason: 'Phase 08 role denial test', expectedVersion: 1 }),
        });
        const body = await response.json() as { error?: { code?: string } };
        return { status: response.status, code: body.error?.code ?? '' };
      });
      expect(deniedAdjustment).toEqual({ status: 403, code: 'FORBIDDEN' });
    }

    const canReadOrders = ['admin', 'support', 'fulfillment', 'finance'].includes(role);
    let ordersReadCount = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/backend/admin/orders') && request.method() === 'GET') ordersReadCount += 1;
    });
    const ordersResponse = canReadOrders
      ? page.waitForResponse((candidate) => candidate.url().includes('/api/backend/admin/orders') && candidate.request().method() === 'GET')
      : undefined;
    await page.goto('/orders');
    if (canReadOrders) {
      expect((await ordersResponse)?.status()).toBe(200);
      await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
      expect(ordersReadCount).toBeGreaterThan(0);
    } else {
      await expect(page).toHaveURL(/\/forbidden$/u);
      await expect(page.getByRole('heading', { name: 'You do not have access to this workspace.' })).toBeVisible();
      expect(ordersReadCount).toBe(0);
    }
  });
}

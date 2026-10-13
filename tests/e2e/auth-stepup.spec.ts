import { createHmac } from 'node:crypto';

import { expect, test } from '@playwright/test';

const email = process.env.DASHBOARD_TEST_STEPUP_EMAIL;
const password = process.env.DASHBOARD_TEST_STEPUP_PASSWORD;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function currentTotp(secret: string): string {
  let accumulator = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  for (const character of secret.toUpperCase().replace(/=+$/u, '').replace(/\s/gu, '')) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('The backend returned an invalid local test secret.');
    accumulator = (accumulator << 5) | index;
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((accumulator >> bitCount) & 0xff);
      accumulator &= (1 << bitCount) - 1;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = (digest[19] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

test('real MFA_REQUIRED opens a safe setup path and retries the action once after verification', async ({ page }) => {
  test.skip(!email || !password, 'Run with a disposable admin account in DASHBOARD_TEST_STEPUP_* values.');

  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Work email' }).fill(email!);
  await page.getByLabel('Password').fill(password!);
  const loginResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  expect((await loginResponse).status()).toBe(200);
  await page.waitForURL((url) => url.pathname === '/');

  await page.goto('/dev/components');
  let actionRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/backend/admin/app-versions/not-a-platform') actionRequests += 1;
  });
  await page.getByRole('button', { name: 'Request real MFA-gated validation' }).click();
  expect(actionRequests).toBe(1);
  const stepUpDialog = page.getByRole('dialog', { name: 'Verify this action' });
  await expect(stepUpDialog).toBeVisible();
  const setupLink = stepUpDialog.getByRole('link', { name: 'Set up an authenticator in a new tab' });
  await expect(setupLink).toHaveAttribute('target', '_blank');

  const [setupPage] = await Promise.all([
    page.context().waitForEvent('page'),
    setupLink.click(),
  ]);
  await setupPage.waitForURL((url) => url.pathname === '/login/enroll');
  await setupPage.getByRole('button', { name: 'Begin secure setup' }).click();
  await setupPage.getByRole('button', { name: 'Reveal key' }).click();
  const secret = await setupPage.locator('.mfa-secret code').textContent();
  if (!secret) throw new Error('The local MFA setup key was not available.');
  await setupPage.getByRole('textbox', { name: 'Authenticator code' }).fill(currentTotp(secret));
  await setupPage.getByRole('button', { name: 'Verify and finish setup' }).click();
  await expect(setupPage.locator('.recovery-code-list li').first()).toBeVisible();
  await setupPage.getByLabel('I stored these codes somewhere private.').check();
  await setupPage.getByRole('button', { name: 'I saved them — continue' }).click();
  await setupPage.waitForURL((url) => url.pathname === '/');

  await page.bringToFront();
  await page.getByRole('button', { name: 'I finished setup — check this session' }).click();
  await expect(stepUpDialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: '400: VALIDATION_FAILED' })).toBeVisible();
  expect(actionRequests).toBe(2);
  await expect(stepUpDialog).toHaveCount(0);
});

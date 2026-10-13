import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const email = process.env.DASHBOARD_TEST_OVERVIEW_EMAIL;
const password = process.env.DASHBOARD_TEST_OVERVIEW_PASSWORD;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function totp(secret: string): string {
  let buffer = 0; let bits = 0; const bytes: number[] = [];
  for (const character of secret.toUpperCase().replace(/=+$/u, '')) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error('Invalid development TOTP secret.');
    buffer = (buffer << 5) | value; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 0xff); buffer &= (1 << bits) - 1; }
  }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest(); const offset = (digest[19] ?? 0) & 0x0f;
  const value = (((digest[offset] ?? 0) & 0x7f) << 24) | (((digest[offset + 1] ?? 0) & 0xff) << 16) | (((digest[offset + 2] ?? 0) & 0xff) << 8) | ((digest[offset + 3] ?? 0) & 0xff);
  return String(value % 1_000_000).padStart(6, '0');
}

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Work email' }).fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/login/enroll');
  if (page.url().includes('/login/enroll')) {
    await page.getByRole('button', { name: 'Begin secure setup' }).click();
    await page.getByRole('button', { name: 'Reveal key' }).click();
    const secret = await page.locator('.mfa-secret code').textContent();
    if (!secret) throw new Error('Expected local MFA enrollment secret.');
    await page.getByRole('textbox', { name: 'Authenticator code' }).fill(totp(secret));
    await page.getByRole('button', { name: 'Verify and finish setup' }).click();
    await page.getByLabel('I stored these codes somewhere private.').check();
    await page.getByRole('button', { name: 'I saved them — continue' }).click();
  }
  await page.waitForURL((url) => url.pathname === '/');
}

async function publicStatus(page: import('@playwright/test').Page): Promise<{ ordersPaused: boolean; pauseMessage: string }> {
  const response = await page.request.get('http://localhost:8080/v1/store-settings');
  expect(response.status()).toBe(200);
  const body = await response.json() as { ordersPaused: boolean; pauseMessage: string };
  return body;
}

test('live overview independently loads, safely pauses/resumes, and reflects customer-facing status', async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!email || !password, 'Supply a temporary DASHBOARD_TEST_OVERVIEW_EMAIL/PASSWORD for the local live run.');
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Store command centre' })).toBeVisible();
  await expect(page.getByText('LIVE OPERATIONS · LOCAL BACKEND')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Store controls' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'System health' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();

  const initial = await publicStatus(page);
  const pauseMessage = 'Phase 05 local verification pause — restored immediately.';
  const pause = async () => {
    await page.getByRole('button', { name: 'Pause orders' }).click();
    const dialog = page.getByRole('dialog', { name: 'Pause new orders' });
    await dialog.getByRole('textbox', { name: 'Customer-facing pause message (optional)' }).fill(pauseMessage);
    const response = page.waitForResponse((candidate) => candidate.url().endsWith('/api/backend/admin/store-status') && candidate.request().method() === 'PUT' && candidate.status() === 200);
    await dialog.getByRole('button', { name: 'Pause new orders' }).click();
    await response;
    await expect.poll(async () => (await publicStatus(page)).ordersPaused).toBe(true);
  };
  const resume = async () => {
    await page.getByRole('button', { name: 'Resume orders' }).click();
    const dialog = page.getByRole('dialog', { name: 'Resume new orders' });
    const response = page.waitForResponse((candidate) => candidate.url().endsWith('/api/backend/admin/store-status') && candidate.request().method() === 'PUT' && candidate.status() === 200);
    await dialog.getByRole('button', { name: 'Resume new orders' }).click();
    await response;
    await expect.poll(async () => (await publicStatus(page)).ordersPaused).toBe(false);
  };
  try {
    if (initial.ordersPaused) await resume();
    await pause();
    await expect(page.getByRole('status', { name: 'New orders are paused' })).toBeVisible();
    await resume();
  } finally {
    const current = await publicStatus(page);
    if (current.ordersPaused !== initial.ordersPaused) {
      if (initial.ordersPaused) await pause();
      else await resume();
    }
  }

  const evidence = resolve(process.cwd(), 'docs/build/evidence/phase-05'); mkdirSync(evidence, { recursive: true });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.screenshot({ path: resolve(evidence, `overview-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(accessibility.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
});

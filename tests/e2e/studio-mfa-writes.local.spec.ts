import { createHmac } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * Local-only: a fresh admin enrols an authenticator, then performs MFA-gated writes through the UI: team invite (+ e-mail outbox row), coupon create/deactivate,
 * and a store-settings change that is reverted. Requires PUB_EMAIL / PUB_PASSWORD (fresh, never enrolled).
 */
const email = process.env.PUB_EMAIL ?? '';
const password = process.env.PUB_PASSWORD ?? '';
test.skip(!email || !password, 'Set PUB_EMAIL and PUB_PASSWORD for a fresh local admin.');

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secret: string): string {
  let acc = 0; let bits = 0; const out: number[] = [];
  for (const ch of secret.toUpperCase().replace(/[=\s]/gu, '')) { acc = (acc << 5) | alphabet.indexOf(ch); bits += 5; if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); acc &= (1 << bits) - 1; } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(out)).update(counter).digest();
  const o = (digest[19] ?? 0) & 15;
  const n = (((digest[o] ?? 0) & 127) << 24) | ((digest[o + 1] ?? 0) << 16) | ((digest[o + 2] ?? 0) << 8) | (digest[o + 3] ?? 0);
  return String(n % 1_000_000).padStart(6, '0');
}

async function verifyIfAsked(page: Page, secret: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Verify this action' });
  if (await dialog.isVisible({ timeout: 4000 }).catch(() => false)) {
    // wait for a fresh 30 s window so the code differs from the enrolment code
    await dialog.getByRole('textbox', { name: 'Authenticator code' }).fill(totp(secret));
    await dialog.getByRole('button', { name: 'Verify' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
  }
}

test('MFA-gated writes: team invite + outbox, coupon create/deactivate, settings change and revert', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login') || url.pathname === '/login/enroll');
  if (!page.url().includes('/login/enroll')) await page.goto('/login/enroll?next=%2F');
  await page.getByRole('button', { name: 'Begin secure setup' }).click();
  await page.getByRole('button', { name: 'Reveal key' }).click();
  const secret = (await page.locator('.mfa-secret code').textContent()) ?? '';
  await page.getByRole('textbox', { name: 'Authenticator code' }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and finish setup' }).click();
  await page.getByLabel('I stored these codes somewhere private.').check();
  await page.getByRole('button', { name: 'I saved them — continue' }).click();

  const outboxCount = async (): Promise<number> => page.evaluate(async () => ((await (await fetch('/api/backend/admin/outbox/emails')).json()) as { items: Array<{ template: string }> }).items.filter((i) => i.template === 'admin.invite').length);

  // Team invite
  await page.goto('/settings/team');
  await page.waitForLoadState('networkidle');
  const before = await outboxCount();
  await page.locator('main').getByLabel('Work email').fill(`invitee-${Date.now()}@local.jimmywax.test`);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await verifyIfAsked(page, secret);
  await expect(page.getByText('Invitation sent.')).toBeVisible({ timeout: 20_000 });
  await expect.poll(outboxCount, { timeout: 30_000, intervals: [2_000] }).toBeGreaterThan(before);
  await page.getByRole('button', { name: 'Revoke' }).first().click();
  await expect(page.getByText('Invitation revoked.')).toBeVisible({ timeout: 15_000 });

  // Coupon create + deactivate
  await page.goto('/coupons');
  await page.waitForLoadState('networkidle');
  const code = `QA${Date.now().toString().slice(-8)}`;
  await page.getByRole('button', { name: 'New coupon' }).click();
  await page.getByLabel('Code', { exact: true }).fill(code);
  await page.getByLabel('Percent off (%)').fill('10');
  await page.getByRole('button', { name: 'Create coupon' }).click();
  await verifyIfAsked(page, secret);
  await expect(page.getByText('Coupon created.')).toBeVisible({ timeout: 20_000 });
  const row = page.getByRole('listitem').filter({ hasText: code });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Deactivate' }).click();
  await page.getByRole('textbox', { name: new RegExp(`Type ${code}`) }).fill(code);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await verifyIfAsked(page, secret);
  await expect(page.getByText(/Coupon deactivated/)).toBeVisible({ timeout: 20_000 });

  // Settings change + revert (reason + MFA, audited)
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  const fee = page.getByLabel('Shipping fee (₹)');
  const original = await fee.inputValue();
  for (const value of [String(Number(original) + 1), original]) {
    await page.getByLabel('Shipping fee (₹)').fill(value);
    await page.getByRole('button', { name: /Review 1 change/ }).click();
    await page.getByRole('textbox', { name: 'Reason' }).fill('Local acceptance of the settings write path');
    await page.getByRole('button', { name: 'Continue' }).click();
    await verifyIfAsked(page, secret);
    await expect(page.getByText(/Settings saved/)).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await page.waitForLoadState('networkidle');
  }
  await expect(page.getByLabel('Shipping fee (₹)')).toHaveValue(original);
});

import { createHmac } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * Local-only: a fresh admin enrols an authenticator, validates, publishes a release for both channels (idempotency-keyed, MFA-gated),
 * flips the kill switch off and on, then rolls both channels back to the previous snapshots. Requires PUB_EMAIL / PUB_PASSWORD (fresh, never enrolled).
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
  if (await dialog.isVisible({ timeout: 8000 }).catch(() => false)) {
    // wait for a fresh 30 s window so the code differs from the enrolment code
    await dialog.getByRole('textbox', { name: 'Authenticator code' }).fill(totp(secret));
    await dialog.getByRole('button', { name: 'Verify' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
  }
}

test('enrol MFA, publish both channels, kill switch round trip, roll back', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login') || url.pathname === '/login/enroll');
  if (!page.url().includes('/login/enroll')) await page.goto('/login/enroll?next=%2Fstudio%2Freleases');
  await page.getByRole('button', { name: 'Begin secure setup' }).click();
  await page.getByRole('button', { name: 'Reveal key' }).click();
  const secret = (await page.locator('.mfa-secret code').textContent()) ?? '';
  expect(secret.length).toBeGreaterThan(10);
  await page.getByRole('textbox', { name: 'Authenticator code' }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and finish setup' }).click();
  await page.getByLabel('I stored these codes somewhere private.').check();
  await page.getByRole('button', { name: 'I saved them — continue' }).click();

  await page.goto('/studio/releases');
  await expect(page.getByRole('heading', { name: /Releases/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const before = await page.getByRole('list', { name: /./ }).count();
  void before;

  // Validate (read-only)
  await page.getByRole('button', { name: 'Validate before publishing' }).first().click();
  try { await expect(page.getByText(/blocking error|No blocking errors/).first()).toBeVisible({ timeout: 60_000 }); } catch (error) {
    console.log('DEBUG main text:', (await page.locator('main').innerText()).slice(0, 1500));
    throw error;
  }

  // Publish both channels
  const label = `Local acceptance ${Date.now()}`;
  await page.getByLabel('Release label').fill(label);
  await page.getByRole('button', { name: 'Publish now' }).click();
  await verifyIfAsked(page, secret);
  await expect(page.getByText(/Release published/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(label).first()).toBeVisible({ timeout: 60_000 });

  // Kill switch off then on (admin + MFA)
  const kill = page.getByRole('button', { name: 'Kill switch: use bundled defaults' }).first();
  await kill.click();
  await page.getByRole('textbox', { name: 'Reason' }).fill('Local acceptance test of the kill switch');
  await page.getByRole('button', { name: 'Continue' }).click();
  await verifyIfAsked(page, secret);
  await expect(page.getByText(/switched off/).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Switch Studio content back on' }).first().click();
  await page.getByRole('textbox', { name: 'Reason' }).fill('Local acceptance test: switching back on');
  await page.getByRole('button', { name: 'Continue' }).click();
  await verifyIfAsked(page, secret);
  await expect(page.getByText(/switched back on/).first()).toBeVisible({ timeout: 20_000 });

  // Roll back each channel to its seeded baseline snapshot (#2) — target rows by name, never by position.
  for (const name of ['App', 'Website']) {
    const row = page.getByRole('listitem').filter({ hasText: `${name} #2 — Baseline` }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.getByRole('button', { name: 'Roll back to this' }).click();
    await page.getByRole('textbox', { name: 'Reason' }).fill('Local acceptance rollback to the baseline');
    await page.getByRole('button', { name: 'Continue' }).click();
    await verifyIfAsked(page, secret);
    await expect(page.getByText(/Rolled back/)).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await page.waitForLoadState('networkidle');
  }
  await expect(page.getByText(/Rollback to #2/).first()).toBeVisible();
});

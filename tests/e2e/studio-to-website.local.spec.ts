import { createHmac } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * Local-only END-TO-END: edit the website hero headline in the Studio, publish the web channel (MFA), see the change on the REAL storefront (STOREFRONT_ORIGIN),
 * then roll back and see it disappear. Requires PUB_EMAIL / PUB_PASSWORD (fresh, never enrolled).
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

const storefront = process.env.STOREFRONT_ORIGIN ?? 'http://127.0.0.1:5174';

test('Studio edit -> publish -> real website shows it -> rollback -> website reverts', async ({ page, browser }) => {
  test.setTimeout(540_000);
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

  const site = await browser.newPage();
  const siteText = async (): Promise<string> => { await site.goto(storefront, { waitUntil: 'networkidle' }); return (await site.locator('body').innerText()).replace(/\s+/gu, ' '); };
  const baseline = await siteText();
  const marker = `Studio QA ${Date.now().toString().slice(-5)}`;
  expect(baseline).not.toContain(marker);

  // 1. Edit the hero headline in the Studio and save the draft
  await page.goto('/studio/doc/web/page/home');
  await expect(page.getByRole('heading', { name: /Page.*home/ })).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Hero Film Visible' }).click();
  const headline = page.getByRole('textbox', { name: /^Headline/ }).first();
  const original = await headline.inputValue();
  await headline.fill(`${original} ${marker}`);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Saved draft revision \d+/)).toBeVisible({ timeout: 20_000 });

  // 2. Publish ONLY the website channel
  await page.goto('/studio/releases');
  await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox', { name: 'Mobile app' }).uncheck();
  await page.getByLabel('Release label').fill(`Website QA ${marker}`);
  await page.getByRole('button', { name: 'Publish now' }).click();
  await verifyIfAsked(page, secret);
  await expect(page.getByText(/Release published/)).toBeVisible({ timeout: 30_000 });

  // 3. The REAL storefront renders the published copy
  await expect.poll(siteText, { timeout: 180_000, intervals: [5_000] }).toContain(marker);

  // 4. Roll back the website to the seeded baseline; the storefront reverts
  const row = page.getByRole('listitem').filter({ hasText: 'Website #2 — Baseline' }).first();
  await row.getByRole('button', { name: 'Roll back to this' }).click();
  await page.getByRole('textbox', { name: 'Reason' }).fill('End-to-end acceptance rollback');
  await page.getByRole('button', { name: 'Continue' }).click();
  await verifyIfAsked(page, secret);
  await expect(page.getByText(/Rolled back/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(siteText, { timeout: 180_000, intervals: [5_000] }).not.toContain(marker);

  // 5. Put the draft back exactly as it was
  await page.goto('/studio/doc/web/page/home');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Hero Film Visible' }).click();
  await page.getByRole('textbox', { name: /^Headline/ }).first().fill(original);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Saved draft revision \d+/)).toBeVisible({ timeout: 20_000 });
  await site.close();
});

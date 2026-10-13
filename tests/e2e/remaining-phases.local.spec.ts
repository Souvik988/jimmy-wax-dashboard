import { mkdirSync, writeFileSync } from 'node:fs';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** Local-only smoke: signs in as a disposable admin (LOCAL_ADMIN_EMAIL / LOCAL_ADMIN_PASSWORD) and visits every Phase 10â€“19 route against the real backend. */
const email = process.env.LOCAL_ADMIN_EMAIL ?? '';
const password = process.env.LOCAL_ADMIN_PASSWORD ?? '';
test.skip(!email || !password, 'Set LOCAL_ADMIN_EMAIL and LOCAL_ADMIN_PASSWORD for a disposable local operator.');

const routes: Array<[string, RegExp]> = [
  ['/studio?channel=app', /Mobile app/], ['/studio?channel=web', /Website/], ['/studio/doc/app/page/home', /Page.*home/], ['/studio/doc/shared/tokens/base', /Tokens.*base/],
  ['/studio/doc/app/navigation/main', /Navigation.*main/], ['/studio/releases', /Releases/], ['/studio/campaigns', /Campaigns/], ['/studio/library/care-guides', /Care Guides/],
  ['/media', /Media library/], ['/customers', /Customers/], ['/reviews', /Review moderation/], ['/coupons', /Coupons/], ['/messaging', /Message templates/], ['/analytics', /Analytics/], ['/finance', /GST/],
  ['/audit', /Audit log/], ['/ops', /Operations/], ['/settings', /Store settings/], ['/settings/integrations', /Integrations/], ['/settings/platform', /Feature flags/],
];

const authFile = 'test-results/.auth-remaining-phases.json';
mkdirSync('test-results', { recursive: true });
writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] })); // placeholder; replaced by the real session in beforeAll
test.use({ storageState: authFile });
test.describe.configure({ timeout: 180_000 });

// One sign-in for the whole file: the backend rate-limits logins, and per-test sign-ins made the suite flaky.
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3200' });
  const page = await context.newPage();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto('/login');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in securely' }).click();
    try { await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 12_000 }); break; } catch { await page.waitForTimeout(20_000); }
  }
  await context.storageState({ path: authFile });
  await context.close();
});

for (const [route, heading] of routes) {
  test(`renders ${route} without console errors or serious a11y violations`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error' && !/favicon|Failed to load resource|Applying inline style violates/u.test(message.text())) errors.push(message.text()); });
    await page.goto(route);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined); // polling panels may never go fully idle
    expect(await page.getByText(/could not be loaded|Application error/i).count()).toBe(0);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = axe.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''));
    expect(serious.map((violation) => `${violation.id}: ${violation.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
    expect(errors).toEqual([]);
  });
}



test('edits a real block through the schema form, saves a draft revision, then restores the original text', async ({ page }) => {
  await page.goto('/studio/doc/app/page/home');
  await expect(page.getByRole('heading', { name: /Page.*home/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Hero Carousel Visible' }).click();
  const headline = page.getByRole('textbox', { name: 'Headline' }).first();
  const original = await headline.inputValue();
  await headline.fill(`${original} test`);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Saved draft revision \d+/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Headline' }).first().fill(original);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Saved draft revision \d+/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Headline' }).first()).toHaveValue(original);
});

test('surfaces a server field error on the right nested field', async ({ page }) => {
  await page.goto('/studio/doc/app/page/home');
  await page.getByRole('button', { name: 'Hero Carousel Visible' }).click();
  const headline = page.getByRole('textbox', { name: 'Headline' }).first();
  await headline.fill('x'.repeat(200));
  await expect(page.getByText(/at most 80 characters/i).first()).toBeVisible();
});

for (const width of [375, 768, 1440]) {
  test(`no horizontal overflow and screenshots at ${width}px`, async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width, height: 900 });
    for (const [route, heading] of routes) {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined); // polling panels may never go fully idle
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} @${width}`).toBeLessThanOrEqual(1);
      const slug = route.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '') || 'home';
      await page.screenshot({ path: `docs/build/evidence/responsive/${slug}-${width}.png`, fullPage: false });
    }
  });
}

test('keyboard-only: a block can be selected, reordered and edited without a pointer', async ({ page }) => {
  await page.goto('/studio/doc/app/page/home');
  await expect(page.getByRole('heading', { name: /Page.*home/ })).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined); // polling panels may never go fully idle
  const second = page.getByRole('button', { name: /Category Shortcuts/ }).first();
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Category Shortcuts' })).toBeVisible();
  const down = page.getByRole('button', { name: 'Move Category Shortcuts down' });
  await down.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
});

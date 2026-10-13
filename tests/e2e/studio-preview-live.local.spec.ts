import { expect, test } from '@playwright/test';

import { signIn } from './live-helpers';

/** Live proof (LOCAL stack): the Studio "Preview" tab renders the real website draft in a frame, and the app tab issues a token. Needs the website on :5174. */
const enabled = process.env.DASHBOARD_RUN_GUARDED_WRITES === '1';
const email = process.env.DASHBOARD_TEST_ADMIN_EMAIL ?? '';
const password = process.env.DASHBOARD_TEST_ADMIN_PASSWORD ?? '';

test.describe('studio preview (local stack)', () => {
  test.skip(!enabled || !email || !password, 'Needs DASHBOARD_RUN_GUARDED_WRITES=1 and disposable local admin credentials.');
  test.setTimeout(400_000);

  test('website preview frames the real draft; app preview shows the device command', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => { if (/frame-src|Refused to frame/i.test(message.text())) violations.push(message.text().slice(0, 160)); });
    await signIn(page, email, password, { enrol: true, landing: '/studio' });

    await page.goto('/studio/doc/web/page/home');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await page.getByRole('tab', { name: 'Preview' }).click();
    await page.getByRole('button', { name: 'Load preview' }).click();
    const frame = page.locator('iframe[title^="Website draft preview"]');
    await expect(frame).toBeVisible({ timeout: 90_000 });
    expect(await frame.getAttribute('src')).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):5174\/\?jw_preview=/);
    // the framed page is the real storefront: it renders text of its own
    const body = page.frameLocator('iframe[title^="Website draft preview"]').locator('body');
    await expect(body).not.toBeEmpty({ timeout: 90_000 });
    expect(violations, 'the CSP must allow framing the storefront').toEqual([]);
    await page.getByRole('button', { name: /Desktop/ }).click();
    await expect(frame).toHaveAttribute('data-device', 'desktop');

    await page.goto('/studio/doc/app/page/home');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await page.getByRole('tab', { name: 'Preview' }).click();
    await page.getByRole('button', { name: 'Create app preview token' }).click();
    const command = page.getByLabel('Command to run the app against the draft');
    try { await expect(command).toContainText('EXPERIENCE_PREVIEW_TOKEN='); } catch (error) {
      console.log('APP PREVIEW MAIN:', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 700));
      throw error;
    }
  });
});

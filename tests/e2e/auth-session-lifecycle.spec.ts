import { expect, test, type Page } from '@playwright/test';

const email = process.env.DASHBOARD_TEST_LIFECYCLE_EMAIL;
const password = process.env.DASHBOARD_TEST_LIFECYCLE_PASSWORD;

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Work email' }).fill(email!);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password!);
  const response = page.waitForResponse(
    (item) => item.url().endsWith('/api/auth/login') && item.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  expect((await response).status()).toBe(200);
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByText('Signed in · support', { exact: true })).toBeVisible();
}

test('revoking another session forces re-authentication; sign out clears the BFF cookie', async ({ page, browser }) => {
  test.skip(!email || !password, 'Run with one disposable local operator account without MFA enrolled.');
  test.setTimeout(60_000);

  const otherContext = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3200' });
  const otherPage = await otherContext.newPage();
  try {
    await signIn(page);
    await signIn(otherPage);
    await otherPage.goto('/account/security');
    await expect(otherPage.getByRole('heading', { name: 'Account security' })).toBeVisible();

    await page.goto('/account/security');
    await expect(page.getByRole('heading', { name: 'Account security' })).toBeVisible();
    await expect(page.getByText('Signed in · support', { exact: true })).toBeVisible();
    await expect(page.locator('.security-session')).toHaveCount(2);
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 900 }, { width: 1440, height: 960 }]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: `docs/build/evidence/phase-03/account-security-${viewport.width}.png`, fullPage: true });
    }
    const otherSession = page.locator('.security-session').filter({ hasText: 'Other signed-in device' });
    await expect(otherSession).toHaveCount(1);
    await otherSession.getByRole('button', { name: 'Revoke' }).click();
    const confirm = page.getByRole('dialog', { name: 'Sign out another device' });
    await confirm.getByRole('textbox').fill('REVOKE SESSION');
    const revokeResponse = page.waitForResponse(
      (response) => /\/api\/auth\/sessions\/[^/]+$/u.test(new URL(response.url()).pathname) && response.request().method() === 'DELETE',
    );
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect((await revokeResponse).status()).toBe(204);
    await expect(page.getByRole('status').filter({ hasText: 'selected session was revoked' })).toBeVisible();

    const revokedSessionCheck = otherPage.waitForResponse(
      (response) => response.url().endsWith('/api/auth/sessions') && response.request().method() === 'GET',
    );
    await otherPage.getByRole('button', { name: 'Refresh list' }).click();
    expect((await revokedSessionCheck).status()).toBe(401);
    await expect(otherPage.getByRole('dialog', { name: 'Your operator session ended' })).toBeVisible();
    await otherPage.getByRole('textbox', { name: 'Work email' }).fill(email!);
    await otherPage.getByRole('textbox', { name: 'Password', exact: true }).fill(password!);
    await otherPage.getByRole('button', { name: 'Sign in and return to this page' }).click();
    await expect(otherPage.getByText('Signed in · support', { exact: true })).toBeVisible();
    await expect(otherPage.getByRole('dialog', { name: 'Your operator session ended' })).toBeHidden();

    for (const signedInPage of [page, otherPage]) {
      await signedInPage.locator('summary[aria-label="Account menu, support"]').click();
      await signedInPage.getByRole('button', { name: 'Sign out' }).click();
      await signedInPage.waitForURL((url) => url.pathname === '/login');
      const cookies = await signedInPage.context().cookies();
      expect(cookies.some((cookie) => cookie.name === 'jw_operator_session')).toBe(false);
    }
  } finally {
    await otherContext.close();
  }
});

import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('public sign-in page uses nonce CSP and exposes no browser token storage', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const response = await page.goto('/login');
  expect(response?.status()).toBe(200);
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("'nonce-");
  expect(csp).not.toContain("'unsafe-inline'");
  await expect(page.getByRole('heading', { name: 'Sign in to continue.' })).toBeVisible();

  const html = await page.content();
  expect(html).not.toMatch(/"(?:accessToken|refreshToken)"\s*:/i);
  const storage = await page.evaluate(() => `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`);
  expect(storage).not.toMatch(/accessToken|refreshToken/i);

  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(accessibility.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
});

test('cross-origin logout is rejected before backend dispatch', async ({ request }) => {
  const response = await request.post('/api/auth/logout', { headers: { Origin: 'https://attacker.example', Cookie: 'jw_csrf=probe', 'x-csrf-token': 'probe' } });
  expect(response.status()).toBe(403);
  expect((await response.json()).error.code).toBe('CSRF_REJECTED');
});

test('invitation entry accepts a code without putting it in the URL', async ({ page }) => {
  await page.goto('/invite');
  await expect(page).toHaveURL(/\/invite$/u);
  await expect(page.getByRole('textbox', { name: 'Invitation code' })).toBeVisible();
});

test('account security deep link requires an operator session', async ({ page }) => {
  await page.goto('/account/security');
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fsecurity/);
  await expect(page.getByRole('heading', { name: 'Sign in to continue.' })).toBeVisible();
});

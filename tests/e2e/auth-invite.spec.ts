import { expect, test } from '@playwright/test';

const invitationToken = process.env.DASHBOARD_TEST_INVITE_TOKEN;
const inviteEmail = process.env.DASHBOARD_TEST_INVITE_EMAIL;
const invitePassword = process.env.DASHBOARD_TEST_INVITE_PASSWORD;
const fullName = 'Dashboard Integration Operator';

test('backend accepts a one-time invitation through the BFF, rejects replay, then allows invitee sign-in', async ({ page }) => {
  test.skip(
    !invitationToken || !inviteEmail || !invitePassword,
    'Run with a one-time local invitation token and disposable invitee credentials.',
  );

  await page.addInitScript(() => {
    const browserWindow = window as Window & { __inviteAcceptCapture?: { status: number; body: string } };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await nativeFetch(input, init);
      if (input === '/api/auth/invite/accept') {
        void response.clone().text().then((body) => { browserWindow.__inviteAcceptCapture = { status: response.status, body }; });
      }
      return response;
    };
  });
  await page.goto('/invite');
  await expect(page.getByRole('heading', { name: 'Set up your account.' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Invitation code' }).fill(invitationToken!);
  await page.getByRole('textbox', { name: 'Full name' }).fill(fullName);
  await page.locator('input[name="password"]').fill(invitePassword!);
  await page.locator('input[name="confirmPassword"]').fill(invitePassword!);
  const acceptResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/invite/accept') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  const accepted = await acceptResponse;
  expect(accepted.status()).toBe(200);
  await expect.poll(() => page.evaluate(() => (window as Window & { __inviteAcceptCapture?: { status: number; body: string } }).__inviteAcceptCapture?.status)).toBe(200);
  const acceptedBody = await page.evaluate(() => {
    const capture = (window as Window & { __inviteAcceptCapture?: { status: number; body: string } }).__inviteAcceptCapture;
    if (!capture) throw new Error('The safe invitation response was not captured.');
    return JSON.parse(capture.body) as Record<string, unknown>;
  });
  expect(acceptedBody).toMatchObject({ email: inviteEmail, role: 'support' });
  expect(acceptedBody).not.toHaveProperty('accessToken');
  expect(acceptedBody).not.toHaveProperty('refreshToken');
  expect(acceptedBody).not.toHaveProperty('token');
  await expect(page.getByRole('heading', { name: 'You’re ready to sign in.' })).toBeVisible();
  await expect(page).toHaveURL(/\/invite$/u);

  const replay = await page.evaluate(async (body) => {
    const response = await fetch('/api/auth/invite/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { error?: { code?: string } };
    return { status: response.status, code: result.error?.code };
  }, { token: invitationToken!, password: invitePassword!, fullName });
  expect(replay).toEqual({ status: 400, code: 'VALIDATION_FAILED' });

  await page.getByRole('link', { name: 'Go to secure sign in' }).click();
  await page.getByRole('textbox', { name: 'Work email' }).fill(inviteEmail!);
  await page.getByLabel('Password').fill(invitePassword!);
  const loginResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  const login = await loginResponse;
  expect(login.status()).toBe(200);
  const loginBody = await login.json() as Record<string, unknown>;
  expect(loginBody).not.toHaveProperty('accessToken');
  expect(loginBody).not.toHaveProperty('refreshToken');
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByText('Signed in · support', { exact: true })).toBeVisible();
});

import { expect, test, type Page } from '@playwright/test';

import { getJson, signIn } from './live-helpers';

/** Live proof (LOCAL stack) of two MFA-gated admin writes: coupon create/deactivate and team invite/revoke. Both are cleaned up. */
const enabled = process.env.DASHBOARD_RUN_GUARDED_WRITES === '1';
const email = process.env.DASHBOARD_TEST_ADMIN_EMAIL ?? '';
const password = process.env.DASHBOARD_TEST_ADMIN_PASSWORD ?? '';
const stamp = Date.now().toString(36).toUpperCase();
const code = `LIVEACC${stamp}`.slice(0, 30);
const inviteEmail = `invite-${stamp.toLowerCase()}@local.jimmywax.test`;

type Coupon = { id: string; code: string; active?: boolean; status?: string };

test.describe('admin writes (local stack)', () => {
  test.skip(!enabled || !email || !password, 'Needs DASHBOARD_RUN_GUARDED_WRITES=1 and disposable local admin credentials.');
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(150_000);

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    page = await (await browser.newContext()).newPage();
    await signIn(page, email, password, { enrol: true, landing: '/coupons' });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('coupon: create a percentage coupon, see it in the list, deactivate it', async () => {
    await page.goto('/coupons');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    await page.getByRole('button', { name: 'New coupon' }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Code').fill(code);
    await drawer.getByLabel('Percent off (%)').fill('5');
    await drawer.getByLabel('Internal description').fill('Live acceptance coupon (auto-removed)');
    await drawer.getByRole('button', { name: 'Create coupon' }).click();
    await expect(page.getByText(code, { exact: true })).toBeVisible({ timeout: 30_000 });

    const list = await getJson<{ items: Coupon[] }>(page, `/api/backend/admin/coupons?q=${code}`);
    const created = list.items.find((item) => item.code === code);
    expect(created, 'the coupon exists in the backend').toBeTruthy();

    const row = page.getByRole('listitem').filter({ hasText: code });
    await row.getByRole('button', { name: 'Deactivate' }).click();
    const confirm = page.getByRole('dialog');
    await confirm.getByRole('textbox').fill(code);
    await confirm.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText(/Coupon deactivated/)).toBeVisible({ timeout: 30_000 });

    const after = await getJson<{ items: Coupon[] }>(page, `/api/backend/admin/coupons?q=${code}`);
    const updated = after.items.find((item) => item.code === code);
    expect(updated?.active === false || updated?.status === 'inactive').toBe(true);
  });

  test('team: invite by email (MFA-gated), see it pending, revoke it', async () => {
    await page.goto('/settings/team');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    await page.getByRole('textbox', { name: 'Work email', exact: true }).fill(inviteEmail);
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText(/Invitation sent/)).toBeVisible({ timeout: 30_000 });
    const pending = page.getByRole('listitem').filter({ hasText: inviteEmail });
    await expect(pending).toBeVisible({ timeout: 30_000 });
    await pending.getByRole('button', { name: /Revoke/ }).click();
    await expect(page.getByText(/Invitation revoked/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('listitem').filter({ hasText: inviteEmail })).toHaveCount(0);
  });
});

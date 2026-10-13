import { expect, test } from '@playwright/test';

import { canRole, roles, type Permission, type Role } from '../../src/lib/auth/permissions';

/** Local-only: every Phase 10–19 route × every role against the real backend. ROLE_PASSWORDS = JSON {role: password}; emails are rm-<role>@local.jimmywax.test. */
const passwords: Partial<Record<Role, string>> = process.env.ROLE_PASSWORDS ? JSON.parse(process.env.ROLE_PASSWORDS) : {};
test.skip(Object.keys(passwords).length === 0, 'Set ROLE_PASSWORDS for disposable local operators.');

const routes: Array<[string, Permission, RegExp]> = [
  ['/studio', 'experience:read', /Mobile app/], ['/studio/releases', 'experience:read', /Releases/], ['/studio/campaigns', 'experience:read', /Campaigns/],
  ['/studio/library/stories', 'experience:read', /Stories/], ['/studio/doc/app/page/home', 'experience:read', /Page/],
  ['/customers', 'customers:read', /Customers/], ['/reviews', 'reviews:moderate', /Review moderation/], ['/coupons', 'coupons:read', /Coupons/],
  ['/messaging', 'settings:read', /Message templates/], ['/analytics', 'analytics:read', /Analytics/], ['/finance', 'analytics:read', /GST/],
  ['/audit', 'audit:read', /Audit log/], ['/ops', 'ops:read', /Operations/], ['/settings', 'settings:read', /Store settings/],
  ['/settings/team', 'team:manage', /Team/], ['/settings/integrations', 'integrations:read', /Integrations/], ['/settings/platform', 'settings:read', /Feature flags/],
];

for (const role of roles.filter((r) => r !== 'admin')) {
  test(`role ${role}: allowed routes render, denied routes redirect to /forbidden, writes are hidden or denied`, async ({ page }) => {
    const password = passwords[role];
    test.skip(!password, `no password for ${role}`);
    await page.goto('/login');
    await page.getByLabel('Work email').fill(`rm-${role}@local.jimmywax.test`);
    await page.getByLabel('Password').fill(password!);
    await page.getByRole('button', { name: 'Sign in securely' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    for (const [route, permission, heading] of routes) {
      await page.goto(route);
      if (canRole(role, permission)) {
        await expect(page.getByRole('heading', { name: heading }).first(), `${role} ${route}`).toBeVisible({ timeout: 20_000 });
      } else {
        await expect(page, `${role} ${route}`).toHaveURL(/\/forbidden/);
      }
    }
    // Backend still enforces the boundary even when the UI is bypassed.
    const denied = await page.evaluate(async () => (await fetch('/api/backend/admin/team', { credentials: 'same-origin' })).status);
    expect([401, 403]).toContain(denied);
    if (!canRole(role, 'coupons:write')) {
      await page.goto('/coupons').catch(() => undefined);
      if (canRole(role, 'coupons:read')) await expect(page.getByRole('button', { name: 'New coupon' })).toBeDisabled();
    }
  });
}

import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('shell has a keyboard skip path and restores command palette focus', async ({ page }) => {
  await page.goto('/dev/components');
  // Next 16's development-only diagnostics are mounted outside the application
  // tree and may become the first Tab stop under concurrent dev-server work.
  // They do not ship to operators, so remove that framework artifact before
  // asserting the first application keyboard target.
  await page.locator('nextjs-portal').evaluateAll((portals) => portals.forEach((portal) => portal.remove()));
  await page.keyboard.press('Tab');
  await expect(page.getByText('Skip to main content')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+K');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden();
});

test('component lab has no serious or critical axe violations', async ({ page }) => {
  await page.goto('/dev/components');
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  const serious = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(serious).toEqual([]);
});

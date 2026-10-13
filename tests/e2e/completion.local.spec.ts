import { mkdirSync, writeFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

/**
 * Local-only acceptance for the completion round: policy documents, schema-backed documents, token overrides, starter layouts,
 * the live Action picker, product gallery + duplicate, and the Studio draft preview on the REAL website.
 * LOCAL_ADMIN_EMAIL / LOCAL_ADMIN_PASSWORD = disposable admin; STOREFRONT_ORIGIN = the Vite storefront.
 */
const email = process.env.LOCAL_ADMIN_EMAIL ?? '';
const password = process.env.LOCAL_ADMIN_PASSWORD ?? '';
test.skip(!email || !password, 'Set LOCAL_ADMIN_EMAIL and LOCAL_ADMIN_PASSWORD for a disposable local operator.');

const storefront = process.env.STOREFRONT_ORIGIN ?? 'http://127.0.0.1:5174';
const authFile = 'test-results/.auth-completion.json';
mkdirSync('test-results', { recursive: true });
writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] }));
test.use({ storageState: authFile });
test.describe.configure({ timeout: 180_000 });

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

const settle = async (page: Page): Promise<void> => { await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined); };

test('policy documents: create a draft, preview safe Markdown, save and publish', async ({ page }) => {
  await page.goto('/settings/policies');
  await expect(page.getByRole('heading', { name: 'Policy documents' })).toBeVisible({ timeout: 20_000 });
  await settle(page);
  const slug = `qa-policy-${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Custom page slug').fill(slug);
  await page.getByRole('button', { name: 'Create custom page' }).click();
  await page.getByLabel('Title', { exact: true }).fill('QA policy page');
  await page.getByLabel('Body (Markdown)').fill('# Heading\n\nSome **bold** text and [a link](https://example.com).\n\n- one\n- two\n\n<script>alert(1)</script>');
  await expect(page.getByText('Raw HTML is not rendered.')).toBeVisible();
  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview.getByRole('link', { name: 'a link' })).toHaveAttribute('href', 'https://example.com/');
  await expect(preview.locator('script')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Draft saved/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('textbox', { name: /Type/ }).fill('publish');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/Published\./)).toBeVisible({ timeout: 20_000 });
});

test('schema-backed documents: palette map, chrome and the token-override editor render with real data', async ({ page }) => {
  await page.goto('/studio/doc/shared/tokens/base');
  await expect(page.getByRole('heading', { name: /Tokens.*base/ })).toBeVisible({ timeout: 20_000 });
  await settle(page);
  await expect(page.getByRole('group', { name: /Palette/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add entry' }).first()).toBeVisible();
  await page.goto('/studio/doc/app/chrome/main');
  await expect(page.getByRole('heading', { name: /Chrome.*main/ })).toBeVisible({ timeout: 20_000 });
  await settle(page);
  await expect(page.getByText('Fields, limits and options come from the backend document schema')).toBeVisible();
  await page.goto('/studio/doc/app/tokens/override');
  await expect(page.getByRole('heading', { name: /Tokens.*override/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Filter values')).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Filter values').fill('accent');
  await expect(page.getByText('Inherits').first()).toBeVisible();
});

test('starter layout on the empty app category page, then clean up', async ({ page }) => {
  await page.goto('/studio/doc/app/page/category');
  await expect(page.getByRole('heading', { name: /Page.*category/ })).toBeVisible({ timeout: 20_000 });
  await settle(page);
  const starter = page.getByRole('button', { name: /Start from: Banner \+ product rail/ });
  if (!(await starter.isVisible())) test.skip(true, 'category page is not empty on this store');
  await starter.click();
  await expect(page.getByRole('button', { name: /Banner Visible/ })).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Saved draft revision \d+/)).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Delete block' }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Saved draft revision \d+/)).toBeVisible({ timeout: 20_000 });
});

test('Action picker searches the live catalogue and warns about unavailable targets', async ({ page }) => {
  await page.goto('/studio/doc/app/page/home');
  await expect(page.getByRole('heading', { name: /Page.*home/ })).toBeVisible({ timeout: 20_000 });
  await settle(page);
  await page.getByRole('button', { name: 'Hero Carousel Visible' }).click();
  await expect(page.getByLabel(/Search product/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByLabel(/Search product/).first().fill('polish');
  await expect(page.getByRole('list', { name: 'Matching products' }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('This product is out of stock.').first()).toBeVisible({ timeout: 15_000 });
});

test('product gallery: attach an approved image with alt text to a QA copy; duplicate reports backend refusals clearly', async ({ page }) => {
  // The backend names a copy's SKU "<sku>-COPY1", so a product can be duplicated only once (DASH-BR-051). Reuse the QA copy if it exists.
  const copy = 'qa-copy-967972';
  await page.goto(`/products/${copy}`);
  const missing = await page.getByText(/not found|does not exist/i).first().isVisible().catch(() => false);
  if (missing) {
    await page.goto('/products/twinkle-shine-leather-polish');
    await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible({ timeout: 20_000 });
    await settle(page);
    await page.getByRole('button', { name: 'Duplicate product' }).click();
    await page.getByLabel('New product id (optional)').fill(copy);
    await page.getByRole('button', { name: 'Create inactive copy' }).click();
    await page.waitForURL(new RegExp(`/products/${copy}$`), { timeout: 30_000 });
  }
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible({ timeout: 20_000 });
  await settle(page);
  // A second duplicate of the same source must fail with a readable field message, not silently.
  await page.goto('/products/twinkle-shine-leather-polish');
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible({ timeout: 20_000 });
  await settle(page);
  await page.getByRole('button', { name: 'Duplicate product' }).click();
  await page.getByLabel('New product id (optional)').fill(`qa-second-${Date.now().toString().slice(-5)}`);
  await page.getByRole('button', { name: 'Create inactive copy' }).click();
  await expect(page.getByText(/already exists/i).first()).toBeVisible({ timeout: 20_000 });
  await page.goto(`/products/${copy}`);
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible({ timeout: 20_000 });
  await settle(page);
  await page.getByRole('button', { name: 'Add image from library' }).click();
  await page.getByRole('dialog', { name: 'Choose approved media' }).locator('ul button').first().click();
  await page.getByLabel('Alt text for image 1').fill('QA gallery image for acceptance testing');
  await page.getByRole('button', { name: 'Save gallery' }).click();
  await expect(page.getByText('Gallery saved.')).toBeVisible({ timeout: 20_000 });
});

test('Studio draft preview on the REAL website shows the draft, while the live site does not', async ({ page, context }) => {
  test.setTimeout(240_000);
  await page.goto('/studio/doc/web/page/home');
  await expect(page.getByRole('heading', { name: /Page.*home/ })).toBeVisible({ timeout: 20_000 });
  await settle(page);
  await page.getByRole('button', { name: 'Hero Film Visible' }).click();
  const headline = page.getByRole('textbox', { name: /^Headline/ }).first();
  const original = await headline.inputValue();
  const marker = `Draft${Date.now().toString().slice(-5)}`;
  await headline.fill(`${original} ${marker}`);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Saved draft revision \d+/)).toBeVisible({ timeout: 20_000 });
  try {
    const popup = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Preview draft on website' }).click();
    const site = await popup;
    await site.waitForLoadState('domcontentloaded');
    await expect(site).toHaveURL(/jw_preview=/);
    await expect(site.locator('h1').first()).toContainText(marker, { timeout: 30_000 });
    const live = await context.newPage();
    await live.goto(storefront, { waitUntil: 'networkidle' });
    await expect(live.locator('h1').first()).not.toContainText(marker);
  } finally {
    await page.getByRole('textbox', { name: /^Headline/ }).first().fill(original);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText(/Saved draft revision \d+/)).toBeVisible({ timeout: 20_000 });
  }
});

test('guarded CSV import: preview exact price change, apply with a reason, verify, then revert the same way', async ({ page }) => {
  test.setTimeout(240_000);
  const productId = 'qa-copy-967972';
  const variantPrice = async (): Promise<number> => {
    const product = await (await page.request.get(`/api/backend/admin/products/${productId}`)).json() as { variants: Array<{ pricePaise: number }> };
    return product.variants[0]!.pricePaise;
  };
  const original = await variantPrice();
  const exported = await (await page.request.get('/api/backend/admin/catalog/export')).text();
  const row = exported.split(/\r?\n/u).find((line) => line.startsWith(`${productId},`));
  test.skip(!row, 'the QA copy product does not exist on this store');
  const changed = original + 200;
  const withPrice = (price: number): string => exported.replace(row!, row!.replace(`,${original},`, `,${price},`));
  const csv = (price: number): { name: string; mimeType: string; buffer: Buffer } => ({ name: 'catalogue.csv', mimeType: 'text/csv', buffer: Buffer.from(withPrice(price), 'utf-8') });
  const importVia = async (price: number, reason: string): Promise<void> => {
    await page.goto('/catalogue');
    await expect(page.getByText('Catalogue CSV tools')).toBeVisible({ timeout: 20_000 });
    await settle(page);
    await page.getByText('Catalogue CSV tools').click();
    await page.getByLabel('Choose catalogue CSV').setInputFiles(csv(price));
    await page.getByRole('button', { name: 'Run dry-run, apply nothing' }).click();
    const list = page.getByRole('list', { name: 'Changes in this import' });
    await expect(list).toBeVisible({ timeout: 30_000 });
    await expect(list.getByText(/price .* → /)).toBeVisible();
    expect(await variantPrice()).not.toBe(price); // nothing applied by the preview
    await page.getByRole('button', { name: /Apply this exact import/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Apply this import' });
    await dialog.getByLabel('Reason for this import').fill(reason);
    await dialog.getByRole('button', { name: 'Apply import' }).click();
    await expect(page.getByText(/Import applied:/)).toBeVisible({ timeout: 30_000 });
    expect(await variantPrice()).toBe(price);
  };
  await importVia(changed, 'Acceptance: guarded import changes one price');
  await importVia(original, 'Acceptance: revert the QA price');
});

test('variant details editor: change package data with a reason; the backend and audit agree', async ({ page }) => {
  await page.goto('/products/qa-copy-967972');
  await expect(page.getByRole('heading', { name: 'Variant details' })).toBeVisible({ timeout: 20_000 });
  await settle(page);
  await page.getByRole('button', { name: 'Edit details' }).first().click();
  const editor = page.getByRole('dialog', { name: /^Edit / });
  const weight = editor.getByLabel('Weight (g)');
  const before = await weight.inputValue();
  const next = String((Number(before) || 100) + 5);
  await weight.fill(next);
  await editor.getByLabel('Reason for this change').fill('Acceptance: package re-weighed');
  await editor.getByRole('button', { name: 'Review changes' }).click();
  const review = page.getByRole('dialog', { name: 'Review variant changes' });
  await expect(review.getByText('Weight')).toBeVisible();
  await review.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Variant details saved and recorded in the audit log.')).toBeVisible({ timeout: 20_000 });
  const product = await (await page.request.get('/api/backend/admin/products/qa-copy-967972')).json() as { variants: Array<{ weightGrams: number | null }> };
  expect(product.variants[0]!.weightGrams).toBe(Number(next));
  const audit = await (await page.request.get('/api/backend/admin/audit?resourceType=variant')).json() as { items: Array<{ action: string; reason: string | null; after: Record<string, unknown> | null }> };
  expect(audit.items.some((item) => item.action === 'variant.update' && item.reason === 'Acceptance: package re-weighed' && item.after?.['weightGrams'] === Number(next))).toBe(true);
  // put the weight back
  await page.getByRole('button', { name: 'Edit details' }).first().click();
  const again = page.getByRole('dialog', { name: /^Edit / });
  await again.getByLabel('Weight (g)').fill(before);
  await again.getByLabel('Reason for this change').fill('Acceptance: restore the QA weight');
  await again.getByRole('button', { name: 'Review changes' }).click();
  await page.getByRole('dialog', { name: 'Review variant changes' }).getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Variant details saved and recorded in the audit log.')).toBeVisible({ timeout: 20_000 });
});

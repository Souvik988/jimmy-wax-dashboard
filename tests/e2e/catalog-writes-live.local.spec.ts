import { expect, test, type Page } from '@playwright/test';

import { getJson, parseCsv, signIn, toCsv } from './live-helpers';

/**
 * Live proof (LOCAL dev stack only) of the guarded CSV commit and the variant details editor.
 * Both run on a disposable inactive `*-copy` product and every change is reverted.
 */
const enabled = process.env.DASHBOARD_RUN_GUARDED_WRITES === '1';
const email = process.env.DASHBOARD_TEST_ADMIN_EMAIL ?? '';
const password = process.env.DASHBOARD_TEST_ADMIN_PASSWORD ?? '';

type Variant = { id: string; sku: string; title: string; pricePaise: number; barcode: string | null };
type Product = { id: string; version: number; variants: Variant[] };

test.describe('catalogue guarded writes (local stack)', () => {
  test.skip(!enabled || !email || !password, 'Needs DASHBOARD_RUN_GUARDED_WRITES=1 and disposable local admin credentials.');
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  let page: Page;
  let productId = '';
  let variant: Variant;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    page = await (await browser.newContext()).newPage();
    await signIn(page, email, password, { enrol: true, landing: '/catalogue' });
    const list = await getJson<{ items: { id: string; active: boolean; archived?: boolean }[] }>(page, '/api/backend/admin/products?q=copy&status=inactive&limit=50');
    const target = list.items.find((item) => item.id.endsWith('-copy') && !item.active && !item.archived);
    expect(target, 'needs a disposable inactive *-copy product').toBeTruthy();
    productId = target!.id;
    variant = (await getJson<Product>(page, `/api/backend/admin/products/${productId}`)).variants[0] as Variant;
  });
  test.afterAll(async () => { await page.context().close(); });

  /** Builds a one-row import file for the target product with the variant price replaced. */
  async function priceCsv(pricePaise: number): Promise<string> {
    const response = await page.request.get('/api/backend/admin/catalog/export');
    const rows = parseCsv(await response.text());
    const header = rows[0] as string[];
    const priceColumn = header.indexOf('price_paise');
    const variantColumn = header.indexOf('variant_id');
    const row = rows.slice(1).find((candidate) => candidate[variantColumn] === variant.id);
    expect(row, 'the target variant must be in the export').toBeTruthy();
    const edited = [...(row as string[])];
    edited[priceColumn] = String(pricePaise);
    return toCsv([header, edited]);
  }

  async function importThroughUi(csv: string, reason: string, expectedChange: RegExp): Promise<void> {
    await page.goto('/catalogue');
    await page.waitForLoadState('networkidle'); // let the page hydrate before touching the panel
    await page.getByText('Catalogue CSV tools').click();
    await page.getByLabel('Choose catalogue CSV').setInputFiles({ name: 'price-check.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') });
    await page.getByRole('button', { name: /Run dry-run/ }).click();
    await expect(page.getByLabel('Dry-run report')).toContainText('Nothing was applied');
    await expect(page.getByLabel('Changes in this import')).toContainText(expectedChange);
    await page.getByRole('button', { name: /Apply this exact import/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Apply import' })).toBeDisabled();
    await dialog.getByLabel(/Reason for this import/).fill(reason);
    await dialog.getByRole('button', { name: 'Apply import' }).click();
    await expect(page.getByText(/Import applied/)).toBeVisible();
  }

  test('CSV: previewed price change is applied with a reason, then reverted', async () => {
    const original = variant.pricePaise;
    const changed = original + 100;
    const before = await getJson<Product>(page, `/api/backend/admin/products/${productId}`);

    await importThroughUi(await priceCsv(changed), 'Live acceptance: CSV price change', /price .*→/);
    const after = await getJson<Product>(page, `/api/backend/admin/products/${productId}`);
    expect(after.variants.find((item) => item.id === variant.id)?.pricePaise).toBe(changed);
    expect(after.version).toBeGreaterThanOrEqual(before.version);

    await importThroughUi(await priceCsv(original), 'Live acceptance: CSV price revert', /price .*→/);
    const reverted = await getJson<Product>(page, `/api/backend/admin/products/${productId}`);
    expect(reverted.variants.find((item) => item.id === variant.id)?.pricePaise).toBe(original);
  });

  test('CSV: a file with a row error cannot be applied', async () => {
    const csv = (await priceCsv(variant.pricePaise)).replace(`"${variant.pricePaise}"`, '"not-a-price"');
    await page.goto('/catalogue');
    await page.waitForLoadState('networkidle'); // let the page hydrate before touching the panel
    await page.getByText('Catalogue CSV tools').click();
    await page.getByLabel('Choose catalogue CSV').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') });
    await page.getByRole('button', { name: /Run dry-run/ }).click();
    await expect(page.getByText('Rows to review')).toBeVisible();
    await expect(page.getByRole('button', { name: /Apply this exact import/ })).toHaveCount(0);
  });

  test('variant details: reviewed edit with reason, then cleared', async () => {
    const barcode = `LIVE${Date.now()}`.slice(0, 20);
    await page.goto(`/products/${productId}`);
    await page.getByRole('button', { name: 'Edit details' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Barcode').fill(barcode);
    await dialog.getByRole('button', { name: 'Review changes' }).click();
    await expect(dialog.getByText(/Reason is required|reason/i).first()).toBeVisible();
    await dialog.getByLabel('Reason for this change').fill('Live acceptance: set barcode');
    await dialog.getByRole('button', { name: 'Review changes' }).click();
    await expect(dialog).toContainText(barcode);
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/Variant details saved/)).toBeVisible();
    expect((await getJson<Product>(page, `/api/backend/admin/products/${productId}`)).variants.find((item) => item.id === variant.id)?.barcode).toBe(barcode);

    await page.getByRole('button', { name: 'Edit details' }).first().click();
    await dialog.getByLabel('Barcode').fill(variant.barcode ?? '');
    await dialog.getByLabel('Reason for this change').fill('Live acceptance: clear barcode');
    await dialog.getByRole('button', { name: 'Review changes' }).click();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/Variant details saved/)).toBeVisible();
    expect((await getJson<Product>(page, `/api/backend/admin/products/${productId}`)).variants.find((item) => item.id === variant.id)?.barcode ?? null).toBe(variant.barcode);
  });
});

import { expect, test, type Page } from '@playwright/test';

import { getJson, rawWrite, signIn } from './live-helpers';

/**
 * Live proof (LOCAL stack) of: custom page keys (custom:slug) opening in the editor, "Return to live version" on a standard page,
 * and the GSTR-1 working paper. All changes are reverted or deleted.
 */
const enabled = process.env.DASHBOARD_RUN_GUARDED_WRITES === '1';
const email = process.env.DASHBOARD_TEST_ADMIN_EMAIL ?? '';
const password = process.env.DASHBOARD_TEST_ADMIN_PASSWORD ?? '';
const customSlug = `live-accept-${Date.now().toString(36)}`;

type Doc = { rev: number; etag: string; body: { title?: string; blocks: unknown[] } };

test.describe('studio + finance (local stack)', () => {
  test.skip(!enabled || !email || !password, 'Needs DASHBOARD_RUN_GUARDED_WRITES=1 and disposable local admin credentials.');
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    page = await (await browser.newContext()).newPage();
    await signIn(page, email, password, { enrol: true, landing: '/finance' });
  });
  test.afterAll(async () => { await page.context().close(); });

  test.beforeAll(async () => {
    // remove drafts left behind by an earlier interrupted run
    const list = await getJson<{ items: { kind: string; key: string }[] }>(page, '/api/backend/admin/experience/web/docs');
    for (const doc of list.items.filter((item) => item.kind === 'page' && item.key.startsWith('custom:live-accept-'))) {
      await rawWrite(page, 'DELETE', `/api/backend/admin/experience/web/docs/page/${doc.key}`);
    }
  });

  test('custom page: created through the workspace form, listed, opened by its colon key, then deleted', async () => {
    await page.goto('/studio?channel=web');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    await page.getByLabel('New custom page address').fill(customSlug);
    await page.getByRole('button', { name: 'Create page' }).click();
    await page.waitForURL((url) => url.pathname === `/studio/doc/web/page/custom:${customSlug}` || url.pathname === `/studio/doc/web/page/custom%3A${customSlug}`);
    await expect(page.getByText('Not created yet')).toBeVisible();

    // create the draft with an empty page (the editor "creates" on first save; use the API for a deterministic empty page)
    const created = await rawWrite(page, 'PUT', `/api/backend/admin/experience/web/docs/page/custom:${customSlug}`, { schemaVersion: 1, blocks: [] }, { 'if-match': '"0"' });
    expect([200, 201]).toContain(created.status());
    await page.goto('/studio?channel=web');
    await expect(page.getByRole('link', { name: new RegExp(`Open.*Custom page · ${customSlug}`) })).toBeVisible();
    await page.getByRole('link', { name: new RegExp(`Open.*Custom page · ${customSlug}`) }).click();
    await expect(page.getByText('Draft revision 1')).toBeVisible();

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete document' }).click();
    await expect(page.getByText('Not created yet')).toBeVisible();
    const gone = await page.request.get(`/api/backend/admin/experience/web/docs/page/custom:${customSlug}`);
    expect(gone.status()).toBe(404);
  });

  test('standard page: "Return to live version" needs a reason, refuses stale revisions, and restores the live draft', async () => {
    const path = '/api/backend/admin/experience/app/docs/page/home';
    const before = await getJson<Doc>(page, path);
    const dirtied = await rawWrite(page, 'PUT', path, { ...before.body, schemaVersion: 1, title: 'Live acceptance draft' }, { 'if-match': before.etag });
    expect(dirtied.status()).toBe(200);
    const dirty = await getJson<Doc>(page, path);
    expect(dirty.body.title).toBe('Live acceptance draft');

    await page.goto('/studio/doc/app/page/home');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    await page.getByRole('button', { name: 'Return to live version' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await dialog.getByLabel(/Reason/).fill('Live acceptance: abandon test draft');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/The draft now matches the live version/)).toBeVisible({ timeout: 30_000 });

    const after = await getJson<Doc>(page, path);
    expect(after.body.title).not.toBe('Live acceptance draft'); // back to what customers see
    expect(after.rev).toBe(dirty.rev + 1);

    // a stale revision is refused and changes nothing
    const stale = await rawWrite(page, 'POST', `${path}/discard-draft`, { reason: 'Live acceptance: stale' }, { 'if-match': `"${dirty.rev}"` });
    expect(stale.status()).toBe(409);
    expect((await getJson<Doc>(page, path)).rev).toBe(after.rev);
  });

  test('GSTR-1 working paper: warnings first, tables, CSV download', async () => {
    await page.goto('/finance');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    await expect(page.getByRole('heading', { name: 'GSTR-1 working paper' })).toBeVisible();
    await expect(page.getByText(/Working paper for your accountant/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Table 7, B2C small supplies' }).or(page.getByText(/No taxable sales in this month/))).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download table 7 CSV/ }).click();
    expect((await download).suggestedFilename()).toMatch(/gstr1-b2cs-\d{4}-\d{2}\.csv$/);
  });
});

import { deflateSync } from 'node:zlib';

import { expect, test, type Page } from '@playwright/test';

import { getJson, rawWrite, signIn } from './live-helpers';

/**
 * Live proof (LOCAL dev stack, disposable admin) of the revision-guarded catalogue and media writes added with backend contract 1.4.0:
 * category create/edit/reorder/delete, collection delete, media upload -> operator preview -> archive -> restore, and the ETag header.
 * Everything it creates is deleted or archived again.
 */
const enabled = process.env.DASHBOARD_RUN_GUARDED_WRITES === '1';
const email = process.env.DASHBOARD_TEST_ADMIN_EMAIL ?? '';
const password = process.env.DASHBOARD_TEST_ADMIN_PASSWORD ?? '';
const backend = (process.env.DASHBOARD_PUBLIC_API_ORIGIN ?? 'http://localhost:8080').replace(/\/$/u, '');

type CategoryRow = { id: string; name: string; rev: number; sortOrder: number; productCount?: number; archivedProductCount?: number };
type MediaRow = { id: string; sha256: string; archived: boolean; updatedAt: string; approval: string };

/** A valid, unique 8x8 PNG, so a re-run never collides with the content-addressed copy of an earlier run. */
function uniquePng(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes: Buffer): number => { let c = 0xffffffff; for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(8, 0); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 2;
  const color = [Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)];
  const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 8 }, () => color).flat())])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const categories = async (page: Page): Promise<CategoryRow[]> => (await getJson<{ items: CategoryRow[] }>(page, '/api/backend/admin/categories')).items;

test.describe('revision-guarded catalogue and media writes (local stack)', () => {
  test.skip(!enabled || !email || !password, 'Needs DASHBOARD_RUN_GUARDED_WRITES=1 and disposable local admin credentials.');
  test.setTimeout(240_000);
  test.describe.configure({ mode: 'serial' });

  let page: Page;
  const suffix = Math.random().toString(36).slice(2, 8);
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    page = await (await browser.newContext()).newPage();
    await signIn(page, email, password, { enrol: true, landing: '/shipping' });
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the BFF forwards the ETag header on documents', async () => {
    const response = await page.request.get('/api/backend/admin/experience/app/docs/page/home');
    expect(response.status()).toBe(200);
    expect(response.headers()['etag']).toBeTruthy();
    const body = await response.json() as { etag?: string };
    if (body.etag) expect(response.headers()['etag']?.replace(/^W\//u, '').replaceAll('"', '')).toBe(body.etag.replace(/^W\//u, '').replaceAll('"', ''));
  });

  test('categories: create, edit with revision, stale refusal, reorder, delete', async () => {
    const name = `QA Guard ${suffix}`;
    const renamed = `QA Guard ${suffix} renamed`;
    await page.goto('/catalogue');
    await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'New category' }).click();
    await page.getByRole('textbox', { name: /Category name/ }).fill(name);
    await page.getByRole('button', { name: 'Review category creation' }).click();
    await page.getByRole('dialog', { name: 'Review new category' }).getByRole('button', { name: 'Create category' }).click();
    await expect(page.getByText(/Category created/)).toBeVisible();
    const created = (await categories(page)).find((row) => row.name === name)!;
    expect(created.rev).toBeGreaterThan(0);

    // Edit through the UI: only the name is sent, with the loaded revision.
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    const edit = page.getByRole('dialog', { name: `Edit ${name}` });
    await edit.getByRole('textbox', { name: /Category name/ }).fill(renamed);
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(`Saved ${renamed}.`)).toBeVisible();
    const edited = (await categories(page)).find((row) => row.id === created.id)!;
    expect(edited.name).toBe(renamed);
    expect(edited.rev).toBeGreaterThan(created.rev);

    // A request that echoes the OLD revision must be refused and change nothing.
    const stale = await rawWrite(page, 'PATCH', `/api/backend/admin/categories/${created.id}`, { name: 'Should not apply', expectedRev: created.rev });
    expect(stale.status()).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('CART_VERSION_CONFLICT');
    expect((await categories(page)).find((row) => row.id === created.id)!.name).toBe(renamed);

    // Reorder through the UI: move the new category up one place, save, then check the server order.
    const before = (await categories(page)).sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.id);
    const index = before.indexOf(created.id);
    if (index > 0) {
      await page.reload();
      await page.getByRole('button', { name: `Move ${renamed} up` }).click();
      await page.getByRole('button', { name: 'Save category order' }).click();
      await expect(page.getByText('Category order saved.')).toBeVisible();
      const after = (await categories(page)).sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.id);
      expect(after.indexOf(created.id)).toBe(index - 1);
    }

    // A category that products still use cannot be deleted, and the refusal names the blockers.
    const used = (await categories(page)).find((row) => (row.productCount ?? 0) + (row.archivedProductCount ?? 0) > 0);
    if (used) {
      const refused = await rawWrite(page, 'DELETE', `/api/backend/admin/categories/${used.id}`);
      expect(refused.status()).toBe(409);
      const payload = await refused.json() as { error: { code: string; lines?: Array<{ type: string; label: string }> } };
      expect(payload.error.code).toBe('ILLEGAL_STATE');
      expect(payload.error.lines?.[0]?.type).toBe('product');
    }

    // Delete the disposable category through the UI.
    await page.reload();
    await page.getByRole('button', { name: `Delete ${renamed}` }).click();
    await page.getByLabel(/Type DELETE CATEGORY to continue/).fill('DELETE CATEGORY');
    await page.getByRole('dialog', { name: `Delete ${renamed}` }).getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText(`Deleted ${renamed}.`)).toBeVisible();
    expect((await categories(page)).some((row) => row.id === created.id)).toBe(false);
  });

  test('collections: create, stale delete refused, delete with revision and reason', async () => {
    const name = `QA Collection ${suffix}`;
    await page.goto('/catalogue');
    await page.getByRole('tab', { name: 'Collections' }).click();
    await page.getByRole('button', { name: 'New collection' }).click();
    await page.getByRole('textbox', { name: /Collection name/ }).fill(name);
    await page.getByRole('button', { name: 'Review collection creation' }).click();
    await page.getByRole('dialog', { name: 'Review collection changes' }).getByRole('button', { name: 'Create collection' }).click();
    await expect(page.getByText(/Collection created/)).toBeVisible();
    const list = await getJson<{ items: Array<{ id: string; name: string; rev: number }> }>(page, '/api/backend/admin/collections');
    const created = list.items.find((row) => row.name === name)!;

    const stale = await rawWrite(page, 'DELETE', `/api/backend/admin/collections/${created.id}`, { expectedRev: created.rev + 5, reason: 'Live acceptance: stale revision' });
    expect(stale.status()).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('CART_VERSION_CONFLICT');
    const missingReason = await rawWrite(page, 'DELETE', `/api/backend/admin/collections/${created.id}`, { expectedRev: created.rev });
    expect(missingReason.status()).toBe(400);

    await page.getByRole('button', { name: `Delete ${name}` }).click();
    const dialog = page.getByRole('dialog', { name: `Delete ${name}` });
    await dialog.getByLabel('Reason').fill('Live acceptance: remove the disposable collection');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(`Deleted ${name}.`)).toBeVisible();
    const after = await getJson<{ items: Array<{ id: string }> }>(page, '/api/backend/admin/collections');
    expect(after.items.some((row) => row.id === created.id)).toBe(false);
  });

  test('media: upload stays private, operator preview works, archive and restore with reason', async () => {
    const filename = `qa-guard-${suffix}.png`;
    await page.goto('/media');
    await expect(page.getByRole('heading', { name: 'Media library' })).toBeVisible();
    await page.getByRole('button', { name: 'Upload assets' }).click();
    const upload = page.getByRole('dialog', { name: 'Upload assets' });
    await upload.locator('input[type=file]').setInputFiles({ name: filename, mimeType: 'image/png', buffer: uniquePng() });
    await upload.getByLabel(`Alternative text for ${filename}`).fill('A small colour swatch used by the live acceptance test');
    await upload.getByLabel(/Rights holder/).fill('Jimmy & Wax test fixtures');
    await upload.getByLabel(/Source \/ consent evidence/).fill('Generated by the automated acceptance test; contains no people or products.');
    await upload.getByLabel('I confirm the owner has authorized these files for public use once approved.').check();
    await upload.getByRole('button', { name: 'Upload queued files' }).click();
    await expect(upload.getByText('Uploaded as a pending asset.')).toBeVisible({ timeout: 60_000 });
    await upload.locator('footer').getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: `Review ${filename}` }).click();
    const drawer = page.getByRole('dialog', { name: filename });
    await expect(drawer.getByText('Not public: only operators can preview this asset.')).toBeVisible();
    // Structured rights fields reached the backend (they travelled in the header, not the URL).
    await expect(drawer.getByText('Rights holder: Jimmy & Wax test fixtures', { exact: true })).toBeVisible();
    // Draft bytes are previewable by the operator through the authenticated route...
    const preview = drawer.locator('img').first();
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

    const found = await getJson<{ items: MediaRow[] }>(page, `/api/backend/admin/media?q=${encodeURIComponent(filename)}`);
    const media = found.items.find((row) => row.approval === 'draft')!;
    expect(media.archived).toBe(false);
    // ...while the same bytes are NOT served publicly until an Admin approves them. The local dev stack runs the backend's
    // MEDIA_PUBLIC_ALLOW_UNAPPROVED bridge (refused in production), so this only holds when DASHBOARD_EXPECT_PRIVATE_DRAFTS=1.
    if (process.env.DASHBOARD_EXPECT_PRIVATE_DRAFTS === '1') {
      const publicCopy = await page.request.get(`${backend}/v1/media/${media.sha256}/orig.webp`);
      expect(publicCopy.status()).toBe(404);
    }
    // And the operator preview route refuses anonymous requests.
    const anonymous = await (await page.context().browser()!.newContext()).request.get(`${new URL(page.url()).origin}/api/media/${media.sha256}/orig.webp`);
    expect(anonymous.status()).toBe(401);

    // A stale version stamp is refused.
    const stale = await rawWrite(page, 'POST', `/api/backend/admin/media/${media.id}/archive`, { expectedUpdatedAt: '2020-01-01T00:00:00.000Z', reason: 'Live acceptance: stale stamp' });
    expect(stale.status()).toBe(409);

    // Archive through the UI.
    await drawer.getByRole('button', { name: 'Archive asset' }).click();
    const reason = page.getByRole('dialog', { name: 'Archive this media asset' });
    await reason.getByLabel('Reason').fill('Live acceptance: retire the disposable swatch');
    await reason.getByRole('button', { name: 'Continue' }).click();
    await expect(drawer.getByText('Asset archived. It is no longer served publicly.')).toBeVisible();
    expect((await getJson<MediaRow>(page, `/api/backend/admin/media/${media.id}`)).archived).toBe(true);

    // Restore through the UI.
    await drawer.getByRole('button', { name: 'Restore asset' }).click();
    const restore = page.getByRole('dialog', { name: 'Restore this media asset' });
    await restore.getByLabel('Reason').fill('Live acceptance: restore, then archive again below');
    await restore.getByRole('button', { name: 'Continue' }).click();
    await expect(drawer.getByText('Asset restored.')).toBeVisible();
    expect((await getJson<MediaRow>(page, `/api/backend/admin/media/${media.id}`)).archived).toBe(false);

    // Leave the library clean: archive the fixture again.
    const current = await getJson<MediaRow>(page, `/api/backend/admin/media/${media.id}`);
    const cleanup = await rawWrite(page, 'POST', `/api/backend/admin/media/${media.id}/archive`, { expectedUpdatedAt: current.updatedAt, reason: 'Live acceptance: leave the library clean' });
    expect(cleanup.status()).toBe(200);
  });

  test('the in-use filter is answered by the server', async () => {
    const unused = await getJson<{ items: MediaRow[] }>(page, '/api/backend/admin/media?inUse=false&limit=5');
    expect(Array.isArray(unused.items)).toBe(true);
    await page.goto('/media');
    await page.getByRole('combobox', { name: 'Filter media by usage' }).selectOption('used');
    await expect(page.getByRole('heading', { name: 'Media library' })).toBeVisible();
  });
});

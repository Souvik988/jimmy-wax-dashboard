import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

const phase08Email = process.env.DASHBOARD_PHASE08_EMAIL;
const phase08Password = process.env.DASHBOARD_PHASE08_PASSWORD;
const phase09Email = process.env.DASHBOARD_PHASE09_EMAIL;
const phase09Password = process.env.DASHBOARD_PHASE09_PASSWORD;
const publicOrigin = (process.env.DASHBOARD_PUBLIC_API_ORIGIN ?? 'http://localhost:8080').replace(/\/$/u, '');
const storefrontOrigin = (process.env.DASHBOARD_STOREFRONT_ORIGIN ?? '').replace(/\/$/u, '');
const imagePath = process.env.DASHBOARD_PHASE09_IMAGE_PATH ?? 'C:/Users/MSI/OneDrive/Desktop/jimmy_nd _wax_website/media-src/products/twinkle-shine-catalog-v2.png';
const videoPath = process.env.DASHBOARD_PHASE09_VIDEO_PATH ?? 'C:/Users/MSI/OneDrive/Desktop/jimmy_nd _wax_website/public/media/generated/video/commerce/twinkle-shine-bottle-motion-v2.mp4';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

type ProductResponse = {
  id: string;
  active: boolean;
  archived: boolean;
  version: number;
  variants: Array<{ id: string; sku: string; active: boolean; onHand: number; reserved: number }>;
};

type AuditItem = { action: string; resourceType: string; resourceId: string; reason: string | null; before: unknown; after: unknown };
type MediaResponse = { id: string; approval: 'draft' | 'approved' | 'rejected'; urls: { original: string } };

function currentTotp(secret: string): string {
  let accumulator = 0;
  let bitCount = 0;
  const decoded: number[] = [];
  for (const character of secret.toUpperCase().replace(/=+$/u, '').replace(/\s/gu, '')) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('The local MFA setup key was invalid.');
    accumulator = (accumulator << 5) | index;
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      decoded.push((accumulator >> bitCount) & 0xff);
      accumulator &= (1 << bitCount) - 1;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(decoded)).update(counter).digest();
  const offset = (digest[19] ?? 0) & 0x0f;
  const binary = (((digest[offset] ?? 0) & 0x7f) << 24) | (((digest[offset + 1] ?? 0) & 0xff) << 16) | (((digest[offset + 2] ?? 0) & 0xff) << 8) | ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function enroll(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Begin secure setup' }).click();
  await page.getByRole('button', { name: 'Reveal key' }).click();
  const secret = await page.locator('.mfa-secret code').textContent();
  if (!secret) throw new Error('The fresh local test operator did not expose a TOTP setup key.');
  await page.getByRole('textbox', { name: 'Authenticator code' }).fill(await freshCode(secret));
  await page.getByRole('button', { name: 'Verify and finish setup' }).click();
  await expect(page.locator('.recovery-code-list li').first()).toBeVisible();
  await page.getByLabel('I stored these codes somewhere private.').check();
  await page.getByRole('button', { name: 'I saved them — continue' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  return secret;
}

async function signInFresh(page: Page, email: string, password: string): Promise<string> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Work email' }).fill(email);
  await page.getByLabel('Password').fill(password);
  const login = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  expect((await login).status()).toBe(200);
  await page.waitForURL((url) => ['/', '/login/enroll', '/login/mfa'].includes(url.pathname));
  if (page.url().includes('/login/mfa')) throw new Error('This local acceptance account already has MFA. Provision a fresh timestamped account for this run.');
  if (!page.url().includes('/login/enroll')) {
    const session = await page.request.get('/api/auth/session');
    expect(session.status()).toBe(200);
    const current = await session.json() as { user?: { mfa?: boolean } | null };
    if (current.user?.mfa) throw new Error('This local acceptance account unexpectedly has an MFA enrollment. Provision a fresh timestamped account for this run.');
    await page.goto('/login/enroll?next=%2F');
    await expect(page.getByRole('heading', { name: 'Set up your authenticator.' })).toBeVisible();
  }
  return enroll(page);
}

async function csrf(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const token = cookies.find((cookie) => cookie.name === 'jw_csrf')?.value;
  if (!token) throw new Error('The local BFF did not issue a CSRF cookie for the signed-in test operator.');
  return token;
}

/** Archive / restore through the real UI control: version-guarded, with a reason (and step-up when the backend asks for it). */
async function lifecycleViaUi(page: Page, productId: string, action: 'Archive product' | 'Restore product', reason: string, secret: string): Promise<void> {
  await page.goto(`/products/${productId}`);
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.getByRole('button', { name: action }).click();
  const dialog = page.getByRole('dialog', { name: action === 'Archive product' ? 'Archive this product' : 'Restore this product' });
  await dialog.getByRole('textbox', { name: 'Reason' }).fill(reason);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  const done = page.getByText(action === 'Archive product' ? /Product archived/ : /Product restored/);
  const stepUp = page.getByRole('dialog', { name: 'Verify this action' });
  const outcome = await Promise.race([
    done.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'done' as const),
    stepUp.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'stepup' as const),
  ]);
  if (outcome === 'stepup') {
    await stepUp.getByRole('textbox', { name: 'Authenticator code' }).fill(await freshCode(secret));
    await stepUp.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(done).toBeVisible({ timeout: 20_000 });
}

let lastUsedCode = '';
async function freshCode(secret: string): Promise<string> {
  let code = currentTotp(secret);
  if (code === lastUsedCode) { await new Promise((resolve) => setTimeout(resolve, 31_000)); code = currentTotp(secret); }
  lastUsedCode = code;
  return code;
}

async function apiPost<T>(page: Page, path: string, body: unknown = {}, secret?: string): Promise<{ status: number; body: T }> {
  const send = async () => page.request.post(path, { data: body, headers: { 'x-csrf-token': await csrf(page), origin: new URL(page.url()).origin } });
  let response = await send();
  if (response.status() === 403 && secret) {
    const payload = await response.json() as { error?: { code?: string } };
    if (payload.error?.code === 'MFA_REQUIRED') {
      const verify = await page.request.post('/api/auth/mfa/verify', { data: { code: await freshCode(secret) }, headers: { 'x-csrf-token': await csrf(page), origin: new URL(page.url()).origin } });
      expect(verify.status()).toBe(200);
      response = await send();
    }
  }
  return { status: response.status(), body: await response.json() as T };
}


async function confirmApproval(page: Page, drawer: import('@playwright/test').Locator, secret: string): Promise<void> {
  const saved = drawer.getByText('Approval saved.', { exact: false });
  const stepUp = page.getByRole('dialog', { name: 'Verify this action' });
  const outcome = await Promise.race([
    saved.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'saved' as const),
    stepUp.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'stepup' as const),
  ]).catch(async (error) => { console.log('APPROVAL-DEBUG', (await page.locator('dialog[open]').allInnerTexts()).join(' || ').replace(/\s+/gu, ' ').slice(0, 1500)); throw error; });
  if (outcome === 'stepup') {
    await stepUp.getByRole('textbox', { name: 'Authenticator code' }).fill(await freshCode(secret));
    await stepUp.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(saved).toBeVisible({ timeout: 20_000 });
}

async function reviewAndApprove(page: Page, filename: string, secret: string): Promise<void> {
  await page.getByLabel('Search media').fill(filename);
  await expect(page.getByRole('button', { name: `Review ${filename}` })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: `Review ${filename}` }).click();
  const drawer = page.getByRole('dialog', { name: filename });
  // Assets are content-addressed: bytes approved by an earlier acceptance run are not approved a second time.
  if (!(await drawer.getByRole('button', { name: 'Approve for use' }).isEnabled()) && await drawer.getByText(/approved/i).first().isVisible()) {
    await drawer.getByRole('button', { name: 'Close' }).last().click();
    return;
  }
  await expect(drawer.getByRole('button', { name: 'Approve for use' })).toBeEnabled();
  await drawer.getByRole('button', { name: 'Approve for use' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Approve media for customer-facing use' });
  await confirmation.locator('input').fill('APPROVE ASSET');
  await confirmation.getByRole('button', { name: 'Confirm' }).click();
  await confirmApproval(page, drawer, secret);
  await drawer.getByRole('button', { name: 'Close' }).click();
}

async function uploadViaUi(page: Page, filePath: string, alt: string, folder: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Upload assets' }).click();
  const dialog = page.locator('dialog[open]').filter({ has: page.getByRole('heading', { name: 'Upload assets' }) });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"][aria-label="Choose media files"]').setInputFiles(filePath);
  await expect(dialog.getByRole('status').filter({ hasText: 'Signature verified' })).toBeVisible({ timeout: 15_000 });
  const filename = filePath.split(/[\\/]/u).at(-1);
  if (!filename) throw new Error('Test fixture path did not have a filename.');
  await dialog.getByLabel(`Alternative text for ${filename}`).fill(alt);
  await dialog.getByLabel('Folder').fill(folder);
  await dialog.getByLabel('Rights holder').fill('Jimmy & Wax local QA fixture');
  await dialog.getByLabel('Source / consent evidence').fill('Local non-PII project asset used only for development acceptance testing; immediate public retrieval is intentional.');
  await dialog.getByLabel('I confirm the owner has authorized these files for public use once approved.').check();
  await dialog.getByRole('button', { name: 'Upload queued files' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: /Uploaded as a pending asset|Same bytes already exist/u })).toBeVisible({ timeout: 120_000 });
  await dialog.getByRole('button', { name: 'Close' }).last().click();
}

test('real local Phase 08 flow creates, stocks, publishes, audits, restores, then archives a two-variant fixture', async ({ page, browser }) => {
  test.skip(!phase08Email || !phase08Password || !storefrontOrigin, 'Supply a fresh local Phase 08 operator plus DASHBOARD_STOREFRONT_ORIGIN.');
  test.setTimeout(180_000);
  const run = `phase08-${Date.now()}`;
  const productId = `${run}-leather-care`;
  const skuOne = `QA-${Date.now()}-A`;
  const skuTwo = `QA-${Date.now()}-B`;
  const name = `QA local leather care ${run}`;
  const stockReason = `Local Phase 08 receipt ${run}`;
  const variantReason = `Local Phase 08 activate stocked variant ${run}`;
  const totp = await signInFresh(page, phase08Email!, phase08Password!);

  await page.goto('/products/new');
  await expect(page.getByRole('heading', { name: 'Create product' })).toBeVisible();
  const category = page.getByLabel('Category');
  await expect(category.locator('option').nth(1)).toBeEnabled();
  await category.selectOption({ index: 1 });
  await page.getByLabel('Product ID').fill(productId);
  await page.getByLabel('Product name').fill(name);
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('A clearly labelled local development fixture for catalogue acceptance evidence.');
  await page.getByLabel('Key benefits · one per line').fill('Non-production QA fixture\nGST-inclusive review proof');
  await page.getByLabel('Variant 1 ID').fill(`${run}-100`);
  await page.getByLabel('Variant 1 SKU').fill(skuOne);
  await page.getByLabel('Variant 1 title').fill('100 ml test size');
  await page.getByLabel('Variant 1 selling price (₹)').fill('499.50');
  await page.getByLabel('Variant 2 ID').fill(`${run}-250`);
  await page.getByLabel('Variant 2 SKU').fill(skuTwo);
  await page.getByLabel('Variant 2 title').fill('250 ml test size');
  await page.getByLabel('Variant 2 selling price (₹)').fill('899.00');
  await page.getByRole('button', { name: 'Review new product' }).click();
  const review = page.getByRole('dialog', { name: 'Review new product' });
  await expect(review.getByText('Inactive · not available for purchase', { exact: false })).toHaveCount(1);
  await expect(review.getByRole('listitem').getByText('Inactive', { exact: true })).toHaveCount(2);
  await expect(review.getByText('Stock · starts at 0; added separately in Inventory', { exact: false })).toHaveCount(2);
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    await page.screenshot({ path: `docs/build/evidence/phase-08-product-review-${width}.png`, fullPage: true });
  }
  const create = page.waitForResponse((response) => response.url().endsWith('/api/backend/admin/products') && response.request().method() === 'POST');
  await review.getByRole('button', { name: 'Create inactive product' }).click();
  expect((await create).status()).toBe(201);
  await page.waitForURL((url) => url.pathname === `/products/${productId}`);
  const initial = await page.request.get(`/api/backend/admin/products/${productId}`);
  expect(initial.status()).toBe(200);
  const initialProduct = await initial.json() as ProductResponse;
  expect(initialProduct).toMatchObject({ id: productId, active: false, archived: false });
  expect(initialProduct.variants).toHaveLength(2);
  expect(initialProduct.variants.every((variant) => !variant.active && variant.onHand === 0 && variant.reserved === 0)).toBe(true);

  await page.goto('/inventory');
  await page.getByLabel('Search inventory').fill(skuOne);
  const adjustButton = page.getByRole('button', { name: `Adjust stock for ${name} · 100 ml test size` });
  await expect(adjustButton).toBeVisible();
  await adjustButton.click();
  const adjustment = page.getByRole('dialog', { name: /Review stock adjustment/u });
  await adjustment.getByLabel('Signed change in on-hand units').fill('7');
  await adjustment.getByLabel('Reason · required').fill(stockReason);
  await expect(adjustment.getByText('Projected on-hand', { exact: true })).toBeVisible();
  await adjustment.getByRole('button', { name: 'Apply adjustment' }).click();
  const stepUp = page.getByRole('dialog', { name: 'Verify this action' });
  const adjusted = adjustment.getByText('Adjustment recorded', { exact: true });
  const outcome = await Promise.race([
    adjusted.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'adjusted' as const),
    stepUp.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'stepup' as const),
  ]);
  if (outcome === 'stepup') {
    await stepUp.getByRole('textbox', { name: 'Authenticator code' }).fill(await freshCode(totp));
    await stepUp.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(adjusted).toBeVisible({ timeout: 20_000 });

  await page.goto(`/products/${productId}`);
  await page.getByRole('switch', { name: 'Visible on the storefront' }).check();
  await page.getByRole('button', { name: 'Review product changes' }).click();
  const productReview = page.getByRole('dialog', { name: 'Review product changes' });
  await expect(productReview.getByText('active', { exact: false }).first()).toBeVisible();
  const activation = page.waitForResponse((response) => response.url().endsWith(`/api/backend/admin/products/${productId}`) && response.request().method() === 'PATCH');
  await productReview.getByRole('button', { name: 'Save reviewed changes' }).click();
  expect((await activation).status()).toBe(200);

  await page.getByRole('button', { name: 'Edit price for 100 ml test size' }).click();
  const variantDialog = page.getByRole('dialog', { name: /Edit 100 ml test size price/u });
  await variantDialog.getByRole('switch', { name: 'Variant available for purchase' }).check();
  await variantDialog.getByLabel('Reason for price change').fill(variantReason);
  await variantDialog.getByRole('button', { name: 'Review price change' }).click();
  const variantReview = page.getByRole('dialog', { name: 'Review variant price change' });
  const variantActivation = page.waitForResponse((response) => response.url().includes(`/api/backend/admin/catalog/variants/${run}-100`) && response.request().method() === 'PATCH');
  await variantReview.getByRole('button', { name: 'Save reviewed price change' }).click();
  expect((await variantActivation).status()).toBe(200);

  const publicProducts = await page.request.get(`${publicOrigin}/v1/products?limit=50`);
  expect(publicProducts.status()).toBe(200);
  const publicPayload = await publicProducts.json() as { items: Array<{ id: string; variant: { available: boolean; availableQuantity: number } }> };
  expect(publicPayload.items.find((product) => product.id === productId)?.variant).toMatchObject({ available: true, availableQuantity: 7 });
  const storefront = await browser.newPage();
  try {
    await storefront.goto(`${storefrontOrigin}/shop`, { waitUntil: 'networkidle' });
    await expect(storefront.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await storefront.close();
  }

  const audit = await page.request.get('/api/backend/admin/audit?resourceType=product');
  expect(audit.status()).toBe(200);
  const productAudit = await audit.json() as { items: AuditItem[] };
  expect(productAudit.items.some((item) => item.action === 'product.create' && item.resourceId === productId && item.after !== null)).toBe(true);
  expect(productAudit.items.some((item) => item.action === 'product.update' && item.resourceId === productId && item.before !== null && item.after !== null)).toBe(true);
  const variantAudit = await page.request.get('/api/backend/admin/audit?resourceType=variant');
  expect(variantAudit.status()).toBe(200);
  const variantAuditItems = (await variantAudit.json() as { items: AuditItem[] }).items;
  expect(variantAuditItems.some((item) => item.action === 'inventory.adjust' && item.resourceId === `${run}-100` && item.reason === stockReason && item.before !== null && item.after !== null)).toBe(true);
  expect(variantAuditItems.some((item) => item.action === 'variant.update' && item.resourceId === `${run}-100` && item.reason === variantReason && item.before !== null && item.after !== null)).toBe(true);

  await lifecycleViaUi(page, productId, 'Archive product', 'Phase 08 acceptance: archive the QA fixture', totp);
  const archivedProduct = await page.request.get(`/api/backend/admin/products/${productId}`);
  expect(await archivedProduct.json()).toMatchObject({ archived: true, active: false });
  // The public catalogue read model is cached for a few seconds; poll instead of asserting instantly.
  await expect.poll(async () => {
    const list = await page.request.get(`${publicOrigin}/v1/products?limit=50`);
    return (await list.json() as { items: Array<{ id: string }> }).items.some((product) => product.id === productId);
  }, { timeout: 60_000, intervals: [2_000] }).toBe(false);
  await lifecycleViaUi(page, productId, 'Restore product', 'Phase 08 acceptance: restore to verify the round trip', totp);
  expect(await (await page.request.get(`/api/backend/admin/products/${productId}`)).json()).toMatchObject({ archived: false, active: false });
  await lifecycleViaUi(page, productId, 'Archive product', 'Phase 08 acceptance: final cleanup of the QA fixture', totp);
  const archiveAudit = await page.request.get('/api/backend/admin/audit?resourceType=product');
  const archiveRows = (await archiveAudit.json() as { items: Array<AuditItem & { reason: string | null }> }).items.filter((item) => item.resourceId === productId && /^product\.(archive|restore)$/u.test(item.action));
  expect(archiveRows).toHaveLength(3);
  // guarded lifecycle: every row has a reason and before/after states
  expect(archiveRows.every((item) => Boolean(item.reason) && item.before !== null && item.after !== null)).toBe(true);
});

test('real local Phase 09 flow uploads, reviews and publicly serves a project image and video fixture', async ({ page }) => {
  test.skip(!phase09Email || !phase09Password, 'Supply a fresh local Phase 09 administrator account.');
  test.setTimeout(240_000);
  await Promise.all([readFile(imagePath), readFile(videoPath)]);
  const secret09 = await signInFresh(page, phase09Email!, phase09Password!);
  await page.goto('/media');
  await expect(page.getByRole('heading', { name: 'Media library' })).toBeVisible();

  await uploadViaUi(page, imagePath, 'Local QA product image for dashboard acceptance testing', 'local-qa-phase09');
  const imageFilename = imagePath.split(/[\\/]/u).at(-1)!;
  await reviewAndApprove(page, imageFilename, secret09);
  const imageSearch = await page.request.get(`/api/backend/admin/media?q=${encodeURIComponent(imageFilename)}`);
  expect(imageSearch.status()).toBe(200);
  const image = (await imageSearch.json() as { items: MediaResponse[] }).items.find((item) => item.approval === 'approved');
  if (!image) throw new Error('The approved image was not returned by the authoritative media list.');

  await uploadViaUi(page, videoPath, 'Local QA product motion video for dashboard acceptance testing', 'local-qa-phase09');
  const videoFilename = videoPath.split(/[\\/]/u).at(-1)!;
  await page.getByLabel('Search media').fill(videoFilename);
  await expect(page.getByRole('button', { name: `Review ${videoFilename}` })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: `Review ${videoFilename}` }).click();
  const videoDrawer = page.getByRole('dialog', { name: videoFilename });
  await videoDrawer.getByLabel('Poster media ID').fill(image.id);
  // Same bytes from an earlier acceptance run already carry this poster: the form is then clean and Save is disabled.
  if (await videoDrawer.getByRole('button', { name: 'Save metadata' }).isEnabled()) {
    await videoDrawer.getByRole('button', { name: 'Save metadata' }).click();
    await expect(videoDrawer.getByText('Metadata saved from the backend.', { exact: true })).toBeVisible();
  }
  if (await videoDrawer.getByRole('button', { name: 'Approve for use' }).isEnabled()) {
    await videoDrawer.getByRole('button', { name: 'Approve for use' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Approve media for customer-facing use' });
    await confirmation.locator('input').fill('APPROVE ASSET');
    await confirmation.getByRole('button', { name: 'Confirm' }).click();
    await confirmApproval(page, videoDrawer, secret09);
  } else {
    await expect(videoDrawer.getByText(/approved/i).first()).toBeVisible();
  }
  await videoDrawer.getByRole('button', { name: 'Close' }).click();
  const videoSearch = await page.request.get(`/api/backend/admin/media?q=${encodeURIComponent(videoFilename)}`);
  const video = (await videoSearch.json() as { items: MediaResponse[] }).items.find((item) => item.approval === 'approved');
  if (!video) throw new Error('The approved video was not returned by the authoritative media list.');

  const imagePublic = await page.request.get(`${publicOrigin}${image.urls.original}`);
  expect(imagePublic.status()).toBe(200);
  expect(imagePublic.headers()['cache-control']).toContain('immutable');
  const videoRange = await page.request.get(`${publicOrigin}${video.urls.original}`, { headers: { range: 'bytes=0-127' } });
  expect(videoRange.status()).toBe(206);
  expect(videoRange.headers()['cache-control']).toContain('immutable');
  expect(videoRange.headers()['content-range']).toMatch(/^bytes 0-127\//u);

  const audit = await page.request.get('/api/backend/admin/audit?resourceType=media');
  expect(audit.status()).toBe(200);
  const rows = (await audit.json() as { items: AuditItem[] }).items;
  expect(rows.some((item) => item.action === 'media.upload' && item.resourceId === image.id)).toBe(true);
  expect(rows.some((item) => item.action === 'media.approve' && item.resourceId === image.id)).toBe(true);
  expect(rows.some((item) => item.action === 'media.upload' && item.resourceId === video.id)).toBe(true);
  expect(rows.some((item) => item.action === 'media.approve' && item.resourceId === video.id)).toBe(true);
});

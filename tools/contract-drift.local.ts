/**
 * Live contract-drift probe (LOCAL backend only). Calls every read-only dashboard resource function against the running backend and lets the
 * dashboard's own strict Zod parsers judge the response, so a backend field the dashboard does not know shows up here instead of as a
 * CONTRACT_DRIFT error in front of an operator.
 *   DRIFT_EMAIL=... DRIFT_PASSWORD=... pnpm exec tsx tools/contract-drift.local.ts
 * Nothing is written to the backend: every call is a GET.
 */
const base = process.env['BACKEND'] ?? 'http://localhost:8080';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/u.test(base)) throw new Error('local only');
const email = process.env['DRIFT_EMAIL'] ?? '';
const password = process.env['DRIFT_PASSWORD'] ?? '';
if (!email || !password) throw new Error('Set DRIFT_EMAIL and DRIFT_PASSWORD (a disposable local operator).');

type Failure = { name: string; message: string };

async function main(): Promise<void> {
  const login = await (await fetch(`${base}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, client: 'admin' }) })).json() as { accessToken?: string };
  if (!login.accessToken) throw new Error('login failed');
  const token = login.accessToken;

  // The resource modules call authFetch('/api/backend/...') in the browser; route those calls straight to the backend here.
  (globalThis as { document?: unknown }).document = { cookie: '' };
  const windowShim = new EventTarget();
  // An MFA-gated read would wait forever for a person to enter a code; cancel the step-up so it is reported as a skip.
  windowShim.addEventListener('jw:mfa-required', () => setTimeout(() => windowShim.dispatchEvent(new Event('jw:mfa-cancelled')), 0));
  (globalThis as { window?: unknown }).window = windowShim;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('/api/backend/')) return realFetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${token}`);
    for (let attempt = 0; ; attempt += 1) {
      const response = await realFetch(`${base}/v1/${url.slice('/api/backend/'.length)}`, { ...init, headers });
      if (response.status !== 429 || attempt >= 8) return response;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }) as typeof fetch;

  const catalog = await import('../src/lib/api/resources/catalog');
  const media = await import('../src/lib/api/resources/media');
  const orders = await import('../src/lib/api/resources/orders');
  const shipping = await import('../src/lib/api/resources/shipping');
  const studio = await import('../src/lib/api/resources/studio');
  const ops = await import('../src/lib/api/resources/admin-ops');
  const overview = await import('../src/lib/api/resources/overview');

  const failures: Failure[] = [];
  let passed = 0;
  async function probe<T>(name: string, run: () => Promise<T>): Promise<T | undefined> {
    try {
      const value = await run();
      passed += 1;
      console.log(`ok    ${name}`);
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/MFA_REQUIRED|Verify your identity|additional verification/iu.test(message) || (error as { code?: string }).code === 'MFA_REQUIRED') { console.log(`skip  ${name} (needs MFA step-up)`); return undefined; }
      failures.push({ name, message: message.replace(/\s+/gu, ' ').slice(0, 600) });
      console.log(`FAIL  ${name}`);
      return undefined;
    }
  }

  const products = await probe('products list', () => catalog.getProducts({}));
  const firstProduct = products?.items[0]?.id;
  if (firstProduct) await probe('product detail', () => catalog.getProduct(firstProduct));
  await probe('catalog variants', () => catalog.getCatalogVariants());
  await probe('categories', () => catalog.getCategories());
  const collections = await probe('collections', () => catalog.getCollections());
  const firstCollection = collections?.items[0]?.id;
  if (firstCollection) await probe('collection detail', () => catalog.getCollection(firstCollection));
  const inventory = await probe('inventory', () => catalog.getInventory());
  const firstVariant = inventory?.items[0]?.variantId;
  if (firstVariant) await probe('inventory movements', () => catalog.getInventoryMovements(firstVariant));

  const mediaPage = await probe('media list', () => media.getMediaPage({}));
  const firstMedia = mediaPage?.items[0]?.id;
  if (firstMedia) {
    await probe('media detail', () => media.getMedia(firstMedia));
    await probe('media usage', () => media.getMediaUsage(firstMedia));
  }
  await probe('media list (archived)', () => media.getMediaPage({ archived: true }));

  const orderPage = await probe('orders list', () => orders.listOrders({}, null));
  const firstOrder = orderPage?.items[0]?.id;
  if (firstOrder) {
    await probe('order detail', () => orders.getOrder(firstOrder));
    await probe('order notes', () => orders.getOrderNotes(firstOrder));
    await probe('order invoice (read-only)', () => orders.getOrderInvoice(firstOrder));
    await probe('order shipments', () => shipping.getOrderShipments(firstOrder));
  }

  await probe('shipping provider', () => shipping.getShippingProvider());
  await probe('shipping settings', () => shipping.getShippingSettings());
  await probe('shipping pins', () => shipping.getShippingPins());
  await probe('shipping ready', () => shipping.getReadyToShip(null));
  await probe('returns', () => shipping.getReturns());
  await probe('refunds', () => shipping.getRefunds());
  const shipments = await probe('shipments', () => shipping.getShipments(null));
  const firstShipment = shipments?.items[0]?.id;
  if (firstShipment) await probe('shipment detail', () => shipping.getShipment(firstShipment));

  await probe('experience state', () => studio.getExperienceState());
  await probe('studio variables', () => studio.getVariables());
  for (const channel of ['app', 'web'] as const) {
    await probe(`studio docs ${channel}`, () => studio.listDocs(channel));
    await probe(`studio diff ${channel}`, () => studio.getDiff(channel));
    await probe(`studio releases ${channel}`, () => studio.listReleases({ channel }));
  }
  await probe('studio campaigns', () => studio.listCampaigns());
  for (const entity of ['care-guides', 'stories', 'journal', 'testimonials', 'faq-groups', 'announcements'] as const) {
    await probe(`library ${entity}`, () => studio.listLibrary(entity as never));
  }
  await probe('lookup categories', () => studio.listCategoryLookups());
  await probe('lookup collections', () => studio.listCollectionLookups());

  await probe('customers', () => ops.listCustomers({}, null, new AbortController().signal));
  await probe('reviews pending', () => ops.listReviews('pending'));
  await probe('coupons', () => ops.listCoupons(undefined, null, new AbortController().signal));
  await probe('coupon analytics', () => ops.getCouponAnalytics());
  await probe('message templates', () => ops.listTemplates());
  await probe('email outbox', () => ops.listEmailOutbox());
  await probe('audit', () => ops.listAudit(undefined));
  await probe('ops health', () => ops.getOpsHealth());
  await probe('ops outbox', () => ops.listOutbox('pending'));
  await probe('settings', () => ops.getSettings());
  await probe('team', () => ops.getTeam());
  await probe('flags', () => ops.listFlags());
  await probe('app versions', () => ops.listAppVersions());
  await probe('integrations', () => ops.listIntegrations());
  await probe('content list', () => ops.listContent());
  await probe('gstr1', () => ops.getGstr1(new Date().toISOString().slice(0, 7)));
  for (const name of Object.keys((overview as Record<string, unknown>)).filter((key) => /^get[A-Z]/u.test(key))) {
    const fn = (overview as Record<string, unknown>)[name];
    if (typeof fn === 'function' && fn.length === 0) await probe(`overview ${name}`, () => (fn as () => Promise<unknown>)());
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const failure of failures) console.log(`\n--- ${failure.name}\n${failure.message}`);
  process.exitCode = failures.length ? 1 : 0;
}

void main();

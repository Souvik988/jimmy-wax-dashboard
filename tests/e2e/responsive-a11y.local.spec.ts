import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { signIn } from './live-helpers';

/**
 * Evidence sweep (LOCAL dev stack): signed-in screenshots at 375/768/1440, horizontal-overflow check, axe (WCAG 2 A/AA/2.2 AA)
 * and a keyboard-only pass over the Studio routes, /media and the main operator routes. Findings are collected, written to
 * docs/build/evidence/responsive/summary.json, and asserted at the end so one run shows every problem.
 */
const enabled = process.env.DASHBOARD_RUN_GUARDED_WRITES === '1';
const email = process.env.DASHBOARD_TEST_ADMIN_EMAIL ?? '';
const password = process.env.DASHBOARD_TEST_ADMIN_PASSWORD ?? '';
const outDir = resolve(process.cwd(), 'docs/build/evidence/responsive');
const viewports = [{ name: '375', width: 375, height: 812 }, { name: '768', width: 768, height: 1024 }, { name: '1440', width: 1440, height: 900 }] as const;

const staticRoutes = [
  '/', '/orders', '/products', '/catalogue', '/inventory', '/media', '/customers', '/reviews', '/coupons', '/messaging',
  '/analytics', '/finance', '/audit', '/ops', '/shipping', '/shipping/shipments', '/shipping/returns',
  '/settings', '/settings/team', '/settings/integrations', '/settings/policies', '/settings/platform', '/account/security',
  '/studio', '/studio/campaigns', '/studio/releases',
];

type Finding = { route: string; viewport: string; kind: 'overflow' | 'axe' | 'focus' | 'trap' | 'skip-link' | 'error'; detail: string };

const slug = (route: string): string => (route === '/' ? 'home' : route.replace(/^\//u, '').replace(/[^A-Za-z0-9]+/gu, '-'));

async function settle(page: Page): Promise<void> {
  // Some pages poll; a bounded wait is enough to let hydration finish.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(400);
  await page.locator('nextjs-portal').evaluateAll((portals) => portals.forEach((portal) => portal.remove())).catch(() => undefined);
}

async function keyboardPass(page: Page, route: string, findings: Finding[]): Promise<void> {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => ({ text: (document.activeElement as HTMLElement | null)?.textContent?.trim().slice(0, 40) ?? '', href: (document.activeElement as HTMLAnchorElement | null)?.getAttribute('href') ?? '' }));
  if (!/skip/iu.test(first.text) && first.href !== '#main-content') findings.push({ route, viewport: '1440', kind: 'skip-link', detail: `first Tab stop is "${first.text}", not the skip link` });

  // Element identity (not screen position: the page scrolls while tabbing). A native date/datetime input legitimately has up to 6 internal stops.
  const tabbable = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),summary')].filter((element) => element.offsetParent !== null).length);
  const steps = Math.min(120, tabbable + 3);
  const seen = new Set<number>();
  let consecutive = 0;
  let previous = -1;
  for (let step = 0; step < steps; step += 1) {
    const info = await page.evaluate(() => {
      const w = window as unknown as { __kbIds?: WeakMap<Element, number>; __kbNext?: number };
      w.__kbIds ??= new WeakMap(); w.__kbNext ??= 0;
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      let id = w.__kbIds.get(element);
      if (id === undefined) { id = (w.__kbNext += 1); w.__kbIds.set(element, id); }
      const style = getComputedStyle(element);
      const outlined = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      return { id, label: `${element.tagName.toLowerCase()} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40)}"`, visibleFocus: outlined || style.boxShadow !== 'none' || style.borderColor !== '', hidden: style.visibility === 'hidden' || style.display === 'none' };
    });
    if (info) {
      if (info.hidden) findings.push({ route, viewport: '1440', kind: 'focus', detail: `focus lands on a hidden element: ${info.label}` });
      if (!info.visibleFocus) findings.push({ route, viewport: '1440', kind: 'focus', detail: `no visible focus indicator on ${info.label}` });
      consecutive = info.id === previous ? consecutive + 1 : 1;
      previous = info.id;
      if (consecutive >= 8) { findings.push({ route, viewport: '1440', kind: 'trap', detail: `focus is stuck on ${info.label}` }); break; }
      seen.add(info.id);
    }
    await page.keyboard.press('Tab');
  }
  if (tabbable > 8 && seen.size < Math.min(tabbable, steps) * 0.5) findings.push({ route, viewport: '1440', kind: 'trap', detail: `Tab reached only ${seen.size} of ${tabbable} controls` });
}

test.describe('responsive + accessibility sweep (local stack)', () => {
  test.skip(!enabled || !email || !password, 'Needs DASHBOARD_RUN_GUARDED_WRITES=1 and disposable local admin credentials.');
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(900_000);

  test('every route renders cleanly at 375, 768 and 1440 and is keyboard-operable', async ({ browser }) => {
    mkdirSync(outDir, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(30_000);
    await signIn(page, email, password, { enrol: true, landing: '/' });

    // Studio documents and library entities are discovered from the live Studio pages.
    const discovered = new Set<string>();
    for (const hub of ['/studio', '/studio/campaigns']) {
      await page.goto(hub); await settle(page);
      const hrefs = await page.$$eval('a[href^="/studio/"]', (links) => links.map((link) => link.getAttribute('href') ?? ''));
      for (const href of hrefs) if (/^\/studio\/(doc|library)\//u.test(href)) discovered.add(href.split('?')[0] as string);
    }
    const routes = [...staticRoutes, ...[...discovered].slice(0, 14)];

    const findings: Finding[] = [];
    const rendered: string[] = [];
    for (const route of routes) {
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        try {
          console.log(`… ${route} @${viewport.name}`);
          const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
          await settle(page);
          if ((response?.status() ?? 200) >= 400) { findings.push({ route, viewport: viewport.name, kind: 'error', detail: `HTTP ${response?.status()}` }); continue; }
          const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
          if (overflow.scroll > overflow.width + 1) findings.push({ route, viewport: viewport.name, kind: 'overflow', detail: `page is ${overflow.scroll}px wide in a ${overflow.width}px window` });
          await page.screenshot({ path: resolve(outDir, `${slug(route)}-${viewport.name}.png`), fullPage: true });
          rendered.push(`${route}@${viewport.name}`);
          const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
          for (const violation of axe.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical')) {
            findings.push({ route, viewport: viewport.name, kind: 'axe', detail: `${violation.id} (${violation.impact}) × ${violation.nodes.length}: ${violation.nodes[0]?.target.join(' ')}` });
          }
          if (viewport.name === '1440') await keyboardPass(page, route, findings);
          writeFileSync(resolve(outDir, 'summary.partial.json'), JSON.stringify({ at: new Date().toISOString(), done: rendered.length, findings }, null, 2));
        } catch (error) {
          findings.push({ route, viewport: viewport.name, kind: 'error', detail: (error as Error).message.split('\n')[0] ?? 'error' });
        }
      }
    }
    writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify({ generatedAt: new Date().toISOString(), routes, rendered: rendered.length, findings }, null, 2));
    console.log(`SWEEP routes=${routes.length} screenshots=${rendered.length} findings=${findings.length}`);
    for (const finding of findings.slice(0, 60)) console.log(`  [${finding.kind}] ${finding.route} @${finding.viewport}: ${finding.detail}`);
    await context.close();
    expect(findings, 'see docs/build/evidence/responsive/summary.json').toEqual([]);
  });
});

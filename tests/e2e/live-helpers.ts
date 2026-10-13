import { createHmac } from 'node:crypto';

import { expect, type Page } from '@playwright/test';

/** Shared helpers for the `*.local.spec.ts` live specs. They only ever talk to the local dev stack with disposable operators. */
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function currentTotp(secret: string): string {
  let accumulator = 0;
  let bitCount = 0;
  const decoded: number[] = [];
  for (const character of secret.toUpperCase().replace(/=+$/u, '').replace(/\s/gu, '')) {
    accumulator = (accumulator << 5) | base32Alphabet.indexOf(character);
    bitCount += 5;
    if (bitCount >= 8) { bitCount -= 8; decoded.push((accumulator >> bitCount) & 0xff); accumulator &= (1 << bitCount) - 1; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(decoded)).update(counter).digest();
  const offset = (digest[19] ?? 0) & 0x0f;
  const binary = (((digest[offset] ?? 0) & 0x7f) << 24) | (((digest[offset + 1] ?? 0) & 0xff) << 16) | (((digest[offset + 2] ?? 0) & 0xff) << 8) | ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

/** Signs in and, when `enrol` is set, enrols an authenticator so the session can pass step-up. Returns the TOTP secret (if enrolled). */
export async function signIn(page: Page, email: string, password: string, options: { enrol?: boolean; landing?: string } = {}): Promise<string | null> {
  const landing = options.landing ?? '/shipping';
  await page.goto(`/login?next=${encodeURIComponent(landing)}`);
  await page.getByRole('textbox', { name: 'Work email' }).fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await page.waitForURL((url) => url.pathname === landing || url.pathname === '/login/enroll' || url.pathname === '/');
  let secret: string | null = null;
  if (options.enrol) {
    if (!page.url().includes('/login/enroll')) await page.goto('/login/enroll');
    const begin = page.getByRole('button', { name: 'Begin secure setup' });
    if (await begin.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false)) {
      await begin.click();
      await page.getByRole('button', { name: 'Reveal key' }).click({ timeout: 30_000 });
      secret = (await page.locator('.mfa-secret code').textContent()) ?? '';
      // A code can straddle its 30-second window on a slow machine: retry with a freshly computed one.
      const recovery = page.locator('.recovery-code-list li').first();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.getByRole('textbox', { name: 'Authenticator code' }).fill(currentTotp(secret));
        await page.getByRole('button', { name: 'Verify and finish setup' }).click();
        if (await recovery.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)) break;
      }
      await expect(recovery).toBeVisible({ timeout: 15_000 });
      await page.getByLabel('I stored these codes somewhere private.').check();
      await page.getByRole('button', { name: 'I saved them — continue' }).click();
    }
  } else if (page.url().includes('/login/enroll')) {
    // Roles that are forced to enrol still need a working session; callers that do not want MFA must not hit this path.
    throw new Error('This operator was sent to MFA enrolment; pass { enrol: true }.');
  }
  await page.goto(landing);
  return secret;
}

/** A raw write through the BFF with the same-origin and CSRF headers the dashboard client sends. */
export async function rawWrite(page: Page, method: 'PUT' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown, extraHeaders: Record<string, string> = {}) {
  const cookies = await page.context().cookies();
  const token = cookies.find((cookie) => cookie.name === 'jw_csrf')?.value ?? '';
  const origin = new URL(page.url()).origin;
  return page.request.fetch(path, { method, ...(data === undefined ? {} : { data }), headers: { origin, 'x-csrf-token': token, ...extraHeaders } });
}

export async function getJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  return await response.json() as T;
}

/** Minimal RFC-4180 reader/writer used to craft one-row import files. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some((value) => value !== '')) rows.push(row); }
  return rows;
}
export const toCsv = (rows: string[][]): string => `${rows.map((row) => row.map((cell) => `"${cell.replace(/"/gu, '""')}"`).join(',')).join('\r\n')}\r\n`;

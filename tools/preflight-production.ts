/**
 * Production preflight for the operator dashboard. Run it with the SAME environment the container will get:
 *   pnpm exec tsx tools/preflight-production.ts            # static checks only
 *   pnpm exec tsx tools/preflight-production.ts --probe    # also asks the backend if it is ready
 * Exit code 1 when any check fails. Secret values are never printed.
 */
export type Finding = { level: 'fail' | 'warn' | 'ok'; check: string; message: string };

type Env = Record<string, string | undefined>;

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try { return new URL(value); } catch { return null; }
}

const isLocalHost = (host: string): boolean => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost') || host.endsWith('.test');

function originCheck(env: Env, key: string, label: string, required: boolean): Finding[] {
  const raw = env[key];
  if (!raw) return [required ? { level: 'fail', check: key, message: `${label} is not set.` } : { level: 'ok', check: key, message: `${label} is not set (optional).` }];
  const url = parseUrl(raw);
  if (!url) return [{ level: 'fail', check: key, message: `${label} is not a valid URL.` }];
  const out: Finding[] = [];
  if (url.protocol !== 'https:') out.push({ level: 'fail', check: key, message: `${label} must use https:// in production (got ${url.protocol}//).` });
  if (isLocalHost(url.hostname)) out.push({ level: 'fail', check: key, message: `${label} points at a local address (${url.hostname}).` });
  if (url.username || url.password) out.push({ level: 'fail', check: key, message: `${label} must not contain credentials.` });
  if (url.pathname !== '/' || url.search || url.hash) out.push({ level: 'fail', check: key, message: `${label} must be an origin only (scheme + host), no path, query or fragment.` });
  if (out.length === 0) out.push({ level: 'ok', check: key, message: `${label} looks right (${url.origin}).` });
  return out;
}

/** Pure: validates the dashboard's production environment. */
export function checkProductionEnv(env: Env): Finding[] {
  const findings: Finding[] = [];
  findings.push(...originCheck(env, 'BACKEND_ORIGIN', 'The backend origin', true));
  findings.push(...originCheck(env, 'DASHBOARD_PUBLIC_ORIGIN', 'The dashboard public origin', true));
  findings.push(...originCheck(env, 'DASHBOARD_STOREFRONT_ORIGIN', 'The storefront origin', false));

  const secret = env.DASHBOARD_SESSION_SECRET;
  if (!secret) findings.push({ level: 'fail', check: 'DASHBOARD_SESSION_SECRET', message: 'The session secret is not set.' });
  else {
    const bytes = Buffer.from(secret, 'base64');
    if (bytes.length < 32) findings.push({ level: 'fail', check: 'DASHBOARD_SESSION_SECRET', message: `The session secret decodes to ${bytes.length} bytes; it needs at least 32 random bytes (base64).` });
    else if (new Set(bytes).size < 8) findings.push({ level: 'fail', check: 'DASHBOARD_SESSION_SECRET', message: 'The session secret has almost no variety; generate it with a random source.' });
    else findings.push({ level: 'ok', check: 'DASHBOARD_SESSION_SECRET', message: `The session secret is ${bytes.length} bytes.` });
  }

  if (env.DASHBOARD_COOKIE_SECURE !== undefined && env.DASHBOARD_COOKIE_SECURE !== 'true') {
    findings.push({ level: 'fail', check: 'DASHBOARD_COOKIE_SECURE', message: 'Leave DASHBOARD_COOKIE_SECURE unset in production; false sends session cookies over plain HTTP.' });
  } else findings.push({ level: 'ok', check: 'DASHBOARD_COOKIE_SECURE', message: 'Session cookies are Secure.' });

  if (env.NODE_ENV && env.NODE_ENV !== 'production') findings.push({ level: 'warn', check: 'NODE_ENV', message: `NODE_ENV is "${env.NODE_ENV}"; the image sets production itself.` });
  const backend = parseUrl(env.BACKEND_ORIGIN);
  const pub = parseUrl(env.DASHBOARD_PUBLIC_ORIGIN);
  if (backend && pub && backend.origin === pub.origin) findings.push({ level: 'fail', check: 'DASHBOARD_PUBLIC_ORIGIN', message: 'The dashboard and the backend share one origin; the BFF would call itself.' });
  return findings;
}

/** Asks the backend whether it is ready and whether MFA-gated admin routes refuse anonymous callers. */
export async function probeBackend(origin: string, fetcher: typeof fetch = fetch): Promise<Finding[]> {
  const findings: Finding[] = [];
  const base = origin.replace(/\/$/u, '');
  try {
    const ready = await fetcher(`${base}/readyz`, { signal: AbortSignal.timeout(8000) });
    findings.push({ level: ready.ok ? 'ok' : 'fail', check: 'backend /readyz', message: `HTTP ${ready.status}` });
  } catch (error) { findings.push({ level: 'fail', check: 'backend /readyz', message: `unreachable: ${(error as Error).message}` }); }
  try {
    const anon = await fetcher(`${base}/v1/admin/shipping/settings`, { signal: AbortSignal.timeout(8000) });
    findings.push({ level: anon.status === 401 || anon.status === 403 ? 'ok' : 'fail', check: 'admin routes need a login', message: `anonymous request got HTTP ${anon.status} (expected 401/403)` });
  } catch (error) { findings.push({ level: 'fail', check: 'admin routes need a login', message: `unreachable: ${(error as Error).message}` }); }
  return findings;
}

const isMain = typeof process !== 'undefined' && process.argv[1] !== undefined && /preflight-production\.ts$/u.test(process.argv[1].replace(/\\/gu, '/'));
if (isMain) {
  const findings = checkProductionEnv(process.env);
  const run = async (): Promise<void> => {
    if (process.argv.includes('--probe') && process.env.BACKEND_ORIGIN) findings.push(...await probeBackend(process.env.BACKEND_ORIGIN));
    for (const finding of findings) console.log(`${finding.level === 'ok' ? 'OK  ' : finding.level === 'warn' ? 'WARN' : 'FAIL'}  ${finding.check}: ${finding.message}`);
    const failed = findings.filter((finding) => finding.level === 'fail').length;
    console.log(failed ? `\n${failed} check(s) failed. Do not deploy.` : '\nAll checks passed.');
    process.exit(failed ? 1 : 0);
  };
  void run();
}

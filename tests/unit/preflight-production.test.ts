import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { checkProductionEnv, probeBackend } from '../../tools/preflight-production';

const good = () => ({
  BACKEND_ORIGIN: 'https://api.jimmyandwax.example',
  DASHBOARD_PUBLIC_ORIGIN: 'https://ops.jimmyandwax.example',
  DASHBOARD_SESSION_SECRET: randomBytes(32).toString('base64'),
});
const fails = (env: Record<string, string | undefined>): string[] => checkProductionEnv(env).filter((finding) => finding.level === 'fail').map((finding) => finding.check);

describe('production preflight', () => {
  it('passes a correct production environment', () => {
    expect(fails(good())).toEqual([]);
    expect(fails({ ...good(), DASHBOARD_STOREFRONT_ORIGIN: 'https://www.jimmyandwax.example' })).toEqual([]);
  });

  it('refuses missing values and weak or malformed secrets', () => {
    expect(fails({})).toEqual(['BACKEND_ORIGIN', 'DASHBOARD_PUBLIC_ORIGIN', 'DASHBOARD_SESSION_SECRET']);
    expect(fails({ ...good(), DASHBOARD_SESSION_SECRET: randomBytes(16).toString('base64') })).toEqual(['DASHBOARD_SESSION_SECRET']);
    expect(fails({ ...good(), DASHBOARD_SESSION_SECRET: Buffer.alloc(32, 7).toString('base64') })).toEqual(['DASHBOARD_SESSION_SECRET']);
  });

  it('refuses plain http, local addresses, paths and credentials in origins', () => {
    expect(fails({ ...good(), BACKEND_ORIGIN: 'http://api.jimmyandwax.example' })).toEqual(['BACKEND_ORIGIN']);
    expect(fails({ ...good(), DASHBOARD_PUBLIC_ORIGIN: 'https://localhost:3200' })).toEqual(['DASHBOARD_PUBLIC_ORIGIN']);
    expect(fails({ ...good(), BACKEND_ORIGIN: 'https://api.jimmyandwax.example/v1' })).toEqual(['BACKEND_ORIGIN']);
    expect(fails({ ...good(), BACKEND_ORIGIN: 'https://user:pass@api.jimmyandwax.example' })).toEqual(['BACKEND_ORIGIN']);
    expect(fails({ ...good(), DASHBOARD_STOREFRONT_ORIGIN: 'not a url' })).toEqual(['DASHBOARD_STOREFRONT_ORIGIN']);
  });

  it('refuses insecure cookies and a dashboard that points at itself', () => {
    expect(fails({ ...good(), DASHBOARD_COOKIE_SECURE: 'false' })).toEqual(['DASHBOARD_COOKIE_SECURE']);
    expect(fails({ ...good(), DASHBOARD_COOKIE_SECURE: 'true' })).toEqual([]);
    expect(fails({ ...good(), DASHBOARD_PUBLIC_ORIGIN: 'https://api.jimmyandwax.example' })).toEqual(['DASHBOARD_PUBLIC_ORIGIN']);
  });

  it('never prints the secret', () => {
    const env = good();
    expect(JSON.stringify(checkProductionEnv(env))).not.toContain(env.DASHBOARD_SESSION_SECRET);
  });

  it('probe: ready backend with login-protected admin routes passes; open admin routes fail', async () => {
    const respond = (ready: number, admin: number): typeof fetch => (async (url: string | URL | Request) => new Response('', { status: String(url).endsWith('/readyz') ? ready : admin })) as typeof fetch;
    expect((await probeBackend('https://api.x.example/', respond(200, 401))).every((finding) => finding.level === 'ok')).toBe(true);
    const open = await probeBackend('https://api.x.example', respond(200, 200));
    expect(open.find((finding) => finding.check === 'admin routes need a login')?.level).toBe('fail');
    const down = await probeBackend('https://api.x.example', (async () => { throw new Error('boom'); }) as unknown as typeof fetch);
    expect(down.every((finding) => finding.level === 'fail')).toBe(true);
  });
});

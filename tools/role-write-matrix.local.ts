/**
 * Live: for every role, each write endpoint is called with an intentionally INVALID body. A permitted role gets 400/404/409/422 (validation or state),
 * a denied role gets 403 — so nothing is ever changed. Compares the backend against the dashboard's rolePermissions table. Local backend only.
 *   ROLE_PASSWORDS='{"support":"..."}' pnpm exec tsx tools/role-write-matrix.local.ts
 */
import { canRole, roles, type Permission, type Role } from '../src/lib/auth/permissions';

const base = process.env['BACKEND'] ?? 'http://localhost:8080';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/u.test(base)) throw new Error('local only');
const passwords = JSON.parse(process.env['ROLE_PASSWORDS'] ?? '{}') as Record<string, string>;
const ZERO = '00000000-0000-4000-8000-000000000000';
const writes: Array<[string, string, Permission]> = [
  ['POST', 'products', 'catalog:write'], ['PATCH', `products/nope`, 'catalog:write'], ['POST', 'categories', 'catalog:write'], ['POST', 'collections', 'catalog:write'],
  ['POST', 'media/' + ZERO + '/approve', 'media:write'], ['PATCH', 'media/' + ZERO, 'media:write'],
  ['POST', 'inventory/nope/adjust', 'inventory:write'], ['POST', `orders/${ZERO}/cancel`, 'orders:cancel'], ['POST', `orders/${ZERO}/status`, 'orders:fulfil'],
  ['POST', `returns/${ZERO}/decide`, 'orders:fulfil'], ['POST', 'coupons', 'coupons:write'], ['PATCH', `coupons/${ZERO}`, 'coupons:write'],
  ['PUT', 'experience/app/docs/page/home', 'experience:write'], ['POST', 'experience/releases', 'experience:publish'], ['POST', 'content-library/stories', 'experience:write'],
  ['POST', 'experience/campaigns', 'experience:write'], ['PATCH', 'settings', 'settings:write'], ['PUT', 'flags/zz_test', 'flags:manage'],
  ['PUT', 'message-templates/order.placed', 'settings:write'], ['PATCH', `customers/${ZERO}`, 'customers:write'], ['POST', `reviews/${ZERO}/moderate`, 'reviews:moderate'],
  ['PUT', 'shipping/settings', 'shipping:write'], ['PUT', 'shipping/pins', 'settings:write'],
  ['POST', 'products/nope/archive', 'catalog:write'], ['POST', 'products/nope/restore', 'catalog:write'], ['POST', 'products/nope/duplicate', 'catalog:write'],
  ['POST', 'experience/app/docs/page/home/discard-draft', 'experience:write'], ['POST', `shipments/${ZERO}/cancel`, 'shipping:write'],
  ['POST', 'team/invite', 'team:manage'], ['POST', `ops/outbox/1/replay`, 'ops:replay'], ['POST', `refunds/${ZERO}/process`, 'refunds:write'],
];

async function main(): Promise<void> {
  let mismatches = 0;
  const lines: string[] = [];
  for (const role of roles.filter((r): r is Role => r !== 'admin' && Boolean(passwords[r]))) {
    const login = await (await fetch(`${base}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `rm-${role}@local.jimmywax.test`, password: passwords[role], client: 'admin' }) })).json() as { accessToken: string };
    for (const [method, path, permission] of writes) {
      let status = 429;
      let code = '';
      for (let attempt = 0; attempt < 10 && status === 429; attempt += 1) {
        const response = await fetch(`${base}/v1/admin/${path}`, { method, headers: { authorization: `Bearer ${login.accessToken}`, 'content-type': 'application/json', ...(method === 'PUT' && path.includes('docs') ? { 'if-match': '"1"' } : {}) }, body: JSON.stringify({ invalid: true }) });
        status = response.status;
        code = ((await response.json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code ?? '';
        if (status === 429) await new Promise((resolve) => setTimeout(resolve, 2500));
      }
      const allowed = canRole(role, permission) && !(path.startsWith('media/') && path.endsWith('/approve'));
      // MFA_REQUIRED means the role is allowed but needs step-up. Media approve/reject is admin-only in the backend (known, DASH-BR-038).
      const denied = (status === 403 && code !== 'MFA_REQUIRED') || status === 401;
      const ok = allowed ? !denied : denied;
      if (!ok) mismatches += 1;
      lines.push(`${ok ? 'PASS' : 'MISMATCH'} ${role} ${method} ${path} -> ${status} (table says ${allowed ? 'allowed' : 'denied'})`);
    }
  }
  console.log(lines.join('\n'));
  console.log(`\n${lines.length} checks, ${mismatches} mismatch(es)`);
  process.exitCode = mismatches ? 1 : 0;
}
void main();

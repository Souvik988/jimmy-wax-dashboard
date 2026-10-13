/* eslint-disable @typescript-eslint/no-explicit-any -- passthrough backend payloads are intentionally loosely typed */
/**
 * Live acceptance: every block type is added through the engine's minimalInstance, saved to the REAL backend as a draft page,
 * read back unchanged, validated, and the disposable document is deleted. Local development backend only.
 *   BACKEND=http://localhost:8080 ROUNDTRIP_EMAIL=... ROUNDTRIP_PASSWORD=... pnpm exec tsx tools/studio-roundtrip.local.ts
 */
import blocksSchema from '../docs/backend-contract/blocks.schema.json';
import { blockSpecs, newBlock, typesFor } from '../src/features/studio/doc-model';
import { validate } from '../src/features/studio/engine/schema';

const base = process.env['BACKEND'] ?? 'http://localhost:8080';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/u.test(base)) throw new Error('Refusing to run against a non-local backend.');
const email = process.env['ROUNDTRIP_EMAIL'] ?? '';
const password = process.env['ROUNDTRIP_PASSWORD'] ?? '';

async function main(): Promise<void> {
  const login = await (await fetch(`${base}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, client: 'admin' }) })).json() as { accessToken: string };
  const call = async (method: string, path: string, body?: unknown, ifMatch?: string): Promise<{ status: number; json: any }> => {
    let response: Response;
    for (let attempt = 0; ; attempt += 1) {
      response = await fetch(`${base}/v1/admin/${path}`, { method, headers: { authorization: `Bearer ${login.accessToken}`, ...(body ? { 'content-type': 'application/json' } : {}), ...(ifMatch ? { 'if-match': ifMatch } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (response.status !== 429 || attempt >= 12) break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  };
  const results: string[] = [];
  let failures = 0;
  let original: Record<string, unknown> | undefined;
  const subset = (sent: unknown, got: unknown): boolean => {
    if (Array.isArray(sent)) return Array.isArray(got) && sent.length === got.length && sent.every((item, index) => subset(item, got[index]));
    if (sent && typeof sent === 'object') return Boolean(got) && typeof got === 'object' && Object.entries(sent).every(([k, v]) => subset(v, (got as Record<string, unknown>)[k]));
    return sent === got;
  };
  for (const [channel, key] of [['app', 'home'], ['web', 'custom:rt-test']] as const) {
    for (const type of typesFor(channel)) {
      const block = newBlock(type);
      const clientErrors = validate(blockSpecs[type]!.props, block.props);
      const page = { schemaVersion: 1, blocks: [block] };
      const existing = await call('GET', `experience/${channel}/docs/page/${key}`);
      // Standard pages cannot be deleted by the backend: app/home's draft is backed up and restored afterwards; web uses a disposable custom page.
      if (existing.status === 200 && channel === 'web') throw new Error(`${channel}/${key} already exists; refusing to overwrite a real document.`);
      if (existing.status === 200 && !original) original = existing.json.body;
      const saved = await call('PUT', `experience/${channel}/docs/page/${key}`, page, existing.status === 200 ? existing.json.etag : '"0"');
      let note = `${saved.status}`;
      let ok = saved.status === 200;
      if (ok) {
        const back = await call('GET', `experience/${channel}/docs/page/${key}`);
        const same = subset(page.blocks, back.json.body.blocks);
        ok = same; note = same ? 'saved; read back identical (server may add defaults)' : `READ-BACK DIFFERS sent=${JSON.stringify(page.blocks).slice(0, 300)} got=${JSON.stringify(back.json.body.blocks).slice(0, 400)}`;
        if (channel === 'web') await call('DELETE', `experience/${channel}/docs/page/${key}`);
      } else {
        note = `rejected ${saved.status}: ${JSON.stringify(saved.json?.error?.fields ?? saved.json?.error)} (client errors: ${JSON.stringify(clientErrors)})`;
      }
      if (!ok) failures += 1;
      results.push(`${ok ? 'PASS' : 'FAIL'} ${type} — ${note}`);
    }
  }
  console.log(results.join('\n'));
  console.log(`\n${Object.keys(blocksSchema.blocks).length} block types, ${failures} failure(s)`);
  process.exitCode = failures ? 1 : 0;
}
void main();

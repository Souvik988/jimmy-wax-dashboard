/** Live: every real non-page document in the local backend must validate against the dashboard's mirror schemas. */
import { schemaForDoc } from '../src/features/studio/doc-schemas';
import { validate } from '../src/features/studio/engine/schema';

async function main(): Promise<void> {
const base = 'http://localhost:8080';
const login = await (await fetch(`${base}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env['ROUNDTRIP_EMAIL'], password: process.env['ROUNDTRIP_PASSWORD'], client: 'admin' }) })).json() as { accessToken: string };
let bad = 0;
for (const [channel, kind, key] of [['shared', 'tokens', 'base'], ['app', 'navigation', 'main'], ['web', 'navigation', 'main'], ['app', 'chrome', 'main'], ['web', 'chrome', 'main']] as const) {
  const doc = await (await fetch(`${base}/v1/admin/experience/${channel}/docs/${kind}/${key}`, { headers: { authorization: `Bearer ${login.accessToken}` } })).json() as { body: Record<string, unknown> };
  const { schemaVersion: _v, ...rest } = doc.body;
  const errors = validate(schemaForDoc(channel, kind)!, rest);
  console.log(Object.keys(errors).length === 0 ? 'PASS' : 'FAIL', channel, kind, key, JSON.stringify(errors).slice(0, 400));
  if (Object.keys(errors).length) bad += 1;
}
process.exitCode = bad ? 1 : 0;
}
void main();

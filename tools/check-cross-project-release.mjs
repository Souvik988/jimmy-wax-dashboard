import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dashboard = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = dirname(dashboard);
const files = {
  backend: resolve(desktop, 'jimmy&wax_backend/contracts/api/openapi.yaml'),
  pack: resolve(desktop, 'jimmy&wax_backend/contracts/pack/openapi.yaml'),
  dashboard: resolve(dashboard, 'docs/backend-contract/openapi.yaml'),
  website: resolve(desktop, 'jimmy_nd _wax_website/contracts/api/openapi.yaml'),
  app: resolve(desktop, 'jimmy&wax_app/contracts/api/openapi.yaml'),
};
const checks = Object.entries(files).map(([project, path]) => ({
  project, path, exists: existsSync(path),
  sha256: existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null,
}));
const canonical = checks.find(x => x.project === 'backend')?.sha256;
const success = !!canonical && checks.every(x => x.sha256 === canonical);
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), success, checks, shiprocket: 'Live activation deferred until owner credentials and provider acceptance', deploymentCertified: false }, null, 2));
if (!success) process.exitCode = 1;

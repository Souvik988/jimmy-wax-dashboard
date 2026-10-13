import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const sourcePath = 'docs/backend-contract/openapi.yaml';
const lock = JSON.parse(await readFile('contract.lock.json', 'utf8'));
const source = await readFile(sourcePath);
const actualHash = createHash('sha256').update(source).digest('hex');

if (actualHash !== lock.openapi.sha256) {
  console.error(`Contract drift: ${sourcePath} is ${actualHash}, expected ${lock.openapi.sha256}.`);
  console.error('Run pnpm contract:generate, review the generated type diff, then update contract.lock.json.');
  process.exit(1);
}

console.log(`Contract lock verified: ${lock.openapi.version} (${actualHash}).`);

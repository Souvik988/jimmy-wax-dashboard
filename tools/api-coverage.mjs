// Lists admin operations from the pinned API index whose path prefix is never referenced under src/. Usage: node tools/api-coverage.mjs
import fs from 'node:fs';
import path from 'node:path';

const lines = fs.readFileSync('docs/backend-contract/api-index.md', 'utf8').split('\n').filter((l) => l.startsWith('| ') && l.includes('/v1/admin/'));
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/u.test(entry.name)) files.push(full);
  }
})('src');
const source = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const missing = [];
let total = 0;
for (const line of lines) {
  const match = line.match(/\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)`/u);
  if (!match) continue;
  total += 1;
  const [, method, route] = match;
  const stem = route.replace('/v1/', '').split('{')[0].replace(/\/$/u, '');
  // the tail after the last parameter (e.g. /approve) distinguishes sibling operations
  const tail = route.includes('}') ? route.slice(route.lastIndexOf('}') + 1) : '';
  const referenced = source.includes(stem) && (!tail || source.includes(tail));
  if (!referenced) missing.push(`${method} ${route}`);
}
console.log(`${total} admin operations in the index; ${missing.length} not referenced under src/:`);
console.log(missing.join('\n'));

/**
 * Read-only introspection of the existing Supabase project.
 * Prints table/column names only - never credential values.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const res = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
});

if (!res.ok) {
  console.error('PostgREST introspection failed:', res.status, res.statusText);
  process.exit(1);
}

const spec = await res.json();
const defs = spec.definitions ?? {};
const names = Object.keys(defs).sort();

console.log(`public schema exposes ${names.length} table(s)/view(s)`);
for (const name of names) {
  const props = Object.keys(defs[name].properties ?? {});
  console.log(`  - ${name}: [${props.join(', ')}]`);
}

const rpcs = Object.keys(spec.paths ?? {}).filter((p) => p.startsWith('/rpc/'));
console.log(`\nRPC functions: ${rpcs.length ? rpcs.join(', ') : '(none)'}`);

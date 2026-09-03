/**
 * Production bundle for the game server.
 *
 * `@ragelab/shared` is a source-only workspace package, so it gets bundled in.
 * Everything with native/wasm assets stays external and is resolved from
 * node_modules at runtime.
 */
import { build } from 'esbuild';

const external = [
  'ws',
  '@supabase/supabase-js',
  '@dimforge/rapier3d-compat',
  'dotenv',
];

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/server.js',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  external,
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
});

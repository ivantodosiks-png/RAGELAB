import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';

const monorepoRoot = resolve(__dirname, '..');

/**
 * The repository's `.env` uses NEXT_PUBLIC_* names for the browser-safe
 * Supabase values. Vite only exposes VITE_*, so we read the monorepo `.env`
 * ourselves and inject just the public values. Service-role keys and the JWT
 * secret are never referenced here, so they cannot leak into the bundle.
 */
export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, monorepoRoot, '');
  const env = { ...fileEnv, ...process.env };

  const supabaseUrl = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey =
    env.VITE_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    '';
  const gameServerUrl = env.VITE_GAME_SERVER_URL || 'ws://localhost:8080';
  const gameServerHttpUrl =
    env.VITE_GAME_SERVER_HTTP_URL || gameServerUrl.replace(/^ws/, 'http');

  return {
    root: __dirname,
    envDir: monorepoRoot,
    define: {
      __SUPABASE_URL__: JSON.stringify(supabaseUrl),
      __SUPABASE_ANON_KEY__: JSON.stringify(supabaseAnonKey),
      __GAME_SERVER_URL__: JSON.stringify(gameServerUrl),
      __GAME_SERVER_HTTP_URL__: JSON.stringify(gameServerHttpUrl),
    },
    server: {
      port: 5173,
      strictPort: false,
      host: true,
      fs: {
        allow: [monorepoRoot],
      },
    },
    preview: {
      port: 4173,
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 2400,
      rollupOptions: {
        output: {
          manualChunks: {
            three: ['three'],
            rapier: ['@dimforge/rapier3d-compat'],
            supabase: ['@supabase/supabase-js'],
          },
        },
      },
    },
    optimizeDeps: {
      // The wasm bundle must not be pre-bundled or the init path breaks.
      exclude: ['@dimforge/rapier3d-compat'],
    },
    worker: {
      format: 'es',
    },
  };
});

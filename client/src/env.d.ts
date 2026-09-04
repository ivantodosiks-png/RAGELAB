/// <reference types="vite/client" />

/** Injected by vite.config.ts from the monorepo `.env`. Public values only. */
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;
declare const __GAME_SERVER_URL__: string;
declare const __GAME_SERVER_HTTP_URL__: string;
/** True when Vite is serving the client and proxies /game-ws + /game-http. */
declare const __GAME_SERVER_DEV_PROXY__: boolean;
/** Lowercase emails from RAGELAB_ADMIN_EMAILS — unlocks Create lobby in the menu. */
declare const __ADMIN_EMAILS__: string[];

declare module '*.mp3?url' {
  const src: string;
  export default src;
}

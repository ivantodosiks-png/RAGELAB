import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../supabase/types/database';

export type AppSupabaseClient = SupabaseClient<Database>;

const url = __SUPABASE_URL__;
const anonKey = __SUPABASE_ANON_KEY__;

/**
 * Browser Supabase client. Uses only the anon/publishable key, which is
 * designed to be public and is gated by row level security. The service role
 * key is never bundled - see vite.config.ts.
 */
let client: AppSupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

export function supabase(): AppSupabaseClient {
  if (!supabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env',
    );
  }
  if (!client) {
    client = createClient<Database>(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'ragelab.auth',
      },
      global: { headers: { 'X-Client-Info': 'ragelab-client' } },
    });
  }
  return client;
}

/**
 * WebSocket / HTTP URLs the browser actually uses.
 *
 * The Vite bundle defaults to localhost, which only works on the host PC.
 * Friends opening the page via a LAN IP would otherwise hit *their* localhost
 * (WebSocket close 1006, endless Reconnecting). In `vite` / `vite preview` we
 * proxy through the same origin so they only need the client port. In a static
 * production build we rewrite loopback hosts to the page hostname.
 */
export const GAME_SERVER_URL = resolveGameServerUrl(__GAME_SERVER_URL__, 'ws');
export const GAME_SERVER_HTTP_URL = resolveGameServerUrl(__GAME_SERVER_HTTP_URL__, 'http');

export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/** Use a listed host's public WebSocket when joining from another network. */
export function resolveJoinWsUrl(wsUrl?: string | null): string {
  if (!wsUrl) return GAME_SERVER_URL;
  try {
    const parsed = new URL(wsUrl);
    if (isLoopbackHost(parsed.hostname)) return GAME_SERVER_URL;
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && parsed.protocol === 'ws:') {
      parsed.protocol = 'wss:';
    }
    return parsed.toString();
  } catch {
    return GAME_SERVER_URL;
  }
}

function resolveGameServerUrl(configured: string, kind: 'ws' | 'http'): string {
  if (typeof window === 'undefined' || !configured) return configured;

  if (__GAME_SERVER_DEV_PROXY__) {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return kind === 'ws'
      ? `${wsProto}//${window.location.host}/game-ws`
      : `${window.location.origin}/game-http`;
  }

  try {
    const parsed = new URL(configured);
    if (isLoopbackHost(parsed.hostname) && !isLoopbackHost(window.location.hostname)) {
      parsed.hostname = window.location.hostname;
      return parsed.toString();
    }
  } catch {
    /* keep the compiled URL */
  }
  return configured;
}

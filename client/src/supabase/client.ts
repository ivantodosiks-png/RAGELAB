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
 * proxy through the same origin so they only need the client port. A static
 * production host (Vercel) is not the game server, so loopback URLs stay as
 * compiled — friends join by lobby code using the host's public `ws_url`.
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

function sameOriginPlay(): boolean {
  return typeof window !== 'undefined' && Boolean(Reflect.get(window, '__RAGELAB_SAME_ORIGIN__'));
}

function resolveGameServerUrl(configured: string, kind: 'ws' | 'http'): string {
  if (typeof window === 'undefined' || !configured) return configured;

  if (__GAME_SERVER_DEV_PROXY__) {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return kind === 'ws'
      ? `${wsProto}//${window.location.host}/game-ws`
      : `${window.location.origin}/game-http`;
  }

  if (sameOriginPlay()) {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return kind === 'ws' ? `${wsProto}//${window.location.host}` : window.location.origin;
  }

  try {
    const parsed = new URL(configured);
    // A static production host (Vercel) is not the game server. Keep the
    // compiled URL so join-by-code can use Supabase ws_url instead.
    if (isLoopbackHost(parsed.hostname) && !isLoopbackHost(window.location.hostname)) {
      return configured;
    }
  } catch {
    /* keep the compiled URL */
  }
  return configured;
}

export function isPublicGameServerUrl(url: string): boolean {
  try {
    return !isLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** False on a static site whose bundle still points at localhost. */
export function shouldQueryConfiguredGameHttp(): boolean {
  if (__GAME_SERVER_DEV_PROXY__) return true;
  if (typeof window === 'undefined') return true;
  try {
    const host = new URL(GAME_SERVER_HTTP_URL).hostname;
    if (isLoopbackHost(host) && !isLoopbackHost(window.location.hostname)) return false;
    return true;
  } catch {
    return true;
  }
}

/** Vite / local page can talk to the Node process directly. */
export function canDirectConnectToGameServer(): boolean {
  if (__GAME_SERVER_DEV_PROXY__) return true;
  if (sameOriginPlay()) return true;
  if (isPublicGameServerUrl(GAME_SERVER_URL)) return true;
  if (typeof window !== 'undefined' && isLoopbackHost(window.location.hostname)) return true;
  return false;
}

async function fetchOk(url: string, ms = 2000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * True when a game process is reachable from this browser: Vite proxy, a
 * public hub, or Node on this PC (`localhost:8080`) even if the page is the
 * hosted website.
 */
export async function localGameServerReachable(): Promise<boolean> {
  const bases: string[] = [];
  if (shouldQueryConfiguredGameHttp()) bases.push(GAME_SERVER_HTTP_URL);
  bases.push('http://127.0.0.1:8080', 'http://localhost:8080');
  const seen = new Set<string>();
  for (const base of bases) {
    const key = base.replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    if (await fetchOk(`${key}/health`)) return true;
  }
  return false;
}

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

export const GAME_SERVER_URL = __GAME_SERVER_URL__;
export const GAME_SERVER_HTTP_URL = __GAME_SERVER_HTTP_URL__;

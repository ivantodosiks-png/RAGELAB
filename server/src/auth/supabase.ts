import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../supabase/types/database';
import { config } from '../config';
import { log } from '../logger';

export type ServiceClient = SupabaseClient<Database>;

let client: ServiceClient | null = null;

/**
 * Service-role Supabase client. This key bypasses RLS, so it lives only in the
 * server process and is never exposed over the wire.
 */
export function serviceClient(): ServiceClient | null {
  if (!config.supabase.enabled) return null;
  if (client) return client;
  client = createClient<Database>(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'ragelab-server' } },
  });
  log.info('Supabase service client initialised');
  return client;
}

export function requireServiceClient(): ServiceClient {
  const c = serviceClient();
  if (!c) throw new Error('Supabase is not configured on this server');
  return c;
}

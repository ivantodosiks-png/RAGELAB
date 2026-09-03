import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  ABSOLUTE_MAX_PLAYERS_PER_ROOM,
  DEFAULT_MAX_PLAYERS_PER_ROOM,
  SNAPSHOT_RATE,
  TICK_RATE,
} from '@ragelab/shared';

/** Walk up from the server package to find the monorepo `.env`. */
function loadEnv(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenv.config();
}

loadEnv();

function str(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

const supabaseUrl = str('SUPABASE_URL') || str('NEXT_PUBLIC_SUPABASE_URL') || str('VITE_SUPABASE_URL');
const serviceRoleKey = str('SUPABASE_SERVICE_ROLE_KEY') || str('SUPABASE_SECRET_KEY');
const anonKey =
  str('NEXT_PUBLIC_SUPABASE_ANON_KEY') ||
  str('SUPABASE_ANON_KEY') ||
  str('VITE_SUPABASE_ANON_KEY');

export interface ServerConfig {
  host: string;
  port: number;
  name: string;
  region: string;
  tickRate: number;
  snapshotRate: number;
  maxPlayersPerRoom: number;
  maxConnections: number;
  allowedOrigins: string[];
  allowGuests: boolean;
  persist: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  publicWsUrl: string;
  supabase: {
    url: string;
    serviceRoleKey: string;
    anonKey: string;
    jwtSecret: string;
    /** True when we have everything needed for authenticated play. */
    enabled: boolean;
  };
}

export const config: ServerConfig = {
  host: str('GAME_SERVER_HOST', '0.0.0.0'),
  port: num('GAME_SERVER_PORT', 8080),
  name: str('GAME_SERVER_NAME', 'RAGELAB Local Server'),
  region: str('GAME_SERVER_REGION', 'local'),
  tickRate: Math.min(num('GAME_SERVER_TICK_RATE', TICK_RATE), 120),
  snapshotRate: Math.min(num('GAME_SERVER_SNAPSHOT_RATE', SNAPSHOT_RATE), 60),
  maxPlayersPerRoom: Math.min(
    num('GAME_SERVER_MAX_PLAYERS_PER_ROOM', DEFAULT_MAX_PLAYERS_PER_ROOM),
    ABSOLUTE_MAX_PLAYERS_PER_ROOM,
  ),
  maxConnections: num('GAME_SERVER_MAX_CONNECTIONS', 256),
  allowedOrigins: str('GAME_SERVER_ALLOWED_ORIGINS', '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  allowGuests: bool('GAME_SERVER_ALLOW_GUESTS', true),
  persist: bool('GAME_SERVER_PERSIST', true),
  logLevel: (str('LOG_LEVEL', 'info') as ServerConfig['logLevel']) ?? 'info',
  publicWsUrl: str('GAME_SERVER_PUBLIC_WS_URL', str('VITE_GAME_SERVER_URL', '')),
  supabase: {
    url: supabaseUrl,
    serviceRoleKey,
    anonKey,
    jwtSecret: str('SUPABASE_JWT_SECRET'),
    enabled: Boolean(supabaseUrl && serviceRoleKey),
  },
};

/** Log a config summary with every secret reduced to a presence flag. */
export function describeConfig(): Record<string, unknown> {
  return {
    host: config.host,
    port: config.port,
    name: config.name,
    region: config.region,
    tickRate: config.tickRate,
    snapshotRate: config.snapshotRate,
    maxPlayersPerRoom: config.maxPlayersPerRoom,
    allowedOrigins: config.allowedOrigins,
    allowGuests: config.allowGuests,
    persist: config.persist,
    supabase: {
      url: config.supabase.url ? new URL(config.supabase.url).host : '(not configured)',
      serviceRoleKey: config.supabase.serviceRoleKey ? 'present' : 'missing',
      anonKey: config.supabase.anonKey ? 'present' : 'missing',
      jwtSecret: config.supabase.jwtSecret ? 'present' : 'missing',
      enabled: config.supabase.enabled,
    },
  };
}

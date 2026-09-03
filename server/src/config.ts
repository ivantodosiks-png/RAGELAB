import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
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
  /** Distinguishes this process in the Supabase server browser. */
  instanceId: string;
  tickRate: number;
  snapshotRate: number;
  maxPlayersPerRoom: number;
  maxConnections: number;
  allowedOrigins: string[];
  allowGuests: boolean;
  persist: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  publicWsUrl: string;
  /** Open a Cloudflare quick tunnel so friends can join from any internet. */
  publicTunnel: boolean;
  supabase: {
    url: string;
    serviceRoleKey: string;
    anonKey: string;
    jwtSecret: string;
    /** True when we have everything needed for authenticated play. */
    enabled: boolean;
  };
}

function inferredPublicWsUrl(): string {
  const explicit = str('GAME_SERVER_PUBLIC_WS_URL', '');
  if (explicit) return explicit;
  const railway = str('RAILWAY_PUBLIC_DOMAIN', '');
  if (railway) return `wss://${railway}`;
  const fly = str('FLY_APP_NAME', '');
  if (fly) return `wss://${fly}.fly.dev`;
  return '';
}

const publicWsUrl = inferredPublicWsUrl();

export const config: ServerConfig = {
  host: str('GAME_SERVER_HOST', '0.0.0.0'),
  port: Number(process.env.PORT) > 0 ? Number(process.env.PORT) : num('GAME_SERVER_PORT', 8080),
  name: str('GAME_SERVER_NAME', `RAGELAB · ${hostname()}`).slice(0, 48),
  region: str('GAME_SERVER_REGION', 'local'),
  instanceId: str('GAME_SERVER_ID', randomBytes(4).toString('hex')),
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
  publicWsUrl,
  publicTunnel: bool('GAME_SERVER_PUBLIC_TUNNEL', !publicWsUrl),
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
    instanceId: config.instanceId,
    tickRate: config.tickRate,
    snapshotRate: config.snapshotRate,
    maxPlayersPerRoom: config.maxPlayersPerRoom,
    allowedOrigins: config.allowedOrigins,
    allowGuests: config.allowGuests,
    persist: config.persist,
    publicWsUrl: config.publicWsUrl || '(local only)',
    publicTunnel: config.publicTunnel,
    supabase: {
      url: config.supabase.url ? new URL(config.supabase.url).host : '(not configured)',
      serviceRoleKey: config.supabase.serviceRoleKey ? 'present' : 'missing',
      anonKey: config.supabase.anonKey ? 'present' : 'missing',
      jwtSecret: config.supabase.jwtSecret ? 'present' : 'missing',
      enabled: config.supabase.enabled,
    },
  };
}

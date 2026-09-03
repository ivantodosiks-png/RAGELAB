import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import RAPIER from '@dimforge/rapier3d-compat';
import { MAP_IDS, PROTOCOL_VERSION, WEAPON_IDS, isLobbyCode, normalizeLobbyCode } from '@ragelab/shared';
import { config, describeConfig } from './config';
import { log } from './logger';
import { Gateway } from './net/gateway';
import { startPublicTunnel, type PublicTunnel } from './net/publicTunnel';
import { RoomManager } from './rooms/roomManager';
import { resolveClientDist, StaticSite } from './http/staticSite';

async function main(): Promise<void> {
  log.info('RAGELAB server starting', describeConfig());

  await RAPIER.init();
  log.info('Rapier physics initialised');

  const rooms = new RoomManager(RAPIER);
  const clientDist = resolveClientDist();
  const site = new StaticSite(clientDist);
  if (clientDist) log.info('serving client', { dist: clientDist });

  const httpServer = createServer((req, res) => handleHttp(req, res, rooms, gateway, site));
  const gateway = new Gateway(httpServer, rooms);

  rooms.start();

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => resolve());
  });

  log.info('listening', {
    ws: `ws://${config.host}:${config.port}`,
    http: `http://${config.host}:${config.port}/health`,
    protocol: PROTOCOL_VERSION,
    maps: MAP_IDS,
    weapons: WEAPON_IDS,
  });

  let tunnel: PublicTunnel | null = null;
  try {
    tunnel = await startPublicTunnel(config.port);
  } catch (err) {
    log.warn('public tunnel failed', { message: (err as Error).message });
  }
  rooms.heartbeatNow();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });
    tunnel?.stop();
    await gateway.close();
    await rooms.shutdown();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    log.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { message: String(reason) });
  });
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', { message: err.message, stack: err.stack });
  });
}

/**
 * Tiny HTTP surface next to the WebSocket: health checks for orchestrators and
 * a room list so the client's server browser works even when Supabase mirroring
 * is turned off.
 */
function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  rooms: RoomManager,
  gateway: Gateway | undefined,
  site: StaticSite,
): void {
  const origin = req.headers.origin;
  const allowOrigin =
    config.allowedOrigins.includes('*') || !origin
      ? '*'
      : config.allowedOrigins.includes(origin)
        ? origin
        : '';

  if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/health') {
    json(res, 200, {
      status: 'ok',
      name: config.name,
      region: config.region,
      protocol: PROTOCOL_VERSION,
      tickRate: config.tickRate,
      snapshotRate: config.snapshotRate,
      connections: gateway?.connectionCount ?? 0,
      rooms: rooms.listRooms().length,
      uptimeSeconds: Math.round(process.uptime()),
    });
    return;
  }

  if (url.pathname === '/rooms') {
    json(res, 200, { rooms: rooms.listRooms(), wsUrl: config.publicWsUrl || null });
    return;
  }

  if (url.pathname.startsWith('/lobby/')) {
    const code = normalizeLobbyCode(decodeURIComponent(url.pathname.slice('/lobby/'.length)));
    if (!isLobbyCode(code)) {
      json(res, 400, { error: 'bad_code' });
      return;
    }
    const room = rooms.getRoomByCode(code);
    if (!room) {
      json(res, 404, { error: 'room_not_found' });
      return;
    }
    json(res, 200, { room: room.summary(), wsUrl: config.publicWsUrl || null });
    return;
  }

  if (site.tryServe(req, res, url.pathname)) return;

  json(res, 404, { error: 'not_found' });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

main().catch((err) => {
  log.error('fatal startup error', { message: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});

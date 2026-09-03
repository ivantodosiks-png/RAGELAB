import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ErrorCode,
  MAX_PACKET_BYTES,
  Op,
  PROTOCOL_VERSION,
  decodeInputPacket,
  decodeJsonBody,
  encodePong,
  type ChatPayload,
  type CreateRoomPayload,
  type HelloPayload,
  type RoomListPayload,
  type SwitchWeaponPayload,
} from '@ragelab/shared';
import { config } from '../config';
import { log } from '../logger';
import { verifyAccessToken } from '../auth/verify';
import { grantAdminIfListed, loadProfile } from '../persistence/profiles';
import { sanitizeChat, sanitizeUsername } from '../validation/antiCheat';
import type { RoomManager } from '../rooms/roomManager';
import { Connection, ConnectionState } from './connection';
import { ConnectionThrottle } from './rateLimiter';

let guestCounter = 1;

export class Gateway {
  private readonly wss: WebSocketServer;
  private readonly connections = new Set<Connection>();
  private readonly throttle = new ConnectionThrottle();
  private readonly reaper: NodeJS.Timeout;

  constructor(
    httpServer: HttpServer,
    private readonly rooms: RoomManager,
  ) {
    this.wss = new WebSocketServer({
      server: httpServer,
      maxPayload: MAX_PACKET_BYTES,
      perMessageDeflate: false,
      verifyClient: (info, done) => this.verifyClient(info, done),
    });

    this.wss.on('connection', (socket, request) => this.onConnection(socket, request));
    this.wss.on('error', (err) => log.error('websocket server error', { message: err.message }));

    this.reaper = setInterval(() => this.reapDeadConnections(), 4000);
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  private verifyClient(
    info: { origin: string; req: IncomingMessage; secure: boolean },
    done: (result: boolean, code?: number, message?: string) => void,
  ): void {
    if (this.connections.size >= config.maxConnections) {
      done(false, 503, 'server full');
      return;
    }

    const ip = clientIp(info.req);
    if (!this.throttle.allow(ip)) {
      log.warn('connection throttled', { ip });
      done(false, 429, 'too many connections');
      return;
    }

    if (!config.allowedOrigins.includes('*')) {
      const origin = info.origin ?? '';
      if (!config.allowedOrigins.includes(origin)) {
        log.warn('rejected origin', { origin, ip });
        done(false, 403, 'origin not allowed');
        return;
      }
    }

    done(true);
  }

  private onConnection(socket: WebSocket, request: IncomingMessage): void {
    const connection = new Connection(socket, clientIp(request));
    this.connections.add(connection);
    log.debug('connection opened', { connection: connection.connectionId, ip: connection.ip });

    socket.on('message', (data, isBinary) => {
      void this.onMessage(connection, data as Buffer, isBinary);
    });
    socket.on('close', () => void this.onClose(connection));
    socket.on('error', (err) => {
      log.debug('socket error', {
        connection: connection.connectionId,
        message: err.message,
      });
    });
    socket.on('pong', () => connection.notePong());
  }

  private async onMessage(connection: Connection, raw: Buffer, isBinary: boolean): Promise<void> {
    if (connection.state === ConnectionState.Closing) return;
    if (!isBinary) {
      connection.sendError(ErrorCode.BadPacket, 'binary frames only', true);
      return;
    }
    if (raw.byteLength < 1 || raw.byteLength > MAX_PACKET_BYTES) {
      connection.sendError(ErrorCode.BadPacket, 'invalid packet size', true);
      return;
    }
    if (!connection.allowMessage()) {
      connection.sendError(ErrorCode.RateLimited, 'too many messages', true);
      return;
    }

    const data = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    const op = data[0]!;

    try {
      switch (op) {
        case Op.Hello:
          await this.handleHello(connection, data);
          break;
        case Op.Input:
          this.handleInput(connection, data);
          break;
        case Op.Ping:
          this.handlePing(connection, data);
          break;
        case Op.SwitchWeapon:
          this.handleSwitchWeapon(connection, data);
          break;
        case Op.Chat:
          this.handleChat(connection, data);
          break;
        case Op.RespawnRequest:
          if (connection.allowControlMessage() && connection.room) {
            connection.room.requestRespawn(connection.playerId);
          }
          break;
        case Op.ListRooms:
          if (connection.allowControlMessage()) {
            const payload: RoomListPayload = { rooms: this.rooms.listRooms() };
            connection.sendJson(Op.RoomList, payload);
          }
          break;
        case Op.CreateRoom:
          await this.handleCreateRoom(connection, data);
          break;
        case Op.LeaveRoom:
          if (connection.allowControlMessage()) await this.rooms.removePlayer(connection);
          break;
        case Op.StartMatch:
          this.handleStartMatch(connection);
          break;
        default:
          connection.sendError(ErrorCode.BadPacket, `unknown opcode ${op}`, true);
      }
    } catch (err) {
      log.warn('message handling failed', {
        connection: connection.connectionId,
        op,
        message: (err as Error).message,
      });
      connection.sendError(ErrorCode.BadPacket, 'malformed packet', true);
    }
  }

  private async handleHello(connection: Connection, data: Uint8Array): Promise<void> {
    if (connection.state !== ConnectionState.Handshaking && connection.room) {
      connection.sendError(ErrorCode.AlreadyInRoom, 'already in a room');
      return;
    }

    const payload = decodeJsonBody<HelloPayload>(data);
    if (payload.protocol !== PROTOCOL_VERSION) {
      connection.sendError(
        ErrorCode.BadPacket,
        `protocol mismatch (server ${PROTOCOL_VERSION}, client ${payload.protocol})`,
        true,
      );
      return;
    }

    if (typeof payload.token === 'string' && payload.token.length > 0) {
      const user = await verifyAccessToken(payload.token);
      if (!user) {
        connection.rejectUnauthorized('invalid or expired session');
        return;
      }
      await grantAdminIfListed(user.userId, user.email);
      const profile = await loadProfile(user.userId);
      if (!profile) {
        connection.rejectUnauthorized('profile not found for this account');
        return;
      }
      if (profile.banned) {
        connection.sendError(ErrorCode.Banned, profile.banReason ?? 'account banned', true);
        return;
      }
      connection.profileId = profile.id;
      connection.username = profile.username;
      connection.avatarUrl = profile.avatarUrl;
      connection.isGuest = false;
      connection.isAdmin = profile.isAdmin;
    } else {
      if (!config.allowGuests) {
        connection.rejectUnauthorized('this server requires a signed-in account');
        return;
      }
      connection.profileId = null;
      connection.isGuest = true;
      connection.isAdmin = false;
      connection.username =
        sanitizeUsername(payload.username) ?? `Guest-${String(guestCounter++).padStart(3, '0')}`;
      connection.avatarUrl = null;
    }

    connection.state = ConnectionState.Idle;
    connection.requestedTeam = payload.team === 2 ? 2 : payload.team === 1 ? 1 : 0;

    if (payload.create) {
      const created = this.rooms.createAdminLobby(connection, payload.create);
      if ('error' in created) {
        connection.sendError(created.error, describeJoinError(created.error), true);
        return;
      }
      if (connection.room !== created.room) created.room.addPlayer(connection);
      this.rooms.heartbeatNow();
      return;
    }

    if (!payload.roomId && !payload.roomCode) {
      connection.sendError(ErrorCode.RoomNotFound, describeJoinError('room_not_found'), true);
      return;
    }

    const result = this.rooms.findRoom({
      roomId: payload.roomId,
      roomCode: payload.roomCode,
      password: payload.password,
    });
    if ('error' in result) {
      connection.sendError(result.error, describeJoinError(result.error), true);
      return;
    }

    result.room.addPlayer(connection);
    this.rooms.heartbeatNow();
  }

  private handleInput(connection: Connection, data: Uint8Array): void {
    const room = connection.room;
    if (!room) return;
    const packet = decodeInputPacket(data);
    room.enqueueInput(connection.playerId, packet.commands, packet.ackSnapshotTick);
  }

  private handlePing(connection: Connection, data: Uint8Array): void {
    if (data.byteLength < 5) return;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const clientTime = view.getUint32(1, true);
    const room = connection.room;
    const serverTime = room ? room.serverTimeMs : 0;
    connection.send(encodePong(Op.Pong, clientTime, Math.round(serverTime)));
  }

  private handleSwitchWeapon(connection: Connection, data: Uint8Array): void {
    if (!connection.room) return;
    if (!connection.allowControlMessage()) return;
    const payload = decodeJsonBody<SwitchWeaponPayload>(data);
    if (typeof payload.slot !== 'number' || !Number.isInteger(payload.slot)) return;
    connection.room.requestWeaponSwitch(connection.playerId, payload.slot);
  }

  private handleChat(connection: Connection, data: Uint8Array): void {
    if (!connection.room) return;
    if (!connection.allowChat()) {
      connection.sendError(ErrorCode.RateLimited, 'slow down');
      return;
    }
    const payload = decodeJsonBody<ChatPayload>(data);
    const text = sanitizeChat(payload.text);
    if (!text) return;
    connection.room.handleChat(connection.playerId, text);
  }

  private async handleCreateRoom(connection: Connection, data: Uint8Array): Promise<void> {
    if (!connection.allowControlMessage()) return;
    if (connection.state === ConnectionState.Handshaking) {
      connection.sendError(ErrorCode.Unauthorized, 'say hello first');
      return;
    }
    const payload = decodeJsonBody<CreateRoomPayload>(data);
    const created = this.rooms.createAdminLobby(connection, payload.config ?? {});
    if ('error' in created) {
      connection.sendError(created.error, describeJoinError(created.error), true);
      return;
    }
    if (connection.room !== created.room) created.room.addPlayer(connection);
    this.rooms.heartbeatNow();
  }

  private handleStartMatch(connection: Connection): void {
    if (!connection.allowControlMessage()) return;
    const room = connection.room;
    if (!room) {
      connection.sendError(ErrorCode.NotInRoom, describeJoinError('not_in_room'));
      return;
    }
    if (!connection.isAdmin || !room.isHost(connection.playerId)) {
      connection.sendError(ErrorCode.NotAdmin, describeJoinError('not_admin'));
      return;
    }
    if (room.phase !== 'lobby') return;
    room.startMatch();
  }

  private async onClose(connection: Connection): Promise<void> {
    this.connections.delete(connection);
    connection.state = ConnectionState.Closing;
    await this.rooms.removePlayer(connection);
    log.debug('connection closed', { connection: connection.connectionId });
  }

  /** Update round-trip times and drop sockets that stopped talking to us. */
  private reapDeadConnections(): void {
    for (const connection of this.connections) {
      if (connection.room) {
        const entity = connection.room.getEntity(connection.playerId);
        if (entity) entity.pingMs = connection.pingMs;
      }
      if (connection.isTimedOut) {
        log.info('connection timed out', {
          connection: connection.connectionId,
          username: connection.username,
        });
        connection.close(4008, 'timeout');
        continue;
      }
      if (connection.socket.readyState === 1) {
        try {
          connection.notePingSent();
          connection.socket.ping();
        } catch {
          /* socket is going away anyway */
        }
      }
    }
  }

  async close(): Promise<void> {
    clearInterval(this.reaper);
    for (const connection of this.connections) connection.close(1001, 'server shutting down');
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

function clientIp(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return request.socket.remoteAddress ?? 'unknown';
}

function describeJoinError(code: string): string {
  switch (code) {
    case 'room_not_found':
      return 'Лобби не найдено. Проверьте код.';
    case 'room_full':
      return 'Лобби заполнено.';
    case 'room_closed':
      return 'Лобби закрыто.';
    case 'bad_password':
      return 'Неверный пароль лобби.';
    case 'not_admin':
      return 'Только администратор может создать лобби.';
    case 'already_in_room':
      return 'Вы уже находитесь в другом лобби.';
    case 'not_in_room':
      return 'Сначала войдите в лобби.';
    default:
      return 'Не удалось подключиться к лобби.';
  }
}

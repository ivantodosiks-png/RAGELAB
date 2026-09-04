import type { WebSocket } from 'ws';
import {
  ANTICHEAT_MAX_MESSAGE_RATE,
  CONNECTION_TIMEOUT_MS,
  ErrorCode,
  Op,
  encodeJson,
  type ErrorPayload,
  type KickedPayload,
  type OpCode,
} from '@ragelab/shared';
import { log } from '../logger';
import { TokenBucket } from './rateLimiter';
import type { Room } from '../rooms/room';

export const ConnectionState = {
  Handshaking: 0,
  Idle: 1,
  InRoom: 2,
  Closing: 3,
} as const;
export type ConnectionStateId = (typeof ConnectionState)[keyof typeof ConnectionState];

let nextConnectionId = 1;

/**
 * One WebSocket. Owns identity, rate limiting and liveness; gameplay lives in
 * the Room it is attached to.
 */
export class Connection {
  readonly connectionId = nextConnectionId++;
  readonly ip: string;
  readonly socket: WebSocket;

  state: ConnectionStateId = ConnectionState.Handshaking;

  profileId: string | null = null;
  username = 'Guest';
  avatarUrl: string | null = null;
  isGuest = true;
  isAdmin = false;
  requestedTeam = 0;

  room: Room | null = null;
  playerId = 0;

  /** Smoothed round-trip time in ms, measured with WebSocket ping/pong. */
  pingMs = 0;
  lastMessageAt = Date.now();
  private pingSentAt = 0;

  private readonly messageBucket = new TokenBucket(
    ANTICHEAT_MAX_MESSAGE_RATE * 2,
    ANTICHEAT_MAX_MESSAGE_RATE,
  );
  private readonly controlBucket = new TokenBucket(20, 6);
  private readonly chatBucket = new TokenBucket(4, 0.6);

  constructor(socket: WebSocket, ip: string) {
    this.socket = socket;
    this.ip = ip;
  }

  allowMessage(now = Date.now()): boolean {
    this.lastMessageAt = now;
    return this.messageBucket.take(1, now);
  }

  allowControlMessage(now = Date.now()): boolean {
    return this.controlBucket.take(1, now);
  }

  allowChat(now = Date.now()): boolean {
    return this.chatBucket.take(1, now);
  }

  get isTimedOut(): boolean {
    return Date.now() - this.lastMessageAt > CONNECTION_TIMEOUT_MS;
  }

  notePingSent(now = Date.now()): void {
    // Keep the oldest outstanding ping so a lost pong does not zero the RTT.
    if (this.pingSentAt === 0) this.pingSentAt = now;
  }

  notePong(now = Date.now()): void {
    this.lastMessageAt = now;
    if (this.pingSentAt === 0) return;
    const rtt = now - this.pingSentAt;
    this.pingSentAt = 0;
    this.pingMs = this.pingMs === 0 ? rtt : this.pingMs * 0.7 + rtt * 0.3;
  }

  attachToRoom(room: Room, playerId: number): void {
    this.room = room;
    this.playerId = playerId;
    this.state = ConnectionState.InRoom;
  }

  detachFromRoom(): void {
    this.room = null;
    this.playerId = 0;
    if (this.state === ConnectionState.InRoom) this.state = ConnectionState.Idle;
  }

  send(data: Uint8Array): void {
    if (this.socket.readyState !== 1) return;
    try {
      this.socket.send(data, { binary: true });
    } catch (err) {
      log.debug('send failed', { connection: this.connectionId, message: (err as Error).message });
    }
  }

  sendJson(op: OpCode, payload: unknown): void {
    this.send(encodeJson(op, payload));
  }

  sendError(code: string, message: string, fatal = false): void {
    const payload: ErrorPayload = { code, message, fatal };
    this.sendJson(Op.Error, payload);
    if (fatal) this.close(4000, code);
  }

  kick(reason: string): void {
    const payload: KickedPayload = { reason };
    this.sendJson(Op.Kicked, payload);
    log.warn('connection kicked', { connection: this.connectionId, username: this.username, reason });
    this.close(4001, reason);
  }

  close(code = 1000, reason = 'closed'): void {
    if (this.state === ConnectionState.Closing) return;
    this.state = ConnectionState.Closing;
    try {
      this.socket.close(code, reason.slice(0, 120));
    } catch {
      try {
        this.socket.terminate();
      } catch {
        /* already gone */
      }
    }
  }

  rejectUnauthorized(message: string): void {
    this.sendError(ErrorCode.Unauthorized, message, true);
  }
}

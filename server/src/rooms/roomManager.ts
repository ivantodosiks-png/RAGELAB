import type RAPIER from '@dimforge/rapier3d-compat';
import { randomInt } from 'node:crypto';
import {
  ABSOLUTE_MAX_PLAYERS_PER_ROOM,
  DEFAULT_MAP_ID,
  GameMode,
  LOBBY_CODE_ALPHABET,
  LOBBY_CODE_LENGTH,
  MIN_PLAYERS_PER_ROOM,
  RoomPhase,
  isLobbyCode,
  isMapId,
  normalizeLobbyCode,
  type RoomConfig,
  type RoomSummary,
} from '@ragelab/shared';
import { config } from '../config';
import { log } from '../logger';
import { Room } from './room';
import { ServerRegistry } from '../persistence/serverRegistry';
import { flushSession } from '../persistence/statsRecorder';
import type { Connection } from '../net/connection';

const ROSTER_INTERVAL_MS = 1000;
const HEARTBEAT_INTERVAL_MS = 10_000;

let roomCounter = 1;

/**
 * Owns every room plus the single fixed-step loop that drives them. One loop for
 * the whole process keeps timing consistent and avoids N interval timers
 * fighting for the event loop.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly registry = new ServerRegistry();

  private timer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;
  private accumulatorMs = 0;
  private rosterAccumulatorMs = 0;
  private heartbeatAccumulatorMs = 0;
  private running = false;

  constructor(private readonly rapier: typeof RAPIER) {}

  // ── room lifecycle ────────────────────────────────────────────────────────

  createRoom(partial: Partial<RoomConfig> = {}): Room {
    const mapId = isMapId(partial.mapId) ? partial.mapId! : DEFAULT_MAP_ID;
    const maxPlayers = Math.min(
      Math.max(partial.maxPlayers ?? config.maxPlayersPerRoom, MIN_PLAYERS_PER_ROOM),
      Math.min(config.maxPlayersPerRoom, ABSOLUTE_MAX_PLAYERS_PER_ROOM),
    );

    const id = `room-${roomCounter++}`;
    const roomConfig: RoomConfig = {
      name: (partial.name ?? `${config.name} #${roomCounter - 1}`).slice(0, 48),
      mapId,
      mode: partial.mode === GameMode.Deathmatch ? GameMode.Deathmatch : GameMode.Sandbox,
      maxPlayers,
      password: partial.password ? String(partial.password).slice(0, 64) : undefined,
      friendlyFire: partial.friendlyFire ?? true,
      scoreLimit: Math.max(0, Math.min(partial.scoreLimit ?? 0, 500)),
      timeLimitMs: Math.max(0, Math.min(partial.timeLimitMs ?? 0, 3_600_000)),
    };

    const room = new Room(id, roomConfig, this.rapier, this.allocateJoinCode());
    this.rooms.set(id, room);
    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  getRoomByCode(raw: string): Room | undefined {
    const code = normalizeLobbyCode(raw);
    if (!isLobbyCode(code)) return undefined;
    for (const room of this.rooms.values()) {
      if (room.joinCode === code) return room;
    }
    return undefined;
  }

  private allocateJoinCode(): string {
    for (let i = 0; i < 48; i++) {
      const code = this.secureLobbyCode();
      if (!this.getRoomByCode(code)) return code;
    }
    throw new Error('failed to allocate a unique lobby code');
  }

  private secureLobbyCode(): string {
    let out = '';
    for (let i = 0; i < LOBBY_CODE_LENGTH; i++) {
      out += LOBBY_CODE_ALPHABET[randomInt(LOBBY_CODE_ALPHABET.length)]!;
    }
    return out;
  }

  findHostedLobby(profileId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.dissolving || room.phase === RoomPhase.Closed) continue;
      if (!room.hostPlayerId) continue;
      const host = room.getEntity(room.hostPlayerId);
      if (host?.identity.profileId === profileId) return room;
    }
    return undefined;
  }

  listRooms(): RoomSummary[] {
    return [...this.rooms.values()].map((room) => room.summary());
  }

  /**
   * Join an existing lobby/match. Never creates a room — only an admin can
   * create via createAdminLobby.
   */
  findRoom(options: {
    roomId?: string;
    roomCode?: string;
    password?: string;
    mapId?: string;
    mode?: RoomConfig['mode'];
  }): { room: Room } | { error: 'room_not_found' | 'room_full' | 'bad_password' | 'room_closed' } {
    if (options.roomCode) {
      return this.evaluateJoin(this.getRoomByCode(options.roomCode), options.password);
    }
    if (options.roomId) {
      return this.evaluateJoin(this.rooms.get(options.roomId), options.password);
    }

    let best: Room | null = null;
    for (const room of this.rooms.values()) {
      if (room.dissolving || room.phase === RoomPhase.Closed) continue;
      if (room.isFull || room.config.password) continue;
      if (options.mapId && isMapId(options.mapId) && room.map.id !== options.mapId) continue;
      if (options.mode && room.config.mode !== options.mode) continue;
      if (!best || room.playerCount > best.playerCount) best = room;
    }
    if (best) return { room: best };
    return { error: 'room_not_found' };
  }

  /** @deprecated Use findRoom — kept so older call sites compile during the cutover. */
  findOrCreateRoom(options: {
    roomId?: string;
    roomCode?: string;
    password?: string;
    mapId?: string;
    mode?: RoomConfig['mode'];
  }): { room: Room } | { error: 'room_not_found' | 'room_full' | 'bad_password' | 'room_closed' } {
    return this.findRoom(options);
  }

  private evaluateJoin(
    room: Room | undefined,
    password?: string,
  ): { room: Room } | { error: 'room_not_found' | 'room_full' | 'bad_password' | 'room_closed' } {
    if (!room) return { error: 'room_not_found' };
    if (room.dissolving || room.phase === RoomPhase.Closed) return { error: 'room_closed' };
    if (room.config.password && room.config.password !== password) return { error: 'bad_password' };
    if (room.isFull) return { error: 'room_full' };
    return { room };
  }

  createAdminLobby(
    connection: Connection,
    partial: Partial<RoomConfig> = {},
  ): { room: Room } | { error: 'not_admin' | 'already_in_room' } {
    if (!connection.isAdmin) return { error: 'not_admin' };

    if (connection.profileId) {
      const hosted = this.findHostedLobby(connection.profileId);
      if (hosted && hosted.phase === RoomPhase.Lobby && !hosted.dissolving) {
        if (connection.room === hosted) return { room: hosted };
        hosted.removePlayerByProfile(connection.profileId, connection);
        if (connection.room && connection.room !== hosted) return { error: 'already_in_room' };
        return { room: hosted };
      }
    }

    if (connection.room) return { error: 'already_in_room' };
    return { room: this.createRoom(partial) };
  }

  async removePlayer(connection: Connection): Promise<void> {
    const room = connection.room;
    if (!room || !connection.playerId) return;

    if (!room.dissolving && room.isHost(connection.playerId) && room.playerCount > 1) {
      await this.dissolveRoom(room, 'Host left — session ended', connection);
      return;
    }

    const entity = room.removePlayer(connection.playerId);
    connection.detachFromRoom();
    if (entity) {
      await flushSession(entity, room.serverTimeMs, true);
    }

    if (room.isEmpty && !room.dissolving) {
      this.disposeRoom(room);
      void this.registry.heartbeat(this.listedRooms());
    }
  }

  /**
   * Host left while others were still in: kick everyone, drop the room, and
   * unlist it immediately. No host migration.
   */
  private async dissolveRoom(room: Room, reason: string, hostConnection: Connection): Promise<void> {
    room.dissolving = true;
    room.closeLobby();
    log.info('host left, ending session', { room: room.id, reason, players: room.playerCount });

    const snapshot = room.playerConnections();
    for (const member of snapshot) {
      const entity = room.removePlayer(member.playerId);
      member.connection.detachFromRoom();
      if (entity) await flushSession(entity, room.serverTimeMs, true);
    }
    this.disposeRoom(room);

    for (const member of snapshot) {
      if (member.connection !== hostConnection) member.connection.kick(reason);
    }
    void this.registry.heartbeat(this.listedRooms());
  }

  private disposeRoom(room: Room): void {
    room.dispose();
    this.rooms.delete(room.id);
  }

  /** Occupied rooms only — empty warm rooms must not show up as joinable hosts. */
  listedRooms(): RoomSummary[] {
    return this.listRooms().filter((room) => room.playerCount > 0);
  }

  heartbeatNow(): void {
    void this.registry.heartbeat(this.listedRooms());
  }

  // ── the loop ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTickAt = performance.now();
    const stepMs = 1000 / config.tickRate;

    // setInterval at half the step, with an accumulator, keeps the simulation
    // rate stable even when the event loop is briefly blocked.
    this.timer = setInterval(() => this.pump(stepMs), Math.max(2, Math.floor(stepMs / 2)));
    log.info('simulation loop started', { tickRate: config.tickRate, stepMs });
  }

  private pump(stepMs: number): void {
    const now = performance.now();
    let elapsed = now - this.lastTickAt;
    this.lastTickAt = now;
    // A long stall (GC, sleep, debugger) must not produce a burst of catch-up
    // ticks; drop the excess time instead.
    if (elapsed > 250) elapsed = 250;
    this.accumulatorMs += elapsed;

    let steps = 0;
    while (this.accumulatorMs >= stepMs && steps < 6) {
      this.accumulatorMs -= stepMs;
      steps += 1;
      for (const room of this.rooms.values()) {
        try {
          room.step(stepMs);
        } catch (err) {
          log.error('room tick failed', {
            room: room.id,
            message: (err as Error).message,
            stack: (err as Error).stack?.split('\n').slice(0, 4).join(' | '),
          });
        }
      }
    }
    if (steps === 0) return;

    const advanced = steps * stepMs;
    this.rosterAccumulatorMs += advanced;
    this.heartbeatAccumulatorMs += advanced;

    if (this.rosterAccumulatorMs >= ROSTER_INTERVAL_MS) {
      this.rosterAccumulatorMs = 0;
      for (const room of this.rooms.values()) room.broadcastRoster();
    }

    if (this.heartbeatAccumulatorMs >= HEARTBEAT_INTERVAL_MS) {
      this.heartbeatAccumulatorMs = 0;
      void this.registry.heartbeat(this.listedRooms());
      this.reapEmptyRooms();
    }
  }

  private reapEmptyRooms(): void {
    for (const room of [...this.rooms.values()]) {
      if (room.isEmpty && !room.dissolving) this.disposeRoom(room);
    }
  }

  async shutdown(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.registry.unregisterAll();
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }
}

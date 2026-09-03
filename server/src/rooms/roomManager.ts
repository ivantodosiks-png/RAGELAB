import type RAPIER from '@dimforge/rapier3d-compat';
import {
  ABSOLUTE_MAX_PLAYERS_PER_ROOM,
  DEFAULT_MAP_ID,
  GameMode,
  MIN_PLAYERS_PER_ROOM,
  isLobbyCode,
  isMapId,
  normalizeLobbyCode,
  randomLobbyCode,
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
    for (let i = 0; i < 24; i++) {
      const code = randomLobbyCode();
      if (!this.getRoomByCode(code)) return code;
    }
    return randomLobbyCode();
  }

  listRooms(): RoomSummary[] {
    return [...this.rooms.values()].map((room) => room.summary());
  }

  /** Join an explicit room, or the emptiest joinable one, creating if needed. */
  findOrCreateRoom(options: {
    roomId?: string;
    roomCode?: string;
    password?: string;
    mapId?: string;
    mode?: RoomConfig['mode'];
  }): { room: Room } | { error: 'room_not_found' | 'room_full' | 'bad_password' } {
    if (options.roomCode) {
      const room = this.getRoomByCode(options.roomCode);
      if (!room) return { error: 'room_not_found' };
      if (room.config.password && room.config.password !== options.password) {
        return { error: 'bad_password' };
      }
      if (room.isFull) return { error: 'room_full' };
      return { room };
    }
    if (options.roomId) {
      const room = this.rooms.get(options.roomId);
      if (!room) return { error: 'room_not_found' };
      if (room.config.password && room.config.password !== options.password) {
        return { error: 'bad_password' };
      }
      if (room.isFull) return { error: 'room_full' };
      return { room };
    }

    let best: Room | null = null;
    for (const room of this.rooms.values()) {
      if (room.isFull || room.config.password) continue;
      if (options.mapId && isMapId(options.mapId) && room.map.id !== options.mapId) continue;
      if (options.mode && room.config.mode !== options.mode) continue;
      // Prefer the fullest non-full room so players actually meet each other.
      if (!best || room.playerCount > best.playerCount) best = room;
    }
    if (best) return { room: best };

    return {
      room: this.createRoom({
        mapId: options.mapId,
        mode: options.mode,
      }),
    };
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

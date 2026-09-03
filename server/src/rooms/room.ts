import type RAPIER from '@dimforge/rapier3d-compat';
import {
  ByteWriter,
  Button,
  FALL_DAMAGE_MIN_SPEED,
  FALL_DAMAGE_PER_SPEED,
  INTEREST_RADIUS_SQ,
  MAX_INPUTS_PER_PACKET,
  Op,
  PROTOCOL_VERSION,
  PlayerFlag,
  RESPAWN_DELAY_MS,
  buttonDown,
  buttonPressed,
  canReload,
  completeReload,
  decaySpread,
  distanceSq,
  encodeJson,
  encodeSnapshot,
  evaluateFire,
  FireDenyReason,
  getMap,
  getWeapon,
  isWeaponId,
  maxSpeedFor,
  msPerShot,
  playerSpawns,
  reloadDurationMs,
  stepMovement,
  ANTICHEAT_FIRE_RATE_GRACE_MS,
  type EventsPayload,
  type GameEvent,
  type InputCommand,
  type MapDefinition,
  type PlayerIdentity,
  type PlayerScore,
  type QuantPlayer,
  type QuantProp,
  type LobbyStatePayload,
  type RoomConfig,
  RoomPhase,
  type RoomPhaseId,
  type RoomSummary,
  type RosterPayload,
  type StepEvents,
  type Vec3,
  type WelcomePayload,
  type WorldSnapshot,
} from '@ragelab/shared';
import { config } from '../config';
import { log } from '../logger';
import type { Connection } from '../net/connection';
import { PlayerEntity, createSessionStats } from '../game/playerEntity';
import { GameWorld } from '../game/world';
import { LagCompensator } from '../game/lagCompensation';
import {
  applyDamage,
  eyePosition,
  grantSpawnProtection,
  killPlayer,
  resolveExplosion,
  resolveShot,
  type CombatContext,
  type EventSink,
} from '../game/combat';
import {
  dropCarried,
  handleInteract,
  updateCarriedProp,
  updatePickups,
} from '../game/interaction';
import {
  Violation,
  decayViolations,
  flagViolation,
  validateInputCommand,
  validateMovementResult,
} from '../validation/antiCheat';

interface RoomPlayer {
  entity: PlayerEntity;
  connection: Connection;
  inputQueue: InputCommand[];
  /** Exact snapshot last sent to this client; used as the delta baseline. */
  lastSentSnapshot: WorldSnapshot | null;
  visiblePlayers: Set<number>;
  visibleProps: Set<number>;
  pendingEvents: GameEvent[];
  writer: ByteWriter;
  /** Round-robin spawn cursor so consecutive spawns spread out. */
  lastSpawnIndex: number;
}

const MAX_QUEUED_INPUTS = MAX_INPUTS_PER_PACKET * 6;
const TIME_BUDGET_CEILING_MS = 120;
/** Allow 15% more simulated time than real time to absorb jitter. */
const TIME_BUDGET_SCALE = 1.15;

const stepEvents: StepEvents = {
  jumped: false,
  landed: false,
  landingSpeed: 0,
  footstep: false,
};
const scratchEye: Vec3 = { x: 0, y: 0, z: 0 };

export class Room {
  readonly id: string;
  readonly joinCode: string;
  readonly config: RoomConfig;
  readonly map: MapDefinition;
  readonly world: GameWorld;
  readonly createdAt = Date.now();

  private readonly players = new Map<number, RoomPlayer>();
  private readonly entities = new Map<number, PlayerEntity>();
  private readonly lagComp = new LagCompensator();
  private readonly rapier: typeof RAPIER;

  private nextPlayerId = 1;
  private tick = 0;
  private snapshotAccumulatorMs = 0;
  private timeMs = 0;
  private spawnCursor = 0;
  private matchEndsAt = 0;
  private tickDurationMs = 0;
  /** First player in (or the creator) — when they leave the match ends. */
  hostPlayerId: number | null = null;
  dissolving = false;
  phase: RoomPhaseId = RoomPhase.Lobby;

  /** Events queued this tick: broadcast plus per-player. */
  private broadcastEvents: GameEvent[] = [];
  private readonly eventSink: EventSink;
  private readonly combat: CombatContext;

  constructor(id: string, roomConfig: RoomConfig, rapier: typeof RAPIER, joinCode: string) {
    this.id = id;
    this.config = roomConfig;
    this.joinCode = joinCode;
    this.rapier = rapier;
    this.map = getMap(roomConfig.mapId);
    this.world = new GameWorld(rapier, this.map);
    this.matchEndsAt = roomConfig.timeLimitMs > 0 ? roomConfig.timeLimitMs : 0;

    this.eventSink = {
      broadcast: (event) => this.broadcastEvents.push(event),
      to: (playerId, event) => {
        const p = this.players.get(playerId);
        if (p) p.pendingEvents.push(event);
      },
    };

    this.combat = {
      world: this.world,
      players: this.entities,
      lagComp: this.lagComp,
      events: this.eventSink,
      nowMs: 0,
      friendlyFire: roomConfig.friendlyFire,
      onKill: (victim) => {
        dropCarried(this.world, victim, this.eventSink, false);
      },
    };

    log.info('room created', {
      room: this.id,
      code: this.joinCode,
      map: this.map.id,
      mode: roomConfig.mode,
      maxPlayers: roomConfig.maxPlayers,
    });
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  get playerCount(): number {
    return this.players.size;
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }

  get isFull(): boolean {
    return this.players.size >= this.config.maxPlayers;
  }

  get serverTimeMs(): number {
    return this.timeMs;
  }

  summary(): RoomSummary {
    return {
      id: this.id,
      name: this.config.name,
      mapId: this.map.id,
      mode: this.config.mode,
      phase: this.dissolving ? RoomPhase.Closed : this.phase,
      playerCount: this.players.size,
      maxPlayers: this.config.maxPlayers,
      hasPassword: Boolean(this.config.password),
      region: config.region,
      tickMs: Math.round(this.tickDurationMs * 100) / 100,
      createdAt: this.createdAt,
      wsUrl: config.publicWsUrl || undefined,
      joinCode: this.joinCode,
    };
  }

  isHost(playerId: number): boolean {
    return this.hostPlayerId === playerId;
  }

  playerConnections(): Array<{ playerId: number; connection: Connection }> {
    const out: Array<{ playerId: number; connection: Connection }> = [];
    for (const [playerId, member] of this.players) {
      out.push({ playerId, connection: member.connection });
    }
    return out;
  }

  addPlayer(connection: Connection): PlayerEntity {
    const id = this.nextPlayerId++;
    const spawn = this.pickSpawn();

    const identity: PlayerIdentity = {
      id,
      profileId: connection.profileId,
      username: connection.username,
      avatarUrl: connection.avatarUrl,
      isGuest: connection.isGuest,
      team: 0,
    };

    const entity = new PlayerEntity(
      id,
      identity,
      this.rapier,
      this.world.world,
      spawn.position,
      spawn.yaw,
      this.timeMs,
    );
    entity.stats = createSessionStats(this.timeMs);
    grantSpawnProtection(entity, this.timeMs);

    const roomPlayer: RoomPlayer = {
      entity,
      connection,
      inputQueue: [],
      lastSentSnapshot: null,
      visiblePlayers: new Set(),
      visibleProps: new Set(),
      pendingEvents: [],
      writer: new ByteWriter(4096),
      lastSpawnIndex: this.spawnCursor,
    };

    this.players.set(id, roomPlayer);
    this.entities.set(id, entity);
    connection.attachToRoom(this, id);
    if (this.hostPlayerId === null) this.hostPlayerId = id;

    const welcome: WelcomePayload = {
      protocol: PROTOCOL_VERSION,
      playerId: id,
      profile: connection.profileId
        ? {
            id: connection.profileId,
            username: connection.username,
            avatarUrl: connection.avatarUrl,
          }
        : null,
      room: {
        id: this.id,
        name: this.config.name,
        mapId: this.map.id,
        mode: this.config.mode,
        maxPlayers: this.config.maxPlayers,
        joinCode: this.joinCode,
        host: this.hostPlayerId === id,
        wsUrl: config.publicWsUrl || undefined,
        phase: this.phase,
      },
      tickRate: config.tickRate,
      snapshotRate: config.snapshotRate,
      serverTimeMs: this.timeMs,
      players: this.identities(),
      scores: this.scores(),
      loadout: entity.loadout,
      worldState: {
        doorsOpen: this.world.doors.filter((d) => d.target > 0.5).map((d) => d.def.id),
        switchesOn: [...this.world.switches.entries()]
          .filter(([, s]) => s.on)
          .map(([switchId]) => switchId),
        pickupsTaken: [...this.world.pickups.entries()]
          .filter(([, s]) => !s.available)
          .map(([pickupId]) => pickupId),
      },
    };
    connection.sendJson(Op.Welcome, welcome);

    this.broadcastEvents.push({ t: 'join', p: id, name: identity.username });
    this.broadcastRoster();
    this.broadcastLobbyState();

    log.info('player joined room', {
      room: this.id,
      player: id,
      username: identity.username,
      guest: identity.isGuest,
      host: this.hostPlayerId === id,
      players: this.players.size,
    });
    return entity;
  }

  removePlayer(playerId: number): PlayerEntity | null {
    const roomPlayer = this.players.get(playerId);
    if (!roomPlayer) return null;

    dropCarried(this.world, roomPlayer.entity, this.eventSink, false);
    this.players.delete(playerId);
    this.entities.delete(playerId);
    roomPlayer.entity.dispose();

    this.broadcastEvents.push({
      t: 'leave',
      p: playerId,
      name: roomPlayer.entity.identity.username,
    });
    if (this.hostPlayerId === playerId) this.hostPlayerId = null;
    this.broadcastRoster();
    this.broadcastLobbyState();

    log.info('player left room', {
      room: this.id,
      player: playerId,
      players: this.players.size,
    });
    return roomPlayer.entity;
  }

  getEntity(playerId: number): PlayerEntity | undefined {
    return this.entities.get(playerId);
  }

  // ── input intake (called from the network layer) ───────────────────────────

  enqueueInput(playerId: number, commands: InputCommand[], ackSnapshotTick: number): void {
    const roomPlayer = this.players.get(playerId);
    if (!roomPlayer) return;
    roomPlayer.entity.ackSnapshotTick = ackSnapshotTick;

    for (const command of commands) {
      if (command.seq <= roomPlayer.entity.lastProcessedSeq) continue;
      roomPlayer.inputQueue.push(command);
    }

    if (roomPlayer.inputQueue.length > MAX_QUEUED_INPUTS) {
      const overflow = roomPlayer.inputQueue.length - MAX_QUEUED_INPUTS;
      roomPlayer.inputQueue.splice(0, overflow);
      if (flagViolation(roomPlayer.entity, { kind: Violation.InputFlood }, this.timeMs)) {
        roomPlayer.connection.kick('input flood');
      }
    }
  }

  requestWeaponSwitch(playerId: number, slot: number): void {
    const entity = this.entities.get(playerId);
    if (!entity || !entity.alive) return;
    this.switchWeapon(entity, slot);
  }

  requestRespawn(playerId: number): void {
    const entity = this.entities.get(playerId);
    if (!entity || entity.alive) return;
    if (this.timeMs < entity.respawnAt) return;
    this.respawn(entity);
  }

  handleChat(playerId: number, text: string): void {
    const entity = this.entities.get(playerId);
    if (!entity) return;
    this.broadcastEvents.push({
      t: 'chat',
      p: playerId,
      name: entity.identity.username,
      msg: text,
    });
  }

  startMatch(): boolean {
    if (this.dissolving || this.phase !== RoomPhase.Lobby) return false;
    this.phase = RoomPhase.Playing;
    this.broadcastEvents.push({ t: 'matchStart' });
    this.broadcastLobbyState();
    this.broadcastRoster();
    this.flushEvents();
    log.info('match started', { room: this.id, code: this.joinCode, players: this.players.size });
    return true;
  }

  closeLobby(): void {
    this.phase = RoomPhase.Closed;
    this.broadcastLobbyState();
  }

  lobbyState(): LobbyStatePayload {
    return {
      phase: this.dissolving ? RoomPhase.Closed : this.phase,
      joinCode: this.joinCode,
      hostPlayerId: this.hostPlayerId,
      mapId: this.map.id,
      name: this.config.name,
      maxPlayers: this.config.maxPlayers,
      players: this.identities(),
    };
  }

  broadcastLobbyState(): void {
    const data = encodeJson(Op.LobbyState, this.lobbyState());
    for (const roomPlayer of this.players.values()) roomPlayer.connection.send(data);
  }

  removePlayerByProfile(profileId: string, exceptConnection?: Connection): PlayerEntity | null {
    for (const [playerId, member] of this.players) {
      if (member.entity.identity.profileId !== profileId) continue;
      if (exceptConnection && member.connection === exceptConnection) continue;
      member.connection.detachFromRoom();
      const entity = this.removePlayer(playerId);
      member.connection.kick('Сессия лобби открыта на другом устройстве.');
      return entity;
    }
    return null;
  }

  // ── tick ──────────────────────────────────────────────────────────────────

  step(dtMs: number): void {
    if (this.phase !== RoomPhase.Playing) {
      this.timeMs += dtMs;
      return;
    }
    const started = performance.now();
    this.timeMs += dtMs;
    const dtSec = dtMs / 1000;
    this.tick += 1;
    this.combat.nowMs = this.timeMs;

    for (const roomPlayer of this.players.values()) {
      this.consumeInputs(roomPlayer, dtMs);
      decayViolations(roomPlayer.entity, dtSec);
      updateCarriedProp(this.world, roomPlayer.entity, dtSec);
    }

    const worldChanges = this.world.step(dtSec, this.timeMs);

    for (const doorId of worldChanges.doorsChanged) {
      const door = this.world.getDoor(doorId);
      if (door) this.broadcastEvents.push({ t: 'door', id: doorId, open: door.target > 0.5 });
    }
    for (const switchId of worldChanges.switchesReset) {
      this.broadcastEvents.push({ t: 'switch', id: switchId, on: false });
    }
    for (const pickupId of worldChanges.pickupsRespawned) {
      this.broadcastEvents.push({ t: 'pickupRespawn', id: pickupId });
    }

    for (const broken of this.world.brokenThisTick) {
      this.broadcastEvents.push({
        t: 'propBreak',
        id: broken.id,
        pos: [broken.position.x, broken.position.y, broken.position.z],
        kind: broken.kind,
      });
    }
    this.world.brokenThisTick.length = 0;

    // Explosions can chain, so drain until the queue settles (bounded).
    for (let guard = 0; guard < 12 && this.world.pendingExplosions.length > 0; guard++) {
      const blasts = this.world.pendingExplosions.splice(0, this.world.pendingExplosions.length);
      for (const blast of blasts) resolveExplosion(this.combat, blast);
      for (const broken of this.world.brokenThisTick) {
        this.broadcastEvents.push({
          t: 'propBreak',
          id: broken.id,
          pos: [broken.position.x, broken.position.y, broken.position.z],
          kind: broken.kind,
        });
      }
      this.world.brokenThisTick.length = 0;
    }

    updatePickups(this.world, this.entities.values(), this.eventSink, this.timeMs);

    this.checkKillPlane();
    this.processRespawns();
    this.checkMatchEnd();

    this.lagComp.record(this.tick, this.timeMs, this.entities.values());

    this.snapshotAccumulatorMs += dtMs;
    const snapshotInterval = 1000 / config.snapshotRate;
    if (this.snapshotAccumulatorMs >= snapshotInterval) {
      this.snapshotAccumulatorMs -= snapshotInterval;
      if (this.snapshotAccumulatorMs > snapshotInterval) this.snapshotAccumulatorMs = 0;
      this.sendSnapshots();
    }

    this.tickDurationMs = this.tickDurationMs * 0.9 + (performance.now() - started) * 0.1;
  }

  private consumeInputs(roomPlayer: RoomPlayer, dtMs: number): void {
    const entity = roomPlayer.entity;
    entity.timeBudgetMs = Math.min(
      entity.timeBudgetMs + dtMs * TIME_BUDGET_SCALE,
      TIME_BUDGET_CEILING_MS,
    );

    while (roomPlayer.inputQueue.length > 0) {
      const command = roomPlayer.inputQueue[0]!;
      if (command.dtMs > entity.timeBudgetMs) break;
      roomPlayer.inputQueue.shift();
      entity.timeBudgetMs -= command.dtMs;
      this.processInput(roomPlayer, command);
    }
  }

  private processInput(roomPlayer: RoomPlayer, command: InputCommand): void {
    const entity = roomPlayer.entity;

    const violation = validateInputCommand(command, entity);
    if (violation) {
      if (violation !== Violation.SequenceReplay) {
        if (flagViolation(entity, { kind: violation, detail: { seq: command.seq } }, this.timeMs)) {
          roomPlayer.connection.kick('anti-cheat');
        }
      }
      return;
    }

    entity.lastProcessedSeq = command.seq;
    entity.lastInput = command;
    entity.yaw = command.yaw;
    entity.pitch = command.pitch;
    entity.aiming = buttonDown(command.buttons, Button.Aim);

    if (!entity.alive) {
      entity.previousButtons = command.buttons;
      return;
    }

    if (command.weaponSlot !== entity.currentSlot) {
      this.switchWeapon(entity, command.weaponSlot);
    }

    const def = getWeapon(entity.weaponId);
    const dtSec = command.dtMs / 1000;

    stepMovement(entity.movement, command, entity.character, def.moveSpeedMultiplier, stepEvents);

    const movementViolation = validateMovementResult(
      entity,
      dtSec,
      maxSpeedFor(command, entity.movement.crouching, def.moveSpeedMultiplier),
    );
    if (movementViolation) {
      if (flagViolation(entity, { kind: movementViolation }, this.timeMs)) {
        roomPlayer.connection.kick('anti-cheat');
      }
      if (movementViolation === Violation.OutOfBounds) {
        this.respawn(entity);
        entity.previousButtons = command.buttons;
        return;
      }
      // Clamp the horizontal velocity back into legal territory.
      const speed = Math.hypot(entity.movement.velocity.x, entity.movement.velocity.z);
      const cap = maxSpeedFor(command, entity.movement.crouching, def.moveSpeedMultiplier);
      if (speed > cap && speed > 0) {
        const scale = cap / speed;
        entity.movement.velocity.x *= scale;
        entity.movement.velocity.z *= scale;
      }
    }

    const pos = entity.movement.position;
    if (stepEvents.jumped) {
      this.broadcastEvents.push({ t: 'jump', p: entity.id, pos: [pos.x, pos.y, pos.z] });
    }
    if (stepEvents.landed) {
      this.broadcastEvents.push({
        t: 'land',
        p: entity.id,
        pos: [pos.x, pos.y, pos.z],
        v: Math.round(stepEvents.landingSpeed * 10) / 10,
      });
      if (stepEvents.landingSpeed > FALL_DAMAGE_MIN_SPEED) {
        const damage = (stepEvents.landingSpeed - FALL_DAMAGE_MIN_SPEED) * FALL_DAMAGE_PER_SPEED;
        applyDamage(this.combat, entity, damage, null, 'fall', false, { x: 0, y: 1, z: 0 });
      }
    }

    const weapon = entity.weapon;
    decaySpread(weapon, def, dtSec);

    if (weapon.reloadEndsAt > 0 && this.timeMs >= weapon.reloadEndsAt) {
      completeReload(weapon, def);
      weapon.reloadEndsAt = 0;
    }

    const reloadPressed = buttonPressed(command.buttons, entity.previousButtons, Button.Reload);
    if (reloadPressed && canReload(weapon, def, this.timeMs)) {
      const ms = reloadDurationMs(def, weapon.ammoInMag);
      weapon.reloadEndsAt = this.timeMs + ms;
      this.broadcastEvents.push({ t: 'reload', p: entity.id, w: def.id, ms });
    }

    if (buttonPressed(command.buttons, entity.previousButtons, Button.Interact)) {
      handleInteract(this.world, entity, this.eventSink, this.timeMs);
    }
    if (buttonPressed(command.buttons, entity.previousButtons, Button.Drop)) {
      dropCarried(this.world, entity, this.eventSink, false);
    }

    const firePressed = buttonPressed(command.buttons, entity.previousButtons, Button.Fire);
    const fireHeld = buttonDown(command.buttons, Button.Fire);

    if (entity.carrying !== null) {
      // While carrying a prop the fire button throws it instead of shooting.
      if (firePressed) dropCarried(this.world, entity, this.eventSink, true);
    } else if (fireHeld || firePressed) {
      const verdict = evaluateFire(
        weapon,
        def,
        this.timeMs,
        firePressed,
        fireHeld,
        ANTICHEAT_FIRE_RATE_GRACE_MS,
      );
      if (verdict === FireDenyReason.Ok) {
        resolveShot(this.combat, entity);
      } else if (verdict === FireDenyReason.NoAmmo && firePressed) {
        // Auto-reload on an empty trigger pull, like modern shooters.
        if (canReload(weapon, def, this.timeMs)) {
          const ms = reloadDurationMs(def, weapon.ammoInMag);
          weapon.reloadEndsAt = this.timeMs + ms;
          this.broadcastEvents.push({ t: 'reload', p: entity.id, w: def.id, ms });
        }
      } else if (verdict === FireDenyReason.Cooldown && firePressed) {
        // A client spamming fire faster than the weapon allows is suspicious
        // only when it happens persistently, hence the low weight.
        const interval = msPerShot(def);
        if (this.timeMs - weapon.lastShotAt < interval * 0.5) {
          if (flagViolation(entity, { kind: Violation.FireRate }, this.timeMs)) {
            roomPlayer.connection.kick('anti-cheat');
          }
        }
      }
    }

    entity.previousButtons = command.buttons;
  }

  private switchWeapon(entity: PlayerEntity, slot: number): void {
    if (slot < 0 || slot >= entity.loadout.length) return;
    if (slot === entity.currentSlot) return;
    const weaponId = entity.loadout[slot];
    if (!weaponId || !isWeaponId(weaponId)) return;

    entity.currentSlot = slot;
    const def = getWeapon(weaponId);
    const state = entity.weapon;
    state.equipEndsAt = this.timeMs + def.equipMs;
    state.reloadEndsAt = 0;
    state.burstRemaining = 0;
    state.spread = def.spread.base;
    this.broadcastEvents.push({ t: 'equip', p: entity.id, w: def.id });
  }

  private checkKillPlane(): void {
    for (const entity of this.entities.values()) {
      if (!entity.alive) continue;
      if (entity.movement.position.y > this.map.killPlaneY) continue;
      killPlayer(this.combat, entity, entity.killedBy, 'void', false);
    }
  }

  private processRespawns(): void {
    for (const entity of this.entities.values()) {
      if (entity.alive || entity.respawnAt === 0) continue;
      // Auto-respawn shortly after the manual window opens so a disconnected
      // input loop never leaves a corpse lying around forever.
      if (this.timeMs >= entity.respawnAt + RESPAWN_DELAY_MS) this.respawn(entity);
    }
  }

  private respawn(entity: PlayerEntity): void {
    const spawn = this.pickSpawn();
    entity.resetForRespawn(spawn.position, spawn.yaw, this.timeMs);
    grantSpawnProtection(entity, this.timeMs);
    this.broadcastEvents.push({
      t: 'respawn',
      p: entity.id,
      pos: [spawn.position.x, spawn.position.y, spawn.position.z],
      yaw: spawn.yaw,
    });
  }

  /** Pick the spawn point furthest from every living player. */
  private pickSpawn(): { position: Vec3; yaw: number } {
    const points = playerSpawns(this.map);
    let best = points[this.spawnCursor % points.length]!;
    let bestScore = -Infinity;

    for (let i = 0; i < points.length; i++) {
      const candidate = points[(this.spawnCursor + i) % points.length]!;
      const pos = {
        x: candidate.position[0],
        y: candidate.position[1],
        z: candidate.position[2],
      };
      let nearest = Infinity;
      for (const entity of this.entities.values()) {
        if (!entity.alive) continue;
        nearest = Math.min(nearest, distanceSq(pos, entity.movement.position));
      }
      // Small deterministic jitter breaks ties without randomising spawns.
      const score = (nearest === Infinity ? 1e6 : nearest) + i * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    this.spawnCursor = (this.spawnCursor + 1) % points.length;
    return {
      position: { x: best.position[0], y: best.position[1], z: best.position[2] },
      yaw: best.yaw,
    };
  }

  private checkMatchEnd(): void {
    if (this.config.scoreLimit <= 0 && this.matchEndsAt === 0) return;

    let leader: PlayerEntity | null = null;
    for (const entity of this.entities.values()) {
      if (!leader || entity.stats.kills > leader.stats.kills) leader = entity;
    }

    const scoreReached =
      this.config.scoreLimit > 0 && leader !== null && leader.stats.kills >= this.config.scoreLimit;
    const timeReached = this.matchEndsAt > 0 && this.timeMs >= this.matchEndsAt;
    if (!scoreReached && !timeReached) return;

    this.broadcastEvents.push({ t: 'matchEnd', winner: leader ? leader.id : null });
    for (const entity of this.entities.values()) {
      entity.stats.kills = 0;
      entity.stats.deaths = 0;
      entity.stats.score = 0;
      entity.stats.killstreak = 0;
    }
    this.matchEndsAt = this.config.timeLimitMs > 0 ? this.timeMs + this.config.timeLimitMs : 0;
    this.broadcastRoster();
  }

  // ── replication ───────────────────────────────────────────────────────────

  private buildSnapshot(): WorldSnapshot {
    const players = new Map<number, QuantPlayer>();
    for (const entity of this.entities.values()) {
      let extraFlags = 0;
      const weapon = entity.weapon;
      if (weapon.reloadEndsAt > this.timeMs) extraFlags |= PlayerFlag.Reloading;
      if (entity.aiming) extraFlags |= PlayerFlag.Aiming;
      if (entity.lastInput && buttonDown(entity.lastInput.buttons, Button.Fire)) {
        extraFlags |= PlayerFlag.Firing;
      }
      if (entity.lastInput && buttonDown(entity.lastInput.buttons, Button.Sprint)) {
        extraFlags |= PlayerFlag.Sprinting;
      }
      entity.refreshQuant(extraFlags);
      players.set(entity.id, { ...entity.quant });
    }

    this.world.refreshPropTransforms();
    const props = new Map<number, QuantProp>();
    for (const prop of this.world.props.values()) {
      if (prop.destroyed) continue;
      props.set(prop.id, { ...prop.quant });
    }

    const doors: number[] = [];
    this.world.doorProgressBytes(doors);

    return { tick: this.tick, timeMs: this.timeMs, ackSeq: 0, players, props, doors };
  }

  private flushEvents(): void {
    if (this.broadcastEvents.length === 0) return;
    for (const roomPlayer of this.players.values()) {
      const events = roomPlayer.pendingEvents.length
        ? [...this.broadcastEvents, ...roomPlayer.pendingEvents]
        : this.broadcastEvents;
      const eventsPayload: EventsPayload = { tick: this.tick, events };
      roomPlayer.connection.send(encodeJson(Op.Events, eventsPayload));
      roomPlayer.pendingEvents.length = 0;
    }
    this.broadcastEvents.length = 0;
  }

  private sendSnapshots(): void {
    if (this.players.size === 0) {
      this.broadcastEvents.length = 0;
      return;
    }

    const snapshot = this.buildSnapshot();

    for (const roomPlayer of this.players.values()) {
      const entity = roomPlayer.entity;
      const origin = entity.movement.position;

      const visiblePlayers = new Set<number>();
      for (const other of this.entities.values()) {
        if (other.id === entity.id || distanceSq(origin, other.movement.position) <= INTEREST_RADIUS_SQ) {
          visiblePlayers.add(other.id);
        }
      }

      const visibleProps = new Set<number>();
      for (const prop of this.world.props.values()) {
        if (prop.destroyed) continue;
        const t = prop.quant;
        // Compare in quantized space to avoid touching the physics body again.
        const dx = t.px / 64 - origin.x;
        const dz = t.pz / 64 - origin.z;
        if (dx * dx + dz * dz <= INTEREST_RADIUS_SQ) visibleProps.add(prop.id);
      }

      const payload = encodeSnapshot(
        snapshot,
        {
          visiblePlayers,
          visibleProps,
          previousPlayers: roomPlayer.visiblePlayers,
          previousProps: roomPlayer.visibleProps,
          baseline: roomPlayer.lastSentSnapshot,
          ackSeq: entity.lastProcessedSeq,
        },
        roomPlayer.writer,
      );
      roomPlayer.connection.send(payload);

      roomPlayer.visiblePlayers = visiblePlayers;
      roomPlayer.visibleProps = visibleProps;
      roomPlayer.lastSentSnapshot = snapshot;

      const events = roomPlayer.pendingEvents.length
        ? [...this.broadcastEvents, ...roomPlayer.pendingEvents]
        : this.broadcastEvents;
      if (events.length > 0) {
        const eventsPayload: EventsPayload = { tick: this.tick, events };
        roomPlayer.connection.send(encodeJson(Op.Events, eventsPayload));
      }
      roomPlayer.pendingEvents.length = 0;
    }

    this.broadcastEvents.length = 0;
  }

  private identities(): PlayerIdentity[] {
    return [...this.entities.values()].map((e) => e.identity);
  }

  private scores(): PlayerScore[] {
    return [...this.entities.values()].map((e) => ({
      id: e.id,
      kills: e.stats.kills,
      deaths: e.stats.deaths,
      score: e.stats.score,
      pingMs: Math.round(e.pingMs),
    }));
  }

  broadcastRoster(): void {
    const payload: RosterPayload = {
      players: this.identities(),
      scores: this.scores(),
      matchEndsAt: this.matchEndsAt,
      phase: this.phase,
      joinCode: this.joinCode,
      hostPlayerId: this.hostPlayerId,
    };
    const data = encodeJson(Op.Roster, payload);
    for (const roomPlayer of this.players.values()) roomPlayer.connection.send(data);
  }

  /** Interact ray helper exposed for debugging/tools. */
  eyeOf(playerId: number): Vec3 | null {
    const entity = this.entities.get(playerId);
    if (!entity) return null;
    return eyePosition(scratchEye, entity);
  }

  dispose(): void {
    for (const roomPlayer of this.players.values()) roomPlayer.entity.dispose();
    this.players.clear();
    this.entities.clear();
    this.lagComp.clear();
    this.world.dispose();
    log.info('room disposed', { room: this.id });
  }
}

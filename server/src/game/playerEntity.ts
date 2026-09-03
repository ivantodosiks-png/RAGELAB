import type RAPIER from '@dimforge/rapier3d-compat';
import {
  DEFAULT_LOADOUT,
  MAX_HEALTH,
  PlayerFlag,
  RapierCharacter,
  createMovementState,
  createWeaponState,
  getWeapon,
  qAngle,
  qPos,
  qVel,
  weaponIndex,
  type InputCommand,
  type MovementState,
  type PlayerIdentity,
  type QuantPlayer,
  type Vec3,
  type WeaponId,
  type WeaponRuntimeState,
} from '@ragelab/shared';

/** Per-session counters flushed to Supabase when the player leaves. */
export interface SessionStats {
  kills: number;
  deaths: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  score: number;
  killstreak: number;
  bestKillstreak: number;
  joinedAt: number;
  weapon: Map<WeaponId, { kills: number; shotsFired: number; shotsHit: number; headshots: number; damage: number }>;
}

export function createSessionStats(nowMs: number): SessionStats {
  return {
    kills: 0,
    deaths: 0,
    headshots: 0,
    shotsFired: 0,
    shotsHit: 0,
    damageDealt: 0,
    score: 0,
    killstreak: 0,
    bestKillstreak: 0,
    joinedAt: nowMs,
    weapon: new Map(),
  };
}

export function weaponSession(
  stats: SessionStats,
  weapon: WeaponId,
): { kills: number; shotsFired: number; shotsHit: number; headshots: number; damage: number } {
  let entry = stats.weapon.get(weapon);
  if (!entry) {
    entry = { kills: 0, shotsFired: 0, shotsHit: 0, headshots: 0, damage: 0 };
    stats.weapon.set(weapon, entry);
  }
  return entry;
}

/**
 * Authoritative server-side player. Movement runs through the same shared
 * stepper the client uses for prediction; everything else (health, ammo,
 * cooldowns) exists only here.
 */
export class PlayerEntity {
  readonly id: number;
  identity: PlayerIdentity;

  readonly movement: MovementState;
  readonly character: RapierCharacter;

  health = MAX_HEALTH;
  alive = true;
  respawnAt = 0;
  spawnProtectedUntil = 0;

  loadout: WeaponId[] = [...DEFAULT_LOADOUT];
  currentSlot = 0;
  weapons = new Map<WeaponId, WeaponRuntimeState>();

  /** Prop currently held with the interact key. */
  carrying: number | null = null;

  /** Buttons from the previous processed command, for edge detection. */
  previousButtons = 0;
  /** Highest input sequence we have processed. */
  lastProcessedSeq = 0;
  /** Simulated-time budget in ms; refilled from real time, spent by inputs. */
  timeBudgetMs = 0;

  /** Latest measured round-trip time in ms. */
  pingMs = 0;
  /** Snapshot tick the client last acknowledged (drives lag compensation). */
  ackSnapshotTick = 0;

  stats: SessionStats;
  killedBy: number | null = null;

  /** Anti-cheat violation score; kicks the player when it gets too high. */
  violations = 0;

  readonly quant: QuantPlayer;

  constructor(
    id: number,
    identity: PlayerIdentity,
    rapier: typeof RAPIER,
    world: RAPIER.World,
    spawn: Vec3,
    yaw: number,
    nowMs: number,
  ) {
    this.id = id;
    this.identity = identity;
    this.movement = createMovementState(spawn);
    this.character = new RapierCharacter(rapier, world, spawn);
    this.stats = createSessionStats(nowMs);

    for (const weaponId of this.loadout) {
      this.weapons.set(weaponId, createWeaponState(getWeapon(weaponId), nowMs));
    }

    this.quant = {
      id,
      px: 0,
      py: 0,
      pz: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: qAngle(yaw),
      pitch: 0,
      flags: 0,
      health: MAX_HEALTH,
      weapon: 0,
      mag: 0,
      reserve: 0,
    };
    this.yaw = yaw;
  }

  yaw = 0;
  pitch = 0;
  /** Aiming down sights, derived from the latest processed input. */
  aiming = false;
  /** Latest processed command, used for spread and speed calculations. */
  lastInput: InputCommand | null = null;

  get weaponId(): WeaponId {
    return this.loadout[this.currentSlot] ?? this.loadout[0]!;
  }

  get weapon(): WeaponRuntimeState {
    const id = this.weaponId;
    let state = this.weapons.get(id);
    if (!state) {
      state = createWeaponState(getWeapon(id), 0);
      this.weapons.set(id, state);
    }
    return state;
  }

  computeFlags(): number {
    let flags = 0;
    if (this.movement.grounded) flags |= PlayerFlag.Grounded;
    if (this.movement.crouching) flags |= PlayerFlag.Crouching;
    if (!this.alive) flags |= PlayerFlag.Dead;
    if (this.carrying !== null) flags |= PlayerFlag.Carrying;
    return flags;
  }

  /** Refresh the cached quantized state used by the snapshot encoder. */
  refreshQuant(extraFlags: number): void {
    const q = this.quant;
    const p = this.movement.position;
    const v = this.movement.velocity;
    const w = this.weapon;
    q.px = qPos(p.x);
    q.py = qPos(p.y);
    q.pz = qPos(p.z);
    q.vx = qVel(v.x);
    q.vy = qVel(v.y);
    q.vz = qVel(v.z);
    q.yaw = qAngle(this.yaw);
    q.pitch = qAngle(this.pitch);
    q.flags = this.computeFlags() | extraFlags;
    q.health = Math.max(0, Math.round(this.health));
    q.weapon = weaponIndex(this.weaponId);
    q.mag = w.ammoInMag;
    q.reserve = w.ammoReserve;
  }

  resetForRespawn(spawn: Vec3, yaw: number, nowMs: number): void {
    this.health = MAX_HEALTH;
    this.alive = true;
    this.respawnAt = 0;
    this.killedBy = null;
    this.carrying = null;
    this.movement.position.x = spawn.x;
    this.movement.position.y = spawn.y;
    this.movement.position.z = spawn.z;
    this.movement.velocity.x = 0;
    this.movement.velocity.y = 0;
    this.movement.velocity.z = 0;
    this.movement.grounded = false;
    this.movement.crouching = false;
    this.movement.stepDistance = 0;
    this.yaw = yaw;
    this.pitch = 0;
    this.currentSlot = 0;
    this.character.teleport(spawn);

    this.weapons.clear();
    for (const weaponId of this.loadout) {
      this.weapons.set(weaponId, createWeaponState(getWeapon(weaponId), nowMs));
    }
  }

  dispose(): void {
    this.character.dispose();
  }
}

import { EYE_HEIGHT_CROUCH, EYE_HEIGHT_STAND } from '../constants';
import { directionFromAngles, hashSeed, mulberry32, type Vec3 } from '../math';
import { FireMode, type WeaponDefinition, type WeaponRuntimeState } from '../types/weapons';
import { msPerShot } from '../types/weapons';

export function createWeaponState(def: WeaponDefinition, nowMs: number): WeaponRuntimeState {
  return {
    weaponId: def.id,
    ammoInMag: def.magazineSize,
    ammoReserve: def.reserveAmmo,
    lastShotAt: -100000,
    reloadEndsAt: 0,
    equipEndsAt: nowMs + def.equipMs,
    burstRemaining: 0,
    spread: def.spread.base,
    shotCounter: 0,
  };
}

export const FireDenyReason = {
  Ok: 0,
  Cooldown: 1,
  Reloading: 2,
  Equipping: 3,
  NoAmmo: 4,
  TriggerHeld: 5,
} as const;
export type FireDenyReasonId = (typeof FireDenyReason)[keyof typeof FireDenyReason];

/**
 * Single source of truth for "may this player shoot right now". Both the client
 * (to predict effects) and the server (authoritatively) call this.
 */
export function evaluateFire(
  state: WeaponRuntimeState,
  def: WeaponDefinition,
  nowMs: number,
  triggerPressedThisTick: boolean,
  triggerHeld: boolean,
  graceMs = 0,
): FireDenyReasonId {
  if (state.reloadEndsAt > nowMs) return FireDenyReason.Reloading;
  if (state.equipEndsAt > nowMs) return FireDenyReason.Equipping;
  if (state.ammoInMag <= 0) return FireDenyReason.NoAmmo;

  const interval = msPerShot(def);
  if (nowMs - state.lastShotAt < interval - graceMs) return FireDenyReason.Cooldown;

  switch (def.fireMode) {
    case FireMode.Auto:
      if (!triggerHeld) return FireDenyReason.TriggerHeld;
      return FireDenyReason.Ok;
    case FireMode.Burst:
      if (state.burstRemaining > 0) return FireDenyReason.Ok;
      if (!triggerPressedThisTick) return FireDenyReason.TriggerHeld;
      return FireDenyReason.Ok;
    case FireMode.Single:
    case FireMode.BoltAction:
    default:
      if (!triggerPressedThisTick) return FireDenyReason.TriggerHeld;
      return FireDenyReason.Ok;
  }
}

export interface SpreadContext {
  moving: boolean;
  /** Horizontal speed / max speed, 0..1. */
  speedRatio: number;
  airborne: boolean;
  aiming: boolean;
  crouching: boolean;
}

/** Decay the accumulated cone; call once per simulation step. */
export function decaySpread(state: WeaponRuntimeState, def: WeaponDefinition, dt: number): void {
  const min = def.spread.base;
  state.spread = Math.max(min, state.spread - def.spread.recovery * dt);
}

/** Add the per-shot cone growth. */
export function bloomSpread(state: WeaponRuntimeState, def: WeaponDefinition): void {
  state.spread = Math.min(def.spread.max, state.spread + def.spread.perShot);
}

/** Effective cone half-angle for the current stance. */
export function effectiveSpread(
  state: WeaponRuntimeState,
  def: WeaponDefinition,
  ctx: SpreadContext,
): number {
  let cone = state.spread;
  const s = def.spread;
  if (ctx.airborne) cone *= s.airMultiplier;
  else if (ctx.moving) cone *= 1 + (s.moveMultiplier - 1) * Math.min(ctx.speedRatio, 1);
  if (ctx.crouching) cone *= s.crouchMultiplier;
  if (ctx.aiming) cone *= s.aimMultiplier;
  return Math.min(cone, s.max * Math.max(s.airMultiplier, s.moveMultiplier));
}

/**
 * Deterministic pellet directions. Given the same player id, shot counter and
 * cone, client and server produce identical rays.
 */
export function pelletDirections(
  out: Vec3[],
  yaw: number,
  pitch: number,
  cone: number,
  playerId: number,
  shotCounter: number,
  pellets: number,
): Vec3[] {
  const rand = mulberry32(hashSeed(playerId, shotCounter));
  // Local basis around the aim direction.
  const forward = directionFromAngles({ x: 0, y: 0, z: 0 }, yaw, pitch);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const upX = -forward.y * rightZ;
  const upY = forward.x * rightZ - forward.z * rightX;
  const upZ = forward.y * rightX;

  for (let i = 0; i < pellets; i++) {
    // Uniform disc sample mapped onto the cone.
    const r = Math.sqrt(rand()) * Math.tan(cone);
    const theta = rand() * Math.PI * 2;
    const ox = Math.cos(theta) * r;
    const oy = Math.sin(theta) * r;
    let dx = forward.x + rightX * ox + upX * oy;
    let dy = forward.y + upY * oy;
    let dz = forward.z + rightZ * ox + upZ * oy;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    const target = out[i] ?? (out[i] = { x: 0, y: 0, z: 0 });
    target.x = dx;
    target.y = dy;
    target.z = dz;
  }
  out.length = pellets;
  return out;
}

/** Muzzle origin: eye position pushed slightly forward so we do not hit ourselves. */
export function muzzleOrigin(
  out: Vec3,
  position: Vec3,
  yaw: number,
  pitch: number,
  crouching: boolean,
  forwardOffset = 0.35,
): Vec3 {
  const dir = directionFromAngles({ x: 0, y: 0, z: 0 }, yaw, pitch);
  const eye = crouching ? EYE_HEIGHT_CROUCH : EYE_HEIGHT_STAND;
  out.x = position.x + dir.x * forwardOffset;
  out.y = position.y + eye + dir.y * forwardOffset;
  out.z = position.z + dir.z * forwardOffset;
  return out;
}

export function reloadDurationMs(def: WeaponDefinition, ammoInMag: number): number {
  return ammoInMag <= 0 ? def.reloadEmptyMs : def.reloadMs;
}

export function canReload(
  state: WeaponRuntimeState,
  def: WeaponDefinition,
  nowMs: number,
): boolean {
  if (state.reloadEndsAt > nowMs) return false;
  if (state.equipEndsAt > nowMs) return false;
  if (state.ammoInMag >= def.magazineSize) return false;
  return state.ammoReserve > 0;
}

export function completeReload(state: WeaponRuntimeState, def: WeaponDefinition): void {
  const needed = def.magazineSize - state.ammoInMag;
  const taken = Math.min(needed, state.ammoReserve);
  state.ammoInMag += taken;
  state.ammoReserve -= taken;
}

import {
  EYE_HEIGHT_CROUCH,
  EYE_HEIGHT_STAND,
  HEADSHOT_MULTIPLIER,
  HEAD_HITBOX_RADIUS,
  LEGSHOT_MULTIPLIER,
  PLAYER_HEIGHT_CROUCH,
  PLAYER_HEIGHT_STAND,
  PLAYER_RADIUS,
} from '../constants';
import type { Vec3 } from '../math';

export const HitZone = {
  Body: 0,
  Head: 1,
  Legs: 2,
} as const;
export type HitZoneId = (typeof HitZone)[keyof typeof HitZone];

export function zoneMultiplier(zone: HitZoneId): number {
  if (zone === HitZone.Head) return HEADSHOT_MULTIPLIER;
  if (zone === HitZone.Legs) return LEGSHOT_MULTIPLIER;
  return 1;
}

export interface RayHit {
  /** Distance along the ray. */
  t: number;
  zone: HitZoneId;
  point: Vec3;
  normal: Vec3;
}

/**
 * Ray vs. vertical capsule. `basePosition` is the player's feet position (the
 * same origin used by the movement code). Returns the nearest hit or null.
 */
export function raycastPlayer(
  origin: Vec3,
  dir: Vec3,
  basePosition: Vec3,
  crouching: boolean,
  maxDistance: number,
): RayHit | null {
  const height = crouching ? PLAYER_HEIGHT_CROUCH : PLAYER_HEIGHT_STAND;
  const r = PLAYER_RADIUS;
  const bottomY = basePosition.y + r;
  const topY = basePosition.y + height - r;

  const hit = rayVerticalCapsule(
    origin,
    dir,
    basePosition.x,
    basePosition.z,
    bottomY,
    topY,
    r,
    maxDistance,
  );
  if (!hit) return null;

  const eye = crouching ? EYE_HEIGHT_CROUCH : EYE_HEIGHT_STAND;
  const headMinY = basePosition.y + eye - HEAD_HITBOX_RADIUS;
  const legMaxY = basePosition.y + height * 0.42;

  let zone: HitZoneId = HitZone.Body;
  if (hit.point.y >= headMinY) zone = HitZone.Head;
  else if (hit.point.y <= legMaxY) zone = HitZone.Legs;

  hit.zone = zone;
  return hit;
}

/**
 * Analytic ray/capsule test for a capsule whose axis is parallel to Y. Written
 * out longhand (instead of calling into a physics engine) so the server can
 * rewind hundreds of hitboxes per tick for lag compensation without touching
 * the Rapier world.
 */
export function rayVerticalCapsule(
  origin: Vec3,
  dir: Vec3,
  cx: number,
  cz: number,
  bottomY: number,
  topY: number,
  radius: number,
  maxDistance: number,
): RayHit | null {
  const ox = origin.x - cx;
  const oz = origin.z - cz;

  // ── Infinite cylinder (XZ plane quadratic) ──
  const a = dir.x * dir.x + dir.z * dir.z;
  let best = Infinity;
  let bx = 0;
  let by = 0;
  let bz = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;

  if (a > 1e-9) {
    const b = 2 * (ox * dir.x + oz * dir.z);
    const c = ox * ox + oz * oz - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (t < 0 || t > maxDistance || t >= best) continue;
        const y = origin.y + dir.y * t;
        if (y < bottomY || y > topY) continue;
        best = t;
        bx = origin.x + dir.x * t;
        by = y;
        bz = origin.z + dir.z * t;
        const inv = 1 / radius;
        nx = (bx - cx) * inv;
        ny = 0;
        nz = (bz - cz) * inv;
      }
    }
  }

  // ── Spherical caps ──
  for (const capY of [bottomY, topY]) {
    const oy = origin.y - capY;
    const b = 2 * (ox * dir.x + oy * dir.y + oz * dir.z);
    const c = ox * ox + oy * oy + oz * oz - radius * radius;
    const aa = dir.x * dir.x + dir.y * dir.y + dir.z * dir.z;
    const disc = b * b - 4 * aa * c;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    for (const t of [(-b - sq) / (2 * aa), (-b + sq) / (2 * aa)]) {
      if (t < 0 || t > maxDistance || t >= best) continue;
      const y = origin.y + dir.y * t;
      // Only the outer hemisphere belongs to the capsule.
      if (capY === bottomY && y > bottomY) continue;
      if (capY === topY && y < topY) continue;
      best = t;
      bx = origin.x + dir.x * t;
      by = y;
      bz = origin.z + dir.z * t;
      const inv = 1 / radius;
      nx = (bx - cx) * inv;
      ny = (by - capY) * inv;
      nz = (bz - cz) * inv;
    }
  }

  if (!Number.isFinite(best)) return null;
  return {
    t: best,
    zone: HitZone.Body,
    point: { x: bx, y: by, z: bz },
    normal: { x: nx, y: ny, z: nz },
  };
}

/** Centre of mass, used for explosion line-of-sight and AI-ish checks. */
export function playerCenter(out: Vec3, basePosition: Vec3, crouching: boolean): Vec3 {
  const height = crouching ? PLAYER_HEIGHT_CROUCH : PLAYER_HEIGHT_STAND;
  out.x = basePosition.x;
  out.y = basePosition.y + height * 0.5;
  out.z = basePosition.z;
  return out;
}

export function eyeHeight(crouching: boolean): number {
  return crouching ? EYE_HEIGHT_CROUCH : EYE_HEIGHT_STAND;
}

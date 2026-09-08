import {
  EYE_HEIGHT_CROUCH,
  EYE_HEIGHT_STAND,
  HEADSHOT_MULTIPLIER,
  LEGSHOT_MULTIPLIER,
  PLAYER_HEIGHT_CROUCH,
  PLAYER_HEIGHT_STAND,
  PLAYER_RADIUS,
} from '../constants';
import type { Vec3 } from '../math';
import {
  OPERATOR_PART_CAPSULES,
  hitZoneForPart,
  type BodyPartId,
  type OperatorPartCapsule,
} from './bodyParts';

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

export function zoneForPart(part: BodyPartId): HitZoneId {
  const z = hitZoneForPart(part);
  if (z === 'head') return HitZone.Head;
  if (z === 'legs') return HitZone.Legs;
  return HitZone.Body;
}

export interface RayHit {
  /** Distance along the ray. */
  t: number;
  zone: HitZoneId;
  /** Fine body-part for limb HP UI — matches operator capsules. */
  part: BodyPartId;
  point: Vec3;
  normal: Vec3;
}

/**
 * Ray vs. operator body-part capsules. `basePosition` is feet (movement origin).
 * Left/right limbs are separate volumes so legL / legR (and arms) resolve correctly.
 */
export function raycastPlayer(
  origin: Vec3,
  dir: Vec3,
  basePosition: Vec3,
  crouching: boolean,
  maxDistance: number,
  yaw = 0,
): RayHit | null {
  const height = crouching ? PLAYER_HEIGHT_CROUCH : PLAYER_HEIGHT_STAND;
  const sy = height / PLAYER_HEIGHT_STAND;
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const fwdX = -Math.sin(yaw);
  const fwdZ = -Math.cos(yaw);

  let best: RayHit | null = null;
  let bestPriority = 99;

  for (const cap of OPERATOR_PART_CAPSULES) {
    const hit = raycastLocalCapsule(
      origin,
      dir,
      basePosition,
      cap,
      sy,
      rightX,
      rightZ,
      fwdX,
      fwdZ,
      maxDistance,
    );
    if (!hit) continue;
    const priority = partPriority(cap.part);
    if (
      !best ||
      hit.t < best.t - 0.04 ||
      (Math.abs(hit.t - best.t) <= 0.04 && priority < bestPriority)
    ) {
      best = hit;
      bestPriority = priority;
    }
  }

  // Soft outer shell so grazing shots still register when missing thin limbs.
  if (!best) {
    const r = PLAYER_RADIUS * (crouching ? 0.92 : 1);
    const shell = rayVerticalCapsule(
      origin,
      dir,
      basePosition.x,
      basePosition.z,
      basePosition.y + r * 0.35,
      basePosition.y + height - r * 0.2,
      r,
      maxDistance,
    );
    if (!shell) return null;
    const eye = crouching ? EYE_HEIGHT_CROUCH : EYE_HEIGHT_STAND;
    const rel = shell.point.y - basePosition.y;
    let part: BodyPartId = 'chest';
    if (rel >= eye - 0.16) part = 'head';
    else if (rel <= height * 0.42) {
      const dx = shell.point.x - basePosition.x;
      const dz = shell.point.z - basePosition.z;
      const localRight = dx * rightX + dz * rightZ;
      part = localRight >= 0 ? 'legR' : 'legL';
    } else if (rel < height * 0.58) part = 'stomach';
    shell.part = part;
    shell.zone = zoneForPart(part);
    return shell;
  }

  return best;
}

/** Lower = more specific. Resolves head/limb vs torso capsule overlap. */
function partPriority(part: BodyPartId): number {
  if (part === 'head') return 0;
  if (part === 'armL' || part === 'armR' || part === 'legL' || part === 'legR') return 1;
  return 2;
}

function raycastLocalCapsule(
  origin: Vec3,
  dir: Vec3,
  feet: Vec3,
  cap: OperatorPartCapsule,
  sy: number,
  rightX: number,
  rightZ: number,
  fwdX: number,
  fwdZ: number,
  maxDistance: number,
): RayHit | null {
  const cx = feet.x + rightX * cap.lx + fwdX * cap.lz;
  const cz = feet.z + rightZ * cap.lx + fwdZ * cap.lz;
  const y0 = feet.y + cap.y0 * sy;
  const y1 = feet.y + cap.y1 * sy;
  const radius = cap.radius * (sy < 0.9 ? 1.05 : 1);
  const hit = rayVerticalCapsule(origin, dir, cx, cz, y0, y1, radius, maxDistance);
  if (!hit) return null;
  hit.part = cap.part;
  hit.zone = zoneForPart(cap.part);
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
    part: 'chest',
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

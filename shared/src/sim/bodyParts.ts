/** Per-limb HP with yellow / red / black condition states. */

export const BodyPart = {
  Head: 'head',
  Chest: 'chest',
  Stomach: 'stomach',
  ArmL: 'armL',
  ArmR: 'armR',
  LegL: 'legL',
  LegR: 'legR',
} as const;

export type BodyPartId = (typeof BodyPart)[keyof typeof BodyPart];

export const BODY_PART_IDS: readonly BodyPartId[] = [
  BodyPart.Head,
  BodyPart.Chest,
  BodyPart.Stomach,
  BodyPart.ArmL,
  BodyPart.ArmR,
  BodyPart.LegL,
  BodyPart.LegR,
] as const;

/**
 * Hits until a zone is black (destroyed). Independent per part.
 * Progression with max 3: full → yellow → red → black → (next hit) death.
 * Head is an instant-kill critical — max kept at 1 for display.
 */
export const BODY_PART_MAX: Record<BodyPartId, number> = {
  head: 1,
  chest: 3,
  stomach: 3,
  armL: 3,
  armR: 3,
  legL: 3,
  legR: 3,
};

export const BODY_PART_LABEL: Record<BodyPartId, string> = {
  head: 'Head',
  chest: 'Chest',
  stomach: 'Stomach',
  armL: 'Left Arm',
  armR: 'Right Arm',
  legL: 'Left Leg',
  legR: 'Right Leg',
};

/** @deprecated Use BODY_PART_LABEL */
export const BODY_PART_LABEL_RU = BODY_PART_LABEL;

/** Persistent limb condition shown in HUD / TAB (not a timed flash). */
export type BodyPartCondition = 'healthy' | 'damaged' | 'critical' | 'destroyed';

export const BODY_PART_CONDITION_LABEL: Record<BodyPartCondition, string> = {
  healthy: 'OK',
  damaged: 'Damaged',
  critical: 'Critical',
  destroyed: 'Destroyed',
};

export type BodyPartState = Record<BodyPartId, number>;

/**
 * Vertical capsule in local operator space (feet origin).
 * +X = right, +Y = up, −Z = forward at yaw 0.
 * Tuned to Mixamo Vanguard / Soldier.glb at ~1.8 m.
 */
export interface OperatorPartCapsule {
  part: BodyPartId;
  lx: number;
  lz: number;
  y0: number;
  y1: number;
  radius: number;
}

export const OPERATOR_PART_CAPSULES: readonly OperatorPartCapsule[] = [
  { part: BodyPart.Head, lx: 0, lz: 0.03, y0: 1.5, y1: 1.78, radius: 0.14 },
  { part: BodyPart.Chest, lx: 0, lz: 0.04, y0: 1.12, y1: 1.5, radius: 0.2 },
  { part: BodyPart.Stomach, lx: 0, lz: 0.03, y0: 0.8, y1: 1.12, radius: 0.18 },
  { part: BodyPart.ArmL, lx: -0.36, lz: 0.01, y0: 0.88, y1: 1.42, radius: 0.1 },
  { part: BodyPart.ArmR, lx: 0.36, lz: 0.01, y0: 0.88, y1: 1.42, radius: 0.1 },
  { part: BodyPart.LegL, lx: -0.13, lz: 0.02, y0: 0.02, y1: 0.84, radius: 0.12 },
  { part: BodyPart.LegR, lx: 0.13, lz: 0.02, y0: 0.02, y1: 0.84, radius: 0.12 },
];

export function createFullBodyParts(): BodyPartState {
  return {
    head: BODY_PART_MAX.head,
    chest: BODY_PART_MAX.chest,
    stomach: BODY_PART_MAX.stomach,
    armL: BODY_PART_MAX.armL,
    armR: BODY_PART_MAX.armR,
    legL: BODY_PART_MAX.legL,
    legR: BODY_PART_MAX.legR,
  };
}

export function cloneBodyParts(src: BodyPartState): BodyPartState {
  return {
    head: src.head,
    chest: src.chest,
    stomach: src.stomach,
    armL: src.armL,
    armR: src.armR,
    legL: src.legL,
    legR: src.legR,
  };
}

export function resetBodyParts(parts: BodyPartState): void {
  for (const id of BODY_PART_IDS) parts[id] = BODY_PART_MAX[id];
}

export function damageBodyPart(parts: BodyPartState, part: BodyPartId, amount: number): number {
  const next = Math.max(0, parts[part] - Math.max(0, amount));
  parts[part] = next;
  return next;
}

/**
 * Healthy → Damaged (yellow) → Critical (red) → Destroyed (black).
 * States persist until healed — never time out on their own.
 */
export function bodyPartCondition(parts: BodyPartState, part: BodyPartId): BodyPartCondition {
  const hp = parts[part];
  const max = BODY_PART_MAX[part];
  if (hp <= 0) return 'destroyed';
  if (max <= 1) return hp < max ? 'damaged' : 'healthy';
  // Discrete stages for max=3: 3 OK · 2 yellow · 1 red · 0 black
  if (hp <= 1) return 'critical';
  if (hp < max) return 'damaged';
  return 'healthy';
}

/**
 * Apply one ballistic hit to a zone.
 * - Head: always lethal.
 * - Already destroyed (black) zone: lethal.
 * - Otherwise: −1 HP on that zone only (no cross-part pooling).
 */
export function applyPartHit(
  parts: BodyPartState,
  part: BodyPartId,
): { killed: boolean; condition: BodyPartCondition } {
  if (part === BodyPart.Head) {
    parts.head = 0;
    return { killed: true, condition: 'destroyed' };
  }
  if (parts[part] <= 0) {
    return { killed: true, condition: 'destroyed' };
  }
  damageBodyPart(parts, part, 1);
  return { killed: false, condition: bodyPartCondition(parts, part) };
}

/** True if any zone is black (destroyed). Player can still be alive until next hit there. */
export function hasDestroyedPart(parts: BodyPartState): boolean {
  return BODY_PART_IDS.some((id) => parts[id] <= 0 && id !== BodyPart.Head);
}

export function isBodyDestroyed(parts: BodyPartState): boolean {
  return parts.head <= 0;
}

/** Protocol / bar health while alive — weakest non-head zone ratio. */
export function healthFromParts(parts: BodyPartState, maxHealth = 100): number {
  if (parts.head <= 0) return 0;
  let worst = 1;
  for (const id of BODY_PART_IDS) {
    if (id === BodyPart.Head) continue;
    const max = BODY_PART_MAX[id];
    if (max <= 0) continue;
    worst = Math.min(worst, parts[id] / max);
  }
  return Math.max(1, Math.round(worst * maxHealth));
}

export function healBodyParts(parts: BodyPartState, amount: number): void {
  let left = Math.max(0, amount);
  if (left <= 0) return;
  const damaged = BODY_PART_IDS.filter((id) => parts[id] < BODY_PART_MAX[id]).sort(
    (a, b) => parts[a] / BODY_PART_MAX[a] - parts[b] / BODY_PART_MAX[b],
  );
  for (const id of damaged) {
    if (left <= 0) break;
    const room = BODY_PART_MAX[id] - parts[id];
    const give = Math.min(room, left);
    parts[id] += give;
    left -= give;
  }
}

export function bodyPartRatio(parts: BodyPartState, part: BodyPartId): number {
  const max = BODY_PART_MAX[part];
  return max > 0 ? Math.max(0, Math.min(1, parts[part] / max)) : 0;
}

export function hitZoneForPart(part: BodyPartId): 'head' | 'legs' | 'body' {
  if (part === BodyPart.Head) return 'head';
  if (part === BodyPart.LegL || part === BodyPart.LegR) return 'legs';
  return 'body';
}

export function resolveBodyPartFromHit(
  feetY: number,
  height: number,
  eyeHeight: number,
  headRadius: number,
  hitY: number,
  localRight: number,
  lateralAbs: number,
): BodyPartId {
  const rel = hitY - feetY;
  const headMin = eyeHeight - headRadius;
  if (rel >= headMin) return BodyPart.Head;

  const legMax = height * 0.42;
  if (rel <= legMax) {
    return localRight >= 0 ? BodyPart.LegR : BodyPart.LegL;
  }

  if (lateralAbs > 0.22) {
    return localRight >= 0 ? BodyPart.ArmR : BodyPart.ArmL;
  }

  const chestMin = height * 0.58;
  if (rel >= chestMin) return BodyPart.Chest;
  return BodyPart.Stomach;
}

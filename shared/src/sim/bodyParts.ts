/** Per-limb HP + operator hit-volume layout (madtrollstudio Soldier proportions). */

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

/** Max HP per zone (display + lethal when head hits 0). */
export const BODY_PART_MAX: Record<BodyPartId, number> = {
  head: 35,
  chest: 85,
  stomach: 70,
  armL: 60,
  armR: 60,
  legL: 65,
  legR: 65,
};

export const BODY_PART_LABEL_RU: Record<BodyPartId, string> = {
  head: 'Голова',
  chest: 'Грудь',
  stomach: 'Живот',
  armL: 'Левая рука',
  armR: 'Правая рука',
  legL: 'Левая нога',
  legR: 'Правая нога',
};

export type BodyPartState = Record<BodyPartId, number>;

/**
 * Vertical capsule in local operator space (feet origin).
 * +X = right, +Y = up, −Z = forward at yaw 0 — matches game facing.
 * Tuned to madtrollstudio Soldier (static low-poly) scaled to ~1.8 m.
 */
export interface OperatorPartCapsule {
  part: BodyPartId;
  /** Local right offset (m). */
  lx: number;
  /** Local forward offset (m), −Z is forward. */
  lz: number;
  /** Capsule axis bottom Y above feet. */
  y0: number;
  /** Capsule axis top Y above feet. */
  y1: number;
  radius: number;
}

/**
 * Authoritative hit volumes matching the madtrollstudio Soldier silhouette.
 * Left/right limbs are separate so HUD / TAB highlight the correct side.
 */
export const OPERATOR_PART_CAPSULES: readonly OperatorPartCapsule[] = [
  { part: BodyPart.Head, lx: 0, lz: 0.04, y0: 1.48, y1: 1.78, radius: 0.15 },
  { part: BodyPart.Chest, lx: 0, lz: 0.05, y0: 1.1, y1: 1.48, radius: 0.22 },
  { part: BodyPart.Stomach, lx: 0, lz: 0.04, y0: 0.78, y1: 1.1, radius: 0.19 },
  { part: BodyPart.ArmL, lx: -0.38, lz: 0.02, y0: 0.86, y1: 1.4, radius: 0.11 },
  { part: BodyPart.ArmR, lx: 0.38, lz: 0.02, y0: 0.86, y1: 1.4, radius: 0.11 },
  { part: BodyPart.LegL, lx: -0.14, lz: 0.02, y0: 0.02, y1: 0.82, radius: 0.125 },
  { part: BodyPart.LegR, lx: 0.14, lz: 0.02, y0: 0.02, y1: 0.82, radius: 0.125 },
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

/** Apply damage to one part; returns HP remaining on that part. */
export function damageBodyPart(parts: BodyPartState, part: BodyPartId, amount: number): number {
  const next = Math.max(0, parts[part] - Math.max(0, amount));
  parts[part] = next;
  return next;
}

/** Heal damaged parts preferentially (health packs). */
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

/** Ratio 0..1 for coloring. */
export function bodyPartRatio(parts: BodyPartState, part: BodyPartId): number {
  const max = BODY_PART_MAX[part];
  return max > 0 ? Math.max(0, Math.min(1, parts[part] / max)) : 0;
}

export function hitZoneForPart(part: BodyPartId): 'head' | 'legs' | 'body' {
  if (part === BodyPart.Head) return 'head';
  if (part === BodyPart.LegL || part === BodyPart.LegR) return 'legs';
  return 'body';
}

/**
 * Legacy height/lateral classifier — kept for tools; combat uses OPERATOR_PART_CAPSULES.
 */
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

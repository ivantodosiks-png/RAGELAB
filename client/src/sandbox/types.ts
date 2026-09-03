export type NpcState = 'Idle' | 'Walking' | 'Falling' | 'Ragdoll' | 'Recovering' | 'Dead';

export type SandboxTool = 'none' | 'spawn' | 'delete' | 'select' | 'ragdoll' | 'spawnWeapon' | 'grab' | 'toolGun';

export type SandboxQuality = 'low' | 'medium' | 'high';

export type NpcPartId =
  | 'head'
  | 'torso'
  | 'pelvis'
  | 'upperArmL'
  | 'lowerArmL'
  | 'handL'
  | 'upperArmR'
  | 'lowerArmR'
  | 'handR'
  | 'upperLegL'
  | 'lowerLegL'
  | 'footL'
  | 'upperLegR'
  | 'lowerLegR'
  | 'footR';

export interface SandboxSettings {
  npcCount: number;
  spawnHeight: number;
  spawnRandomOffset: number;
  ragdollOnSpawn: boolean;
  autoCleanup: boolean;
  maxNpcs: number;
  maxEffects: number;
  maxWeapons: number;
  maxProps: number;
  weaponKind: 'pistol' | 'rifle' | 'shotgun' | 'smg' | 'melee';
  quality: SandboxQuality;
}

export const NPC_MAX_BY_QUALITY: Record<SandboxQuality, number> = {
  low: 12,
  medium: 24,
  high: 40,
};

export const EFFECTS_MAX_BY_QUALITY: Record<SandboxQuality, number> = {
  low: 80,
  medium: 200,
  high: 400,
};

export function defaultSandboxSettings(): SandboxSettings {
  return {
    npcCount: 1,
    spawnHeight: 0.05,
    spawnRandomOffset: 0.45,
    ragdollOnSpawn: false,
    autoCleanup: true,
    maxNpcs: NPC_MAX_BY_QUALITY.medium,
    maxEffects: EFFECTS_MAX_BY_QUALITY.medium,
    maxWeapons: 32,
    maxProps: 48,
    weaponKind: 'pistol',
    quality: 'medium',
  };
}

/** Tune ragdoll feel here — masses in kg, linear/angular damping, friction. */
export const RAGDOLL = {
  gravity: -22,
  walkSpeed: 1.55,
  recoverStillSec: 1.35,
  knockdownStillSec: 0.88,
  recoverBlendSec: 0.78,
  ragdollImpactSpeed: 8.5,
  shotImpulse: 22,
  deathImpulse: 16,
  friction: 0.88,
  restitution: 0.018,
  linearDamping: 0.36,
  angularDamping: 0.92,
  corpseSec: 12,
  maxLiveRagdolls: 8,
  limpSpeed: 0.5,
} as const;

export type RagdollStyle = 'drop' | 'spin' | 'crumple' | 'whip' | 'tense';

export interface PartPhysDef {
  mass: number;
  friction?: number;
  restitution?: number;
  linearDamping?: number;
  angularDamping?: number;
  /** Rapier capsule half-height of the cylindrical section, or box half-extents. */
  shape:
    | { type: 'capsule'; halfHeight: number; radius: number }
    | { type: 'ball'; radius: number }
    | { type: 'cuboid'; hx: number; hy: number; hz: number };
}

export const PART_PHYSICS: Record<NpcPartId, PartPhysDef> = {
  head: {
    mass: 5.1,
    friction: 0.42,
    linearDamping: 0.48,
    angularDamping: 1.35,
    shape: { type: 'ball', radius: 0.11 },
  },
  torso: {
    mass: 22,
    friction: 0.78,
    linearDamping: 0.42,
    angularDamping: 1.18,
    shape: { type: 'capsule', halfHeight: 0.16, radius: 0.14 },
  },
  pelvis: {
    mass: 13.5,
    friction: 0.92,
    linearDamping: 0.44,
    angularDamping: 1.05,
    shape: { type: 'cuboid', hx: 0.15, hy: 0.1, hz: 0.1 },
  },
  upperArmL: {
    mass: 2.5,
    friction: 0.55,
    linearDamping: 0.32,
    angularDamping: 0.72,
    shape: { type: 'capsule', halfHeight: 0.11, radius: 0.045 },
  },
  lowerArmL: {
    mass: 1.45,
    friction: 0.55,
    linearDamping: 0.3,
    angularDamping: 0.62,
    shape: { type: 'capsule', halfHeight: 0.1, radius: 0.038 },
  },
  handL: {
    mass: 0.48,
    friction: 1.05,
    linearDamping: 0.28,
    angularDamping: 0.5,
    shape: { type: 'cuboid', hx: 0.04, hy: 0.03, hz: 0.055 },
  },
  upperArmR: {
    mass: 2.5,
    friction: 0.55,
    linearDamping: 0.32,
    angularDamping: 0.72,
    shape: { type: 'capsule', halfHeight: 0.11, radius: 0.045 },
  },
  lowerArmR: {
    mass: 1.45,
    friction: 0.55,
    linearDamping: 0.3,
    angularDamping: 0.62,
    shape: { type: 'capsule', halfHeight: 0.1, radius: 0.038 },
  },
  handR: {
    mass: 0.48,
    friction: 1.05,
    linearDamping: 0.28,
    angularDamping: 0.5,
    shape: { type: 'cuboid', hx: 0.04, hy: 0.03, hz: 0.055 },
  },
  upperLegL: {
    mass: 8.2,
    friction: 0.82,
    linearDamping: 0.4,
    angularDamping: 0.88,
    shape: { type: 'capsule', halfHeight: 0.16, radius: 0.07 },
  },
  lowerLegL: {
    mass: 4.4,
    friction: 0.82,
    linearDamping: 0.38,
    angularDamping: 0.8,
    shape: { type: 'capsule', halfHeight: 0.15, radius: 0.055 },
  },
  footL: {
    mass: 1.05,
    friction: 1.45,
    restitution: 0.01,
    linearDamping: 0.36,
    angularDamping: 0.7,
    shape: { type: 'cuboid', hx: 0.05, hy: 0.035, hz: 0.11 },
  },
  upperLegR: {
    mass: 8.2,
    friction: 0.82,
    linearDamping: 0.4,
    angularDamping: 0.88,
    shape: { type: 'capsule', halfHeight: 0.16, radius: 0.07 },
  },
  lowerLegR: {
    mass: 4.4,
    friction: 0.82,
    linearDamping: 0.38,
    angularDamping: 0.8,
    shape: { type: 'capsule', halfHeight: 0.15, radius: 0.055 },
  },
  footR: {
    mass: 1.05,
    friction: 1.45,
    restitution: 0.01,
    linearDamping: 0.36,
    angularDamping: 0.7,
    shape: { type: 'cuboid', hx: 0.05, hy: 0.035, hz: 0.11 },
  },
};

export const PART_IDS: NpcPartId[] = Object.keys(PART_PHYSICS) as NpcPartId[];

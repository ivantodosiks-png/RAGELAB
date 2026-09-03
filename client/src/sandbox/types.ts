export type NpcState = 'Idle' | 'Walking' | 'Falling' | 'Ragdoll' | 'Recovering';

export type SandboxTool = 'none' | 'spawn' | 'delete' | 'select' | 'ragdoll';

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
    quality: 'medium',
  };
}

/** Tune ragdoll feel here — masses in kg, linear/angular damping, friction. */
export const RAGDOLL = {
  gravity: -22,
  walkSpeed: 1.55,
  recoverStillSec: 1.35,
  recoverBlendSec: 0.7,
  ragdollImpactSpeed: 8.5,
  shotImpulse: 22,
  friction: 0.72,
  restitution: 0.05,
  linearDamping: 0.28,
  angularDamping: 0.85,
} as const;

export interface PartPhysDef {
  mass: number;
  /** Rapier capsule half-height of the cylindrical section, or box half-extents. */
  shape:
    | { type: 'capsule'; halfHeight: number; radius: number }
    | { type: 'ball'; radius: number }
    | { type: 'cuboid'; hx: number; hy: number; hz: number };
}

export const PART_PHYSICS: Record<NpcPartId, PartPhysDef> = {
  head: { mass: 4.2, shape: { type: 'ball', radius: 0.11 } },
  torso: { mass: 14, shape: { type: 'capsule', halfHeight: 0.16, radius: 0.14 } },
  pelvis: { mass: 11, shape: { type: 'cuboid', hx: 0.15, hy: 0.1, hz: 0.1 } },
  upperArmL: { mass: 2.4, shape: { type: 'capsule', halfHeight: 0.11, radius: 0.045 } },
  lowerArmL: { mass: 1.6, shape: { type: 'capsule', halfHeight: 0.1, radius: 0.038 } },
  handL: { mass: 0.45, shape: { type: 'cuboid', hx: 0.04, hy: 0.03, hz: 0.055 } },
  upperArmR: { mass: 2.4, shape: { type: 'capsule', halfHeight: 0.11, radius: 0.045 } },
  lowerArmR: { mass: 1.6, shape: { type: 'capsule', halfHeight: 0.1, radius: 0.038 } },
  handR: { mass: 0.45, shape: { type: 'cuboid', hx: 0.04, hy: 0.03, hz: 0.055 } },
  upperLegL: { mass: 6.5, shape: { type: 'capsule', halfHeight: 0.16, radius: 0.07 } },
  lowerLegL: { mass: 3.8, shape: { type: 'capsule', halfHeight: 0.15, radius: 0.055 } },
  footL: { mass: 0.9, shape: { type: 'cuboid', hx: 0.05, hy: 0.035, hz: 0.11 } },
  upperLegR: { mass: 6.5, shape: { type: 'capsule', halfHeight: 0.16, radius: 0.07 } },
  lowerLegR: { mass: 3.8, shape: { type: 'capsule', halfHeight: 0.15, radius: 0.055 } },
  footR: { mass: 0.9, shape: { type: 'cuboid', hx: 0.05, hy: 0.035, hz: 0.11 } },
};

export const PART_IDS: NpcPartId[] = Object.keys(PART_PHYSICS) as NpcPartId[];

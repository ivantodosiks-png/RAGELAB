import type { PropArchetype, PropKind } from '../types/map';

/**
 * Physics + visual description of every sandbox prop. New prop kinds only need
 * an entry here plus (optionally) a mesh builder branch on the client.
 */
export const PROP_ARCHETYPES: Record<PropKind, PropArchetype> = {
  crate: {
    kind: 'crate',
    shape: { type: 'box', halfExtents: [0.4, 0.4, 0.4] },
    mass: 24,
    restitution: 0.12,
    friction: 0.7,
    linearDamping: 0.06,
    angularDamping: 0.2,
    health: 60,
    explosive: false,
    explosionDamage: 0,
    explosionRadius: 0,
    explosionImpulse: 0,
    carryable: true,
    material: {
      color: 0xa9793f,
      roughness: 0.82,
      metalness: 0.02,
      surface: 'wood',
      texture: 'crate',
      textureScale: 1,
    },
  },

  barrel: {
    kind: 'barrel',
    shape: { type: 'cylinder', radius: 0.32, halfHeight: 0.47 },
    mass: 38,
    restitution: 0.2,
    friction: 0.55,
    linearDamping: 0.05,
    angularDamping: 0.35,
    health: 90,
    explosive: false,
    explosionDamage: 0,
    explosionRadius: 0,
    explosionImpulse: 0,
    carryable: true,
    material: {
      color: 0x37515f,
      roughness: 0.45,
      metalness: 0.75,
      surface: 'metal',
      texture: 'metal',
      textureScale: 2,
    },
  },

  explosive_barrel: {
    kind: 'explosive_barrel',
    shape: { type: 'cylinder', radius: 0.32, halfHeight: 0.47 },
    mass: 42,
    restitution: 0.18,
    friction: 0.55,
    linearDamping: 0.05,
    angularDamping: 0.35,
    health: 45,
    explosive: true,
    explosionDamage: 110,
    explosionRadius: 6.5,
    explosionImpulse: 26,
    carryable: true,
    material: {
      color: 0xb32d1c,
      roughness: 0.5,
      metalness: 0.6,
      emissive: 0x2a0600,
      emissiveIntensity: 0.4,
      surface: 'metal',
      texture: 'hazard',
      textureScale: 2,
    },
  },

  ball: {
    kind: 'ball',
    shape: { type: 'sphere', radius: 0.35 },
    mass: 8,
    restitution: 0.78,
    friction: 0.4,
    linearDamping: 0.03,
    angularDamping: 0.06,
    health: 0,
    explosive: false,
    explosionDamage: 0,
    explosionRadius: 0,
    explosionImpulse: 0,
    carryable: true,
    material: {
      color: 0xe8e34a,
      roughness: 0.6,
      metalness: 0.0,
      surface: 'rubber',
    },
  },

  plank: {
    kind: 'plank',
    shape: { type: 'box', halfExtents: [1.1, 0.06, 0.22] },
    mass: 11,
    restitution: 0.1,
    friction: 0.65,
    linearDamping: 0.08,
    angularDamping: 0.25,
    health: 35,
    explosive: false,
    explosionDamage: 0,
    explosionRadius: 0,
    explosionImpulse: 0,
    carryable: true,
    material: {
      color: 0x8f6a3c,
      roughness: 0.88,
      metalness: 0.0,
      surface: 'wood',
      texture: 'wood',
      textureScale: 3,
    },
  },

  canister: {
    kind: 'canister',
    shape: { type: 'box', halfExtents: [0.16, 0.24, 0.12] },
    mass: 6,
    restitution: 0.25,
    friction: 0.5,
    linearDamping: 0.05,
    angularDamping: 0.3,
    health: 20,
    explosive: true,
    explosionDamage: 55,
    explosionRadius: 3.6,
    explosionImpulse: 14,
    carryable: true,
    material: {
      color: 0xd9a021,
      roughness: 0.4,
      metalness: 0.7,
      surface: 'metal',
      texture: 'hazard',
      textureScale: 1,
    },
  },

  chair: {
    kind: 'chair',
    shape: { type: 'box', halfExtents: [0.24, 0.42, 0.24] },
    mass: 9,
    restitution: 0.15,
    friction: 0.6,
    linearDamping: 0.1,
    angularDamping: 0.3,
    health: 25,
    explosive: false,
    explosionDamage: 0,
    explosionRadius: 0,
    explosionImpulse: 0,
    carryable: true,
    material: {
      color: 0x51565e,
      roughness: 0.6,
      metalness: 0.35,
      surface: 'metal',
    },
  },
};

export function getArchetype(kind: PropKind): PropArchetype {
  const a = PROP_ARCHETYPES[kind];
  if (!a) throw new Error(`Unknown prop kind: ${kind}`);
  return a;
}

export const PROP_KINDS = Object.keys(PROP_ARCHETYPES) as PropKind[];
export const PROP_KIND_INDEX: Record<string, number> = Object.fromEntries(
  PROP_KINDS.map((k, i) => [k, i]),
);

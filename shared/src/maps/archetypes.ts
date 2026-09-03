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

  cardboard_box: boxy('cardboard_box', [0.38, 0.32, 0.38], 4.2, 0xc9a36a, 'wood', 0.14, 0.62),
  trash_bin: cyl('trash_bin', 0.28, 0.42, 7.5, 0x3d4a3a, 'metal', 0.18, 0.5),
  shopping_cart: boxy('shopping_cart', [0.38, 0.42, 0.28], 12, 0x9aa3ad, 'metal', 0.08, 0.22, { metalness: 0.82, angularDamping: 0.18 }),
  sofa: boxy('sofa', [0.95, 0.38, 0.42], 38, 0x5a6b4a, 'wood', 0.08, 0.85, { angularDamping: 0.55 }),
  bucket: cyl('bucket', 0.18, 0.2, 2.4, 0xc45a28, 'metal', 0.22, 0.45),
  traffic_cone: cyl('traffic_cone', 0.16, 0.32, 2.8, 0xe85d12, 'rubber', 0.2, 0.7),
  road_sign: boxy('road_sign', [0.08, 0.7, 0.28], 8.5, 0xc9cfd6, 'metal', 0.12, 0.4, { metalness: 0.7 }),
  bricks: boxy('bricks', [0.32, 0.22, 0.22], 18, 0xa24a32, 'concrete', 0.08, 0.9),
  ladder: boxy('ladder', [0.22, 1.05, 0.06], 9.5, 0xb48a3c, 'wood', 0.1, 0.55),
  pallet: boxy('pallet', [0.7, 0.08, 0.55], 14, 0x8a6a3c, 'wood', 0.06, 0.75),
  pizza_box: boxy('pizza_box', [0.42, 0.05, 0.42], 1.6, 0xd8c38a, 'wood', 0.12, 0.55),
  frying_pan: cyl('frying_pan', 0.22, 0.04, 2.2, 0x2a2d32, 'metal', 0.15, 0.4, { metalness: 0.85 }),
  kettle: cyl('kettle', 0.14, 0.16, 1.8, 0xc0c6ce, 'metal', 0.2, 0.35, { metalness: 0.8 }),
  traffic_barrel: cyl('traffic_barrel', 0.28, 0.5, 16, 0xe25b14, 'rubber', 0.22, 0.5),

  stuffed_toy: boxy('stuffed_toy', [0.22, 0.28, 0.18], 1.4, 0xe07a9a, 'rubber', 0.28, 0.7),
  duck: boxy('duck', [0.16, 0.14, 0.2], 0.6, 0xf0d23a, 'rubber', 0.45, 0.55),
  chicken: boxy('chicken', [0.14, 0.16, 0.18], 0.7, 0xf2efe4, 'rubber', 0.35, 0.5),
  watermelon: cyl('watermelon', 0.22, 0.18, 4.8, 0x3d8a42, 'wood', 0.28, 0.4),
  soda_cup: cyl('soda_cup', 0.14, 0.22, 0.5, 0xe8e8ea, 'rubber', 0.25, 0.35),
  toilet_paper: cyl('toilet_paper', 0.1, 0.1, 0.35, 0xf4f1ea, 'wood', 0.2, 0.3),
  toothbrush: boxy('toothbrush', [0.06, 0.06, 0.55], 0.9, 0x4ec4e0, 'rubber', 0.18, 0.4),
  giant_dice: boxy('giant_dice', [0.28, 0.28, 0.28], 3.2, 0xf5f0e6, 'wood', 0.32, 0.4),
  balloons: cyl('balloons', 0.28, 0.32, 0.25, 0xff5a7a, 'rubber', 0.55, 0.15, { linearDamping: 0.35, angularDamping: 0.4 }),
  banana_peel: boxy('banana_peel', [0.22, 0.04, 0.16], 0.2, 0xf2d12b, 'rubber', 0.05, 0.08),
  whoopee: cyl('whoopee', 0.22, 0.04, 0.4, 0xc45a8a, 'rubber', 0.4, 0.55),
  donut: cyl('donut', 0.22, 0.07, 0.8, 0xd48a4a, 'wood', 0.3, 0.4),

  wheel: cyl('wheel', 0.32, 0.08, 8.5, 0x222428, 'rubber', 0.35, 0.85, { angularDamping: 0.08 }),
  beach_ball: ball('beach_ball', 0.38, 0.55, 0xff6b4a, 0.88, 0.25),
  bowling_ball: ball('bowling_ball', 0.22, 7.2, 0x1a1c28, 0.22, 0.18),
  bowling_pin: cyl('bowling_pin', 0.08, 0.28, 1.5, 0xf4f0e6, 'wood', 0.25, 0.2),
  magnet: boxy('magnet', [0.18, 0.16, 0.08], 4.6, 0xd22b2b, 'metal', 0.12, 0.45, { metalness: 0.7 }),
  mattress: boxy('mattress', [0.95, 0.12, 0.55], 11, 0xe8e2d2, 'rubber', 0.62, 0.55),
  hockey_puck: cyl('hockey_puck', 0.12, 0.025, 0.16, 0x141414, 'rubber', 0.18, 0.12, { angularDamping: 0.04 }),
  giant_spring: cyl('giant_spring', 0.14, 0.32, 2.6, 0xc9ced4, 'metal', 0.55, 0.25, { metalness: 0.85 }),

  tv: boxy('tv', [0.42, 0.32, 0.16], 14, 0x2a2d32, 'metal', 0.1, 0.55, { metalness: 0.4 }),
  radio: boxy('radio', [0.22, 0.12, 0.1], 2.1, 0xb45a28, 'wood', 0.16, 0.5),
  computer: boxy('computer', [0.28, 0.32, 0.18], 9.5, 0x8a9098, 'metal', 0.1, 0.55, { metalness: 0.45 }),
  loose_door: boxy('loose_door', [0.06, 1.05, 0.42], 18, 0x7a5a32, 'wood', 0.08, 0.5, { angularDamping: 0.4 }),
  extinguisher: cyl('extinguisher', 0.09, 0.28, 5.5, 0xc62828, 'metal', 0.16, 0.45, { metalness: 0.7 }),
  broom: boxy('broom', [0.08, 0.08, 0.7], 1.8, 0x8a6232, 'wood', 0.12, 0.45),
  scooter: boxy('scooter', [0.18, 0.12, 0.55], 6.4, 0x3aa0d8, 'metal', 0.12, 0.28, { angularDamping: 0.12 }),
  desk_lamp: boxy('desk_lamp', [0.12, 0.28, 0.12], 1.9, 0xd6c24a, 'metal', 0.14, 0.4, { metalness: 0.55 }),
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

type Shape = PropArchetype['shape'];

function base(
  kind: PropKind,
  shape: Shape,
  mass: number,
  color: number,
  surface: PropArchetype['material']['surface'],
  restitution: number,
  friction: number,
  extra?: {
    metalness?: number;
    roughness?: number;
    linearDamping?: number;
    angularDamping?: number;
  },
): PropArchetype {
  return {
    kind,
    shape,
    mass,
    restitution,
    friction,
    linearDamping: extra?.linearDamping ?? 0.07,
    angularDamping: extra?.angularDamping ?? 0.28,
    health: 0,
    explosive: false,
    explosionDamage: 0,
    explosionRadius: 0,
    explosionImpulse: 0,
    carryable: true,
    material: {
      color,
      roughness: extra?.roughness ?? 0.62,
      metalness: extra?.metalness ?? 0.08,
      surface,
    },
  };
}

function boxy(
  kind: PropKind,
  halfExtents: [number, number, number],
  mass: number,
  color: number,
  surface: PropArchetype['material']['surface'],
  restitution: number,
  friction: number,
  extra?: Parameters<typeof base>[7],
): PropArchetype {
  return base(kind, { type: 'box', halfExtents }, mass, color, surface, restitution, friction, extra);
}

function cyl(
  kind: PropKind,
  radius: number,
  halfHeight: number,
  mass: number,
  color: number,
  surface: PropArchetype['material']['surface'],
  restitution: number,
  friction: number,
  extra?: Parameters<typeof base>[7],
): PropArchetype {
  return base(kind, { type: 'cylinder', radius, halfHeight }, mass, color, surface, restitution, friction, extra);
}

function ball(
  kind: PropKind,
  radius: number,
  mass: number,
  color: number,
  restitution: number,
  friction: number,
): PropArchetype {
  return base(kind, { type: 'sphere', radius }, mass, color, 'rubber', restitution, friction, {
    roughness: 0.45,
    linearDamping: 0.03,
    angularDamping: 0.05,
  });
}

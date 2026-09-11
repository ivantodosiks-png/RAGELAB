import type { Brush, LightDef, MapDecorDef, MapDefinition, MaterialDef, SpawnPointDef } from '../types/map';

/**
 * Classic CS fight-yard `$2000$` (Calou / fy_2000 family).
 * Geometry from GoldSrc BSP → glTF (hlbsp-converter). Horizontal centering uses
 * hammer×0.0254; vertical align is measured from the GLB floor (pillar bases ≈ y 0.18).
 */
const S = 0.0254;
const OX = 775 * S;
/** Lift so walkable floor (local ≈ 0.18) sits at world y = 0. */
const FLOOR_LOCAL_Y = 0.18;
const OY = -FLOOR_LOCAL_Y;
const OZ = 762 * S;

const materials: Record<string, MaterialDef> = {
  floor: {
    color: 0x3a3a3a,
    roughness: 0.95,
    metalness: 0.02,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 10,
  },
  wall: {
    color: 0x6a645c,
    roughness: 0.9,
    metalness: 0.04,
    surface: 'concrete',
    texture: 'brick',
    textureScale: 3,
  },
  cover: {
    color: 0x4a4844,
    roughness: 0.85,
    metalness: 0.05,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 2,
  },
};

function hull(
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  material: string,
): Brush {
  return {
    kind: 'box',
    position: [cx, cy, cz],
    size: [sx, sy, sz],
    material,
    invisible: true,
  };
}

/** Local GLB AABB → play space after decor offset. */
function localHull(
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  material: string,
): Brush {
  return hull(cx + OX, cy + OY, cz + OZ, sx, sy, sz, material);
}

function spawn(hx: number, hy: number, id: string): SpawnPointDef {
  const z = -hy * S + OZ;
  // Face mid courtyard (−Z from CT / +Z from T).
  const yaw = z > 0 ? 0 : Math.PI;
  return {
    position: [hx * S + OX, 1.15, z],
    yaw,
    id,
  };
}

const brushes: Brush[] = [
  // Courtyard floor — top at ≈ 0
  localHull(-23.16, -0.35, -22.87, 46, 1.0, 52, 'floor'),
  // Outer shell
  hull(-3.5, 2.0, -28, 46, 4.5, 1.2, 'wall'),
  hull(-3.5, 2.0, 22, 46, 4.5, 1.2, 'wall'),
  hull(-25, 2.0, -3.5, 1.2, 4.5, 52, 'wall'),
  hull(18, 2.0, -3.5, 1.2, 4.5, 52, 'wall'),
  // Mid pillars / cover from BSP submodels *3–*6
  localHull(-16.2, 1.62, -27.96, 2.16, 2.88, 1.92, 'cover'),
  localHull(-29.76, 1.62, -27.96, 2.16, 2.88, 1.92, 'cover'),
  localHull(-16.2, 1.62, -18.3, 2.16, 2.88, 1.92, 'cover'),
  localHull(-29.76, 1.62, -18.3, 2.16, 2.88, 1.92, 'cover'),
  // Mid buy block *13
  localHull(-22.8, 1.62, -23.2, 2.5, 2.9, 3.1, 'cover'),
];

const decor: MapDecorDef[] = [
  { model: 'fy2000', position: [OX, OY, OZ], scale: 1 },
];

const spawnPoints: SpawnPointDef[] = [
  spawn(-772, 1272, 't1'),
  spawn(-644, 1272, 't2'),
  spawn(-516, 1272, 't3'),
  spawn(-903, 1400, 't4'),
  spawn(-1031, 1400, 't5'),
  spawn(-772, 1400, 't6'),
  spawn(-772, 124, 'ct1'),
  spawn(-644, 124, 'ct2'),
  spawn(-516, 252, 'ct3'),
  spawn(-903, 252, 'ct4'),
  spawn(-772, 252, 'ct5'),
  spawn(-644, 252, 'ct6'),
];

const lights: LightDef[] = [
  { kind: 'point', position: [-3, 5.5, -4], color: 0xfff0d8, intensity: 48, distance: 36, quality: 'high' },
  { kind: 'point', position: [-12, 4.5, -14], color: 0xffd090, intensity: 16, distance: 22, quality: 'medium' },
  { kind: 'point', position: [6, 4.5, 8], color: 0xffd090, intensity: 16, distance: 22, quality: 'medium' },
  { kind: 'point', position: [-12, 4.5, 8], color: 0xe8f0ff, intensity: 12, distance: 20, quality: 'medium' },
  { kind: 'point', position: [6, 4.5, -14], color: 0xe8f0ff, intensity: 12, distance: 20, quality: 'medium' },
];

export const FY2000: MapDefinition = {
  id: 'fy2000',
  name: '$2000$',
  description: 'Classic CS fight-yard — two spawn sides, mid buy walls, fast PvP.',
  author: 'Calou / CS community',
  players: [2, 16],
  bounds: 28,
  killPlaneY: -8,
  environment: {
    skyTop: 0x5a7a98,
    skyBottom: 0xb8b0a0,
    sunColor: 0xffe0b8,
    sunIntensity: 2.35,
    sunDirection: [0.4, 0.85, 0.25],
    ambientColor: 0xb0b8c0,
    ambientIntensity: 0.85,
    fogColor: 0xb0b4b8,
    fogDensity: 0.0015,
    ambience: 'indoor',
  },
  materials,
  brushes,
  props: [],
  doors: [],
  switches: [],
  pickups: [
    { id: 'fy_rifle', kind: 'weapon', value: 'rifle', position: [-3, 1.35, -4], respawnMs: 10000 },
    { id: 'fy_smg', kind: 'weapon', value: 'smg', position: [-8, 1.35, -4], respawnMs: 9000 },
    { id: 'fy_shot', kind: 'weapon', value: 'shotgun', position: [2, 1.35, -4], respawnMs: 9000 },
    { id: 'fy_glock_t', kind: 'weapon', value: 'glock', position: [0, 1.35, -14], respawnMs: 8000 },
    { id: 'fy_glock_ct', kind: 'weapon', value: 'glock', position: [0, 1.35, 14], respawnMs: 8000 },
  ],
  lights,
  spawnPoints,
  decor,
};

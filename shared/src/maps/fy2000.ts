import type { Brush, LightDef, MapDecorDef, MapDefinition, MaterialDef, SpawnPointDef } from '../types/map';

/**
 * Classic CS fight-yard `$2000$` (Calou / fy_2000 family).
 * Geometry from the GoldSrc BSP → glTF (hlbsp-converter), hammer units ×0.0254.
 * Collision is invisible brush hulls — the GLB is scenery only.
 */
const S = 0.0254;
const OX = 775 * S;
const OY = 128 * S;
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

/** Hammer (x,y,z,yaw°) → play space. HL +Y forward becomes Three −Z. */
function spawn(hx: number, hy: number, hz: number, faceMid: boolean, id: string): SpawnPointDef {
  const z = -hy * S + OZ;
  // Face the mid courtyard regardless of original HL angle.
  const yaw = faceMid ? (z > 0 ? 0 : Math.PI) : 0;
  return {
    position: [hx * S + OX, hz * S + OY + 1.2, z],
    yaw,
    id,
  };
}

const brushes: Brush[] = [
  // Main courtyard floor
  hull(-3.5, -0.4, -3.5, 46, 1.2, 52, 'floor'),
  // Outer perimeter
  hull(-3.5, 2.2, -28, 46, 5, 1.2, 'wall'),
  hull(-3.5, 2.2, 22, 46, 5, 1.2, 'wall'),
  hull(-25, 2.2, -3.5, 1.2, 5, 52, 'wall'),
  hull(18, 2.2, -3.5, 1.2, 5, 52, 'wall'),
  // Mid buy-zone walls (classic $2000$ corridor)
  hull(-10, 1.55, -3.8, 1.4, 3.1, 16, 'wall'),
  hull(4, 1.55, -3.8, 1.4, 3.1, 16, 'wall'),
  hull(-3, 1.55, -11.5, 12, 3.1, 1.4, 'wall'),
  hull(-3, 1.55, 3.8, 12, 3.1, 1.4, 'wall'),
  // Courtyard cover blocks
  hull(3.5, 1.45, -8.6, 2.2, 2.9, 1.9, 'cover'),
  hull(3.5, 1.45, 1.1, 2.2, 2.9, 1.9, 'cover'),
  hull(-10.1, 1.45, -8.6, 2.2, 2.9, 1.9, 'cover'),
  hull(-10.1, 1.45, 1.1, 2.2, 2.9, 1.9, 'cover'),
  hull(-3.1, 1.45, -3.8, 2.5, 2.9, 3.1, 'cover'),
];

const decor: MapDecorDef[] = [
  { model: 'fy2000', position: [OX, OY, OZ], scale: 1 },
];

const spawnPoints: SpawnPointDef[] = [
  // T / north (HL info_player_start)
  spawn(-772, 1272, -128, true, 't1'),
  spawn(-644, 1272, -128, true, 't2'),
  spawn(-516, 1272, -128, true, 't3'),
  spawn(-903, 1400, -128, true, 't4'),
  spawn(-1031, 1400, -128, true, 't5'),
  spawn(-772, 1400, -128, true, 't6'),
  // CT / south (HL info_player_deathmatch)
  spawn(-772, 124, -128, true, 'ct1'),
  spawn(-644, 124, -128, true, 'ct2'),
  spawn(-516, 252, -128, true, 'ct3'),
  spawn(-903, 252, -128, true, 'ct4'),
  spawn(-772, 252, -128, true, 'ct5'),
  spawn(-644, 252, -128, true, 'ct6'),
];

const lights: LightDef[] = [
  { kind: 'point', position: [-3, 8, -4], color: 0xfff0d8, intensity: 55, distance: 40, quality: 'high' },
  { kind: 'point', position: [-12, 6, -14], color: 0xffd090, intensity: 18, distance: 24, quality: 'medium' },
  { kind: 'point', position: [6, 6, 8], color: 0xffd090, intensity: 18, distance: 24, quality: 'medium' },
  { kind: 'point', position: [-12, 6, 8], color: 0xe8f0ff, intensity: 14, distance: 22, quality: 'medium' },
  { kind: 'point', position: [6, 6, -14], color: 0xe8f0ff, intensity: 14, distance: 22, quality: 'medium' },
];

export const FY2000: MapDefinition = {
  id: 'fy2000',
  name: '$2000$',
  description: 'Classic CS fight-yard — two spawn sides, mid buy walls, fast PvP.',
  author: 'Calou / CS community',
  players: [2, 16],
  bounds: 28,
  killPlaneY: -10,
  environment: {
    skyTop: 0x5a7a98,
    skyBottom: 0xb8b0a0,
    sunColor: 0xffe0b8,
    sunIntensity: 2.2,
    sunDirection: [0.4, 0.85, 0.25],
    ambientColor: 0xa8b0b8,
    ambientIntensity: 0.72,
    fogColor: 0xb0b4b8,
    fogDensity: 0.0018,
    ambience: 'indoor',
  },
  materials,
  brushes,
  props: [],
  doors: [],
  switches: [],
  pickups: [
    { id: 'fy_rifle', kind: 'weapon', value: 'rifle', position: [-3, 1.4, -3.8], respawnMs: 10000 },
    { id: 'fy_smg', kind: 'weapon', value: 'smg', position: [-8, 1.4, -3.8], respawnMs: 9000 },
    { id: 'fy_shot', kind: 'weapon', value: 'shotgun', position: [2, 1.4, -3.8], respawnMs: 9000 },
    { id: 'fy_glock_t', kind: 'weapon', value: 'glock', position: [0, 1.4, -14], respawnMs: 8000 },
    { id: 'fy_glock_ct', kind: 'weapon', value: 'glock', position: [0, 1.4, 14], respawnMs: 8000 },
  ],
  lights,
  spawnPoints,
  decor,
};

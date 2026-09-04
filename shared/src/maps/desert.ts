import type { Brush, LightDef, MapDecorDef, MapDefinition, MaterialDef, SpawnPointDef } from '../types/map';

const DEG = Math.PI / 180;

/**
 * Desert Arena (low-poly Sketchfab environment). Visuals from the authored GLB;
 * brushes are invisible collision hulls measured from mesh AABBs, then shifted
 * so the sand floor sits near the origin with its top at y ≈ 0.
 *
 * Raw world center ≈ (5.78, 0.18, −3.26). Floor top ≈ −1.22.
 */
const OX = -5.776;
const OY = 1.22;
const OZ = 3.263;

const materials: Record<string, MaterialDef> = {
  floor: {
    color: 0xc4a574,
    roughness: 0.95,
    metalness: 0.02,
    surface: 'sand',
    texture: 'asphalt',
    textureScale: 10,
  },
  wall: {
    color: 0x8a7355,
    roughness: 0.9,
    metalness: 0.04,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 3,
  },
  cover: {
    color: 0x6b5344,
    roughness: 0.85,
    metalness: 0.06,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 2,
  },
  prop: {
    color: 0x5a4a3a,
    roughness: 0.8,
    metalness: 0.05,
    surface: 'concrete',
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
    position: [cx + OX, cy + OY, cz + OZ],
    size: [sx, sy, sz],
    material,
    invisible: true,
  };
}

// Measured AABBs from desert_arena_environment__low_poly_game_asset.glb (pre-offset).
// Object_13 is a full-volume shell — skipped. Object_4 is the mid ruin block.
const brushes: Brush[] = [
  // Floor (Object_11)
  hull(5.759, -1.39, -3.28, 28.576, 0.342, 21.127, 'floor'),
  // Perimeter walls around the sand yard
  hull(5.759, 0.4, -13.844, 28.576, 3.2, 0.55, 'wall'),
  hull(5.759, 0.4, 7.284, 28.576, 3.2, 0.55, 'wall'),
  hull(-8.529, 0.4, -3.28, 0.55, 3.2, 21.127, 'wall'),
  hull(20.047, 0.4, -3.28, 0.55, 3.2, 21.127, 'wall'),
  // Mid ruin shell (Object_4 AABB) — hollow with N/S doorways so the yard stays playable
  hull(-1.934, 0, -3.671, 1.0, 2.834, 13.717, 'wall'),
  hull(13.364, 0, -3.671, 1.0, 2.834, 13.717, 'wall'),
  hull(1.607, 0, -10.18, 6.25, 2.834, 1.0, 'wall'),
  hull(9.823, 0, -10.18, 6.25, 2.834, 1.0, 'wall'),
  hull(1.607, 0, 2.837, 6.25, 2.834, 1.0, 'wall'),
  hull(9.823, 0, 2.837, 6.25, 2.834, 1.0, 'wall'),
  // Cover / crates
  hull(17.393, -0.978, -7.523, 2.139, 0.949, 2.19, 'cover'),
  hull(-5.962, -0.933, -10.791, 2.339, 0.949, 1.821, 'cover'),
  hull(5.515, -0.93, 6.567, 2.274, 0.986, 0.907, 'cover'),
  hull(5.515, -0.93, -13.085, 2.274, 0.986, 0.907, 'cover'),
  hull(5.78, -0.978, -2.918, 0.873, 0.949, 2.189, 'cover'),
  hull(-1.376, -1.214, 2.194, 0.453, 0.454, 0.454, 'prop'),
  hull(-1.376, -1.214, -9.519, 0.453, 0.454, 0.454, 'prop'),
  hull(5.762, -1.214, -1.586, 0.453, 0.454, 0.454, 'prop'),
  hull(5.762, -1.214, -1.134, 0.453, 0.454, 0.454, 'prop'),
  hull(6.868, -1.215, -13.338, 0.453, 0.454, 0.454, 'prop'),
  hull(5.762, -1.12, -4.256, 0.453, 0.454, 0.454, 'prop'),
];

const decor: MapDecorDef[] = [
  { model: 'desert', position: [OX, OY, OZ], scale: 1 },
];

const spawnPoints: SpawnPointDef[] = [
  { position: [-11, 1.15, -8], yaw: 45 * DEG, id: 'sw' },
  { position: [11, 1.15, 8], yaw: -135 * DEG, id: 'ne' },
  { position: [-11, 1.15, 8], yaw: 135 * DEG, id: 'nw' },
  { position: [11, 1.15, -8], yaw: -45 * DEG, id: 'se' },
  { position: [0, 1.15, -9], yaw: 0, id: 'south' },
  { position: [0, 1.15, 9], yaw: 180 * DEG, id: 'north' },
  { position: [-12, 1.15, 0], yaw: 90 * DEG, id: 'west' },
  { position: [12, 1.15, 0], yaw: -90 * DEG, id: 'east' },
];

const lights: LightDef[] = [
  { kind: 'point', position: [0, 10, 0], color: 0xffe2b0, intensity: 55, distance: 40, quality: 'high' },
  { kind: 'point', position: [-8, 6, -6], color: 0xffc070, intensity: 16, distance: 22, quality: 'medium' },
  { kind: 'point', position: [8, 6, 6], color: 0xffc070, intensity: 16, distance: 22, quality: 'medium' },
  { kind: 'point', position: [9, 5, -7], color: 0xfff0d0, intensity: 12, distance: 18, quality: 'medium' },
  { kind: 'point', position: [-9, 5, 7], color: 0xfff0d0, intensity: 12, distance: 18, quality: 'medium' },
];

export const DESERT: MapDefinition = {
  id: 'desert',
  name: 'Desert Arena',
  description: 'Low-poly desert yard with a mid ruin, sand floor and tight cover lanes.',
  author: 'RAGELAB',
  players: [2, 16],
  bounds: 18,
  killPlaneY: -8,
  environment: {
    skyTop: 0x87a8c8,
    skyBottom: 0xe8d4a8,
    sunColor: 0xffe0a8,
    sunIntensity: 2.8,
    sunDirection: [0.45, 0.82, 0.28],
    ambientColor: 0xd8c8a8,
    ambientIntensity: 0.75,
    fogColor: 0xd8c8a0,
    fogDensity: 0.0022,
    ambience: 'outdoor',
  },
  materials,
  brushes,
  props: [],
  doors: [],
  switches: [],
  pickups: [
    { id: 'da_rifle', kind: 'weapon', value: 'rifle', position: [0, 1.4, -11], respawnMs: 12000 },
    { id: 'da_smg', kind: 'weapon', value: 'smg', position: [-11, 1.4, 0], respawnMs: 10000 },
    { id: 'da_shot', kind: 'weapon', value: 'shotgun', position: [11, 1.4, 0], respawnMs: 10000 },
  ],
  lights,
  spawnPoints,
  decor,
};

import type { Brush, LightDef, MapDecorDef, MapDefinition, MaterialDef, SpawnPointDef } from '../types/map';

const DEG = Math.PI / 180;

/**
 * Glen Canyon Dam (GT Racing 2 environment). Visuals from the authored GLB at
 * scale 0.05; brushes are invisible collision hulls so the sand/road plane sits
 * near y = 0 with the dam road centered on the origin.
 *
 * Raw road surface ≈ y 40. Raw focus ≈ (90, −160).
 */
const S = 0.05;
const OX = -90 * S;
const OY = -40 * S;
const OZ = 160 * S;

const materials: Record<string, MaterialDef> = {
  floor: {
    color: 0x5a5e62,
    roughness: 0.92,
    metalness: 0.04,
    surface: 'asphalt',
    texture: 'asphalt',
    textureScale: 12,
  },
  wall: {
    color: 0x6a6258,
    roughness: 0.9,
    metalness: 0.05,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 4,
  },
  cover: {
    color: 0x4a4540,
    roughness: 0.85,
    metalness: 0.06,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 2,
  },
  prop: {
    color: 0x3a3834,
    roughness: 0.8,
    metalness: 0.05,
    surface: 'concrete',
  },
};

/** World-space hull after scale + origin shift (already in play meters). */
function hull(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, material: string): Brush {
  return {
    kind: 'box',
    position: [cx, cy, cz],
    size: [sx, sy, sz],
    material,
    invisible: true,
  };
}

// Collision is intentionally coarse — source meshes are giant combined atlases.
const brushes: Brush[] = [
  // Main road slab (Road_road_ROAD_0)
  hull(-3.0, -0.55, -18.3, 90, 1.2, 72, 'floor'),
  // North track road (Track_1_PIVOT_ROAD_0)
  hull(11.3, 0.35, 14.8, 53, 1.0, 43, 'floor'),
  // East road pad (Object1523)
  hull(28.6, 0.3, -14.6, 31, 1.0, 48, 'floor'),
  // West tile pad (ENV.003)
  hull(-21.2, -0.2, 7.3, 27, 0.8, 24, 'floor'),
  // Soft fill so spawn ring stays walkable
  hull(0, -0.4, 0, 70, 1.0, 70, 'floor'),
  // Perimeter walls
  hull(0, 3.2, -48, 96, 8, 1.2, 'wall'),
  hull(0, 3.2, 48, 96, 8, 1.2, 'wall'),
  hull(-48, 3.2, 0, 1.2, 8, 96, 'wall'),
  hull(48, 3.2, 0, 1.2, 8, 96, 'wall'),
  // Sparse cover blocks so the open road still has fight geometry
  hull(-14, 1.4, -8, 4.5, 2.8, 6, 'cover'),
  hull(16, 1.4, 10, 5, 2.8, 5.5, 'cover'),
  hull(-6, 1.2, 18, 3.2, 2.4, 7, 'cover'),
  hull(22, 1.2, -22, 3.5, 2.4, 6.5, 'cover'),
  hull(8, 1.1, -4, 2.2, 2.2, 5, 'cover'),
  hull(-22, 1.1, 4, 2.4, 2.2, 5.5, 'cover'),
  // Track_3 rock / non-collision mesh approx
  hull(-26.6, 1.4, 1.0, 10, 2.6, 8, 'cover'),
];

const decor: MapDecorDef[] = [
  { model: 'desert', position: [OX, OY, OZ], scale: S },
];

const spawnPoints: SpawnPointDef[] = [
  { position: [-25, 1.25, -25], yaw: 45 * DEG, id: 'sw' },
  { position: [25, 1.25, -25], yaw: -45 * DEG, id: 'se' },
  { position: [-25, 1.25, 25], yaw: 135 * DEG, id: 'nw' },
  { position: [25, 1.25, 25], yaw: -135 * DEG, id: 'ne' },
  { position: [0, 1.25, -32], yaw: 0, id: 'south' },
  { position: [0, 1.25, 32], yaw: 180 * DEG, id: 'north' },
  { position: [-32, 1.25, 0], yaw: 90 * DEG, id: 'west' },
  { position: [32, 1.25, 0], yaw: -90 * DEG, id: 'east' },
];

const lights: LightDef[] = [
  { kind: 'point', position: [0, 14, 0], color: 0xffe8c8, intensity: 70, distance: 70, quality: 'high' },
  { kind: 'point', position: [-22, 8, -18], color: 0xffc878, intensity: 22, distance: 36, quality: 'medium' },
  { kind: 'point', position: [22, 8, 18], color: 0xffc878, intensity: 22, distance: 36, quality: 'medium' },
  { kind: 'point', position: [18, 7, -20], color: 0xd8e8ff, intensity: 16, distance: 30, quality: 'medium' },
  { kind: 'point', position: [-18, 7, 20], color: 0xd8e8ff, intensity: 16, distance: 30, quality: 'medium' },
];

export const DESERT: MapDefinition = {
  id: 'desert',
  name: 'Glen Canyon',
  description: 'Scaled GT Racing canyon dam road — open asphalt lanes around the gorge.',
  author: 'RAGELAB',
  players: [2, 16],
  bounds: 50,
  killPlaneY: -12,
  environment: {
    skyTop: 0x6a98c8,
    skyBottom: 0xc8b898,
    sunColor: 0xffe2b0,
    sunIntensity: 2.6,
    sunDirection: [0.42, 0.78, 0.35],
    ambientColor: 0xc8b8a0,
    ambientIntensity: 0.7,
    fogColor: 0xb8c0c8,
    fogDensity: 0.0016,
    ambience: 'outdoor',
  },
  materials,
  brushes,
  props: [],
  doors: [],
  switches: [],
  pickups: [
    { id: 'gc_rifle', kind: 'weapon', value: 'rifle', position: [0, 1.5, -28], respawnMs: 12000 },
    { id: 'gc_smg', kind: 'weapon', value: 'smg', position: [-28, 1.5, 0], respawnMs: 10000 },
    { id: 'gc_shot', kind: 'weapon', value: 'shotgun', position: [28, 1.5, 0], respawnMs: 10000 },
  ],
  lights,
  spawnPoints,
  decor,
};

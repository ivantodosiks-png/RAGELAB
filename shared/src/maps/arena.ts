import type { Brush, LightDef, MapDecorDef, MapDefinition, MaterialDef, SpawnPointDef } from '../types/map';

const DEG = Math.PI / 180;

/**
 * FPS Shooter Arena (Sketchfab / playground style). Visuals come from the
 * authored GLB; brushes are invisible collision hulls measured from the mesh
 * AABB after the FBX 0.01 scale, then shifted so the floor is centered at origin.
 *
 * Raw world center ≈ (−25, 3, 25). Offset (+25, 0, −25) → playable 50×50 m yard.
 */
const OX = 25;
const OZ = -25;

const materials: Record<string, MaterialDef> = {
  floor: {
    color: 0x2a2a2a,
    roughness: 0.95,
    metalness: 0.02,
    surface: 'concrete',
    texture: 'asphalt',
    textureScale: 14,
  },
  wall: {
    color: 0x1a1a1a,
    roughness: 0.9,
    metalness: 0.05,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 4,
  },
  cover: {
    color: 0xe07030,
    roughness: 0.75,
    metalness: 0.08,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 2,
  },
  pillar: {
    color: 0xd06028,
    roughness: 0.7,
    metalness: 0.1,
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
    position: [cx + OX, cy, cz + OZ],
    size: [sx, sy, sz],
    material,
    invisible: true,
  };
}

// Measured AABBs from fps_shooter_game_arena_map_v4.glb (world space, pre-offset).
const brushes: Brush[] = [
  // Floor
  hull(-24.99, 0.49, 25.02, 50, 1, 50, 'floor'),
  // Perimeter walls
  hull(-49.49, 2.99, 24.52, 1, 4, 49, 'wall'),
  hull(-24.49, 2.99, 0.52, 49, 4, 1, 'wall'),
  hull(-0.49, 2.99, 25.52, 1, 4, 49, 'wall'),
  hull(-25.49, 2.99, 49.52, 49, 4, 1, 'wall'),
  // Orange cover blocks
  hull(-8.49, 2.99, 23.52, 5, 4, 7, 'cover'),
  hull(-18.49, 2.99, 15.02, 5, 4, 6, 'cover'),
  hull(-38.49, 2.99, 41.02, 5, 4, 10, 'cover'),
  hull(-23.99, 1.99, 29.52, 2, 2, 7, 'cover'),
  hull(-15.99, 1.99, 38.52, 2, 2, 7, 'cover'),
  hull(-31.99, 1.99, 19.52, 2, 2, 7, 'cover'),
  hull(-42.99, 1.99, 25.52, 2, 2, 7, 'cover'),
  hull(-44.49, 2.99, 12.52, 5, 4, 7, 'cover'),
  hull(-8.99, 1.99, 9.52, 2, 2, 7, 'cover'),
  hull(-32.04, 2.99, 6.19, 8.56, 4, 4.33, 'cover'),
  hull(-24.49, 2.99, 44.02, 5, 4, 6, 'cover'),
  hull(-6.99, 2.99, 42.52, 2, 4, 7, 'cover'),
  // Pillars
  hull(-18.49, 3.49, 5.52, 1, 5, 1, 'pillar'),
  hull(-43.49, 3.49, 3.52, 1, 5, 1, 'pillar'),
  hull(-14.49, 3.49, 22.52, 1, 5, 1, 'pillar'),
  hull(-6.49, 3.49, 32.52, 1, 5, 1, 'pillar'),
  hull(-32.49, 3.49, 30.52, 1, 5, 1, 'pillar'),
  hull(-45.49, 3.49, 38.52, 1, 5, 1, 'pillar'),
];

const decor: MapDecorDef[] = [
  // Shift so the GLB's world center lands on the origin.
  { model: 'arena', position: [OX, 0, OZ], scale: 1 },
];

const spawnPoints: SpawnPointDef[] = [
  { position: [-18, 1.15, -18], yaw: 45 * DEG, id: 'sw' },
  { position: [18, 1.15, 18], yaw: -135 * DEG, id: 'ne' },
  { position: [-18, 1.15, 18], yaw: 135 * DEG, id: 'nw' },
  { position: [18, 1.15, -18], yaw: -45 * DEG, id: 'se' },
  { position: [0, 1.15, -16], yaw: 0, id: 'south' },
  { position: [0, 1.15, 16], yaw: 180 * DEG, id: 'north' },
  { position: [-16, 1.15, 0], yaw: 90 * DEG, id: 'west' },
  { position: [16, 1.15, 0], yaw: -90 * DEG, id: 'east' },
];

const lights: LightDef[] = [
  { kind: 'point', position: [0, 8, 0], color: 0xfff0d8, intensity: 48, distance: 55, quality: 'high' },
  { kind: 'point', position: [-14, 6, -10], color: 0xffc878, intensity: 18, distance: 28, quality: 'medium' },
  { kind: 'point', position: [14, 6, 10], color: 0xffc878, intensity: 18, distance: 28, quality: 'medium' },
  { kind: 'point', position: [12, 6, -12], color: 0xe8f0ff, intensity: 14, distance: 24, quality: 'medium' },
  { kind: 'point', position: [-12, 6, 12], color: 0xe8f0ff, intensity: 14, distance: 24, quality: 'medium' },
];

export const ARENA: MapDefinition = {
  id: 'arena',
  name: 'CS Arena',
  description: 'Compact 50 m orange-playground arena with mid cover, pillars and hard walls.',
  author: 'RAGELAB',
  players: [2, 16],
  bounds: 28,
  killPlaneY: -10,
  environment: {
    skyTop: 0x6a90b8,
    skyBottom: 0xd8c8b0,
    sunColor: 0xffe4c0,
    sunIntensity: 2.4,
    sunDirection: [0.35, 0.88, 0.3],
    ambientColor: 0xb0c0d0,
    ambientIntensity: 0.7,
    fogColor: 0xc8ccd0,
    fogDensity: 0.0016,
    ambience: 'indoor',
  },
  materials,
  brushes,
  props: [],
  doors: [],
  switches: [],
  pickups: [
    { id: 'ar_rifle', kind: 'weapon', value: 'rifle', position: [0, 1.5, 0], respawnMs: 12000 },
    { id: 'ar_smg', kind: 'weapon', value: 'smg', position: [-10, 1.5, 8], respawnMs: 10000 },
    { id: 'ar_shot', kind: 'weapon', value: 'shotgun', position: [10, 1.5, -8], respawnMs: 10000 },
  ],
  lights,
  spawnPoints,
  decor,
};

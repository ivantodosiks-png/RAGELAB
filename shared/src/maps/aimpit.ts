import type { Brush, MapDefinition, MaterialDef, SpawnPointDef } from '../types/map';

const DEG = Math.PI / 180;
const BOUNDS = 18;

const materials: Record<string, MaterialDef> = {
  floor: {
    color: 0x6d7278,
    roughness: 0.92,
    metalness: 0.04,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 8,
  },
  wall: {
    color: 0x8b9198,
    roughness: 0.86,
    metalness: 0.06,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 5,
  },
  crate: {
    color: 0xa9793f,
    roughness: 0.78,
    metalness: 0.05,
    surface: 'wood',
    texture: 'wood',
    textureScale: 1.2,
  },
  metal: {
    color: 0x4a5158,
    roughness: 0.42,
    metalness: 0.55,
    surface: 'metal',
  },
  alpha: {
    color: 0xc45a28,
    roughness: 0.45,
    metalness: 0.2,
    emissive: 0xff6a20,
    emissiveIntensity: 0.22,
    surface: 'metal',
  },
  bravo: {
    color: 0x2f6f8a,
    roughness: 0.45,
    metalness: 0.2,
    emissive: 0x3aa0d8,
    emissiveIntensity: 0.22,
    surface: 'metal',
  },
};

const brushes: Brush[] = [];

function box(
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  material: string,
  extras: Partial<Brush> = {},
): void {
  brushes.push({
    kind: 'box',
    position: [x, y, z],
    size: [sx, sy, sz],
    material,
    ...extras,
  });
}

/** Solid crate: position is the ground footprint center. */
function crate(x: number, z: number, h = 0.9, s = 0.92): void {
  box(x, h / 2, z, s, h, s, 'crate');
}

function wallRow(x: number, z: number, sx: number, sz: number, h = 1.15): void {
  box(x, h / 2, z, sx, h, sz, 'metal');
}

// Arena shell
box(0, -0.5, 0, 28, 1, 36, 'floor');
box(0, 2.4, -17.6, 28, 4.8, 0.7, 'wall');
box(0, 2.4, 17.6, 28, 4.8, 0.7, 'wall');
box(-13.65, 2.4, 0, 0.7, 4.8, 36, 'wall');
box(13.65, 2.4, 0, 0.7, 4.8, 36, 'wall');

// Alpha spawn bay (south) — three walls + doorway toward mid
box(0, 1.5, -16.4, 10.4, 3, 0.45, 'alpha');
box(-5.1, 1.5, -14.2, 0.45, 3, 4.2, 'wall');
box(5.1, 1.5, -14.2, 0.45, 3, 4.2, 'wall');
box(-3.2, 1.5, -12.2, 3.6, 3, 0.4, 'wall');
box(3.2, 1.5, -12.2, 3.6, 3, 0.4, 'wall');
box(0, 0.06, -14.4, 9.6, 0.12, 3.6, 'alpha', { noCollide: true });

// Bravo spawn bay (north)
box(0, 1.5, 16.4, 10.4, 3, 0.45, 'bravo');
box(-5.1, 1.5, 14.2, 0.45, 3, 4.2, 'wall');
box(5.1, 1.5, 14.2, 0.45, 3, 4.2, 'wall');
box(-3.2, 1.5, 12.2, 3.6, 3, 0.4, 'wall');
box(3.2, 1.5, 12.2, 3.6, 3, 0.4, 'wall');
box(0, 0.06, 14.4, 9.6, 0.12, 3.6, 'bravo', { noCollide: true });

// Mid cover — stacked crates with real collision
crate(-2.1, 0.15, 0.9);
crate(-2.05, 0.35, 0.9);
crate(-2.1, 0.2, 1.8);
crate(2.25, -0.2, 0.9);
crate(2.3, 0.05, 1.8);
crate(0.1, 1.35, 0.7, 1.4);
crate(-0.55, -1.5, 0.9);
crate(0.55, -1.55, 0.9);

// Peek walls
wallRow(-5.4, -4.2, 3.2, 0.42, 1.2);
wallRow(5.4, 4.2, 3.2, 0.42, 1.2);
wallRow(-6.2, 3.6, 0.42, 2.6, 1.35);
wallRow(6.2, -3.6, 0.42, 2.6, 1.35);

// Side barrels as cylinders
brushes.push({ kind: 'cylinder', position: [-7.4, 0.55, -6.5], radius: 0.38, height: 1.1, material: 'metal' });
brushes.push({ kind: 'cylinder', position: [7.4, 0.55, 6.5], radius: 0.38, height: 1.1, material: 'metal' });
brushes.push({ kind: 'cylinder', position: [-7.5, 0.55, 7.2], radius: 0.38, height: 1.1, material: 'metal' });
brushes.push({ kind: 'cylinder', position: [7.5, 0.55, -7.2], radius: 0.38, height: 1.1, material: 'metal' });

const spawnPoints: SpawnPointDef[] = [
  { position: [-1.8, 1.15, -14.2], yaw: 0, team: 1, role: 'player', id: 'alpha-l' },
  { position: [0, 1.15, -14.4], yaw: 0, team: 1, role: 'player', id: 'alpha-c' },
  { position: [1.8, 1.15, -14.2], yaw: 0, team: 1, role: 'player', id: 'alpha-r' },
  { position: [-1.8, 1.15, 14.2], yaw: 180 * DEG, team: 2, role: 'player', id: 'bravo-l' },
  { position: [0, 1.15, 14.4], yaw: 180 * DEG, team: 2, role: 'player', id: 'bravo-c' },
  { position: [1.8, 1.15, 14.2], yaw: 180 * DEG, team: 2, role: 'player', id: 'bravo-r' },
];

/** Compact CS-style 1v1 pit: two bays, mid crates, solid collision. */
export const AIMPIT: MapDefinition = {
  id: 'aimpit',
  name: 'Aim Pit 1v1',
  description: 'Small duel map. Pick Alpha or Bravo — you spawn on opposite sides.',
  author: 'RAGELAB',
  players: [2, 2],
  bounds: BOUNDS,
  killPlaneY: -10,
  environment: {
    skyTop: 0x6d8498,
    skyBottom: 0xc5cdd4,
    sunColor: 0xffe6c8,
    sunIntensity: 1.85,
    sunDirection: [0.35, 0.82, 0.28],
    ambientColor: 0x9aa8b4,
    ambientIntensity: 0.7,
    fogColor: 0xb8c2cc,
    fogDensity: 0.004,
    ambience: 'indoor',
  },
  materials,
  brushes,
  props: [],
  doors: [],
  switches: [],
  pickups: [],
  lights: [
    { kind: 'point', position: [0, 5.2, 0], color: 0xfff4e0, intensity: 18, distance: 22 },
    { kind: 'point', position: [0, 4.2, -13], color: 0xff8a40, intensity: 8, distance: 10 },
    { kind: 'point', position: [0, 4.2, 13], color: 0x4aa8d8, intensity: 8, distance: 10 },
  ],
  spawnPoints,
};

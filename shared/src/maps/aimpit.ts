import type { Brush, MapDefinition, MaterialDef, SpawnPointDef } from '../types/map';

const DEG = Math.PI / 180;
const BOUNDS = 40;

const materials: Record<string, MaterialDef> = {
  floor: {
    color: 0x7a8086,
    roughness: 0.94,
    metalness: 0.03,
    surface: 'concrete',
    texture: 'asphalt',
    textureScale: 14,
  },
  wall: {
    color: 0x9aa0a6,
    roughness: 0.88,
    metalness: 0.05,
    surface: 'concrete',
    texture: 'brick',
    textureScale: 4.2,
  },
  crate: {
    color: 0xc49a5a,
    roughness: 0.72,
    metalness: 0.04,
    surface: 'wood',
    texture: 'crate',
    textureScale: 1,
  },
  wood: {
    color: 0xb8894a,
    roughness: 0.8,
    metalness: 0.03,
    surface: 'wood',
    texture: 'wood',
    textureScale: 2,
  },
  metal: {
    color: 0x8a9298,
    roughness: 0.38,
    metalness: 0.62,
    surface: 'metal',
    texture: 'metal',
    textureScale: 2.2,
  },
  drum: {
    color: 0xc45a22,
    roughness: 0.4,
    metalness: 0.45,
    surface: 'metal',
    texture: 'hazard',
    textureScale: 1.4,
  },
  brick: {
    color: 0xa24a32,
    roughness: 0.9,
    metalness: 0.02,
    surface: 'concrete',
    texture: 'brick',
    textureScale: 2.4,
  },
  alpha: {
    color: 0xc45a28,
    roughness: 0.45,
    metalness: 0.18,
    emissive: 0xff6a20,
    emissiveIntensity: 0.18,
    surface: 'metal',
    texture: 'hazard',
    textureScale: 2,
  },
  bravo: {
    color: 0x3a7a96,
    roughness: 0.45,
    metalness: 0.18,
    emissive: 0x3aa0d8,
    emissiveIntensity: 0.18,
    surface: 'metal',
    texture: 'metal',
    textureScale: 2,
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
  extras: Partial<Extract<Brush, { kind: 'box' }>> = {},
): void {
  brushes.push({
    kind: 'box',
    position: [x, y, z],
    size: [sx, sy, sz],
    material,
    ...extras,
  });
}

function crate(x: number, z: number, h = 0.95, s = 0.95, yaw = 0): void {
  box(x, h / 2, z, s, h, s, 'crate', yaw ? { rotation: [0, yaw, 0] } : {});
}

function stack(x: number, z: number, n = 2, yaw = 0): void {
  const h = 0.95;
  for (let i = 0; i < n; i++) {
    box(
      x + i * 0.03,
      h / 2 + i * h,
      z + i * 0.04,
      0.95,
      h,
      0.95,
      'crate',
      yaw ? { rotation: [0, yaw, 0] } : {},
    );
  }
}

function drum(x: number, z: number): void {
  brushes.push({ kind: 'cylinder', position: [x, 0.58, z], radius: 0.4, height: 1.16, material: 'drum' });
}

function wall(x: number, z: number, sx: number, sz: number, h = 1.2, material = 'brick'): void {
  box(x, h / 2, z, sx, h, sz, material);
}

function container(x: number, z: number, sx: number, sz: number, yaw = 0): void {
  box(x, 1.15, z, sx, 2.3, sz, 'metal', yaw ? { rotation: [0, yaw, 0] } : {});
}

function plank(x: number, z: number, sx: number, sz: number, yaw = 0): void {
  box(x, 0.12, z, sx, 0.22, sz, 'wood', yaw ? { rotation: [0, yaw, 0] } : {});
}

// ── Shell: ~56 × 72 yard ────────────────────────────────────────────────────
box(0, -0.5, 0, 56, 1, 72, 'floor');
box(0, 3.4, -35.6, 56, 6.8, 0.8, 'wall');
box(0, 3.4, 35.6, 56, 6.8, 0.8, 'wall');
box(-27.6, 3.4, 0, 0.8, 6.8, 72, 'wall');
box(27.6, 3.4, 0, 0.8, 6.8, 72, 'wall');

// ── Alpha bay (south) ───────────────────────────────────────────────────────
box(0, 1.7, -32.4, 14, 3.4, 0.5, 'alpha');
box(-6.9, 1.7, -28.8, 0.5, 3.4, 6.8, 'wall');
box(6.9, 1.7, -28.8, 0.5, 3.4, 6.8, 'wall');
box(-4.4, 1.7, -25.5, 4.8, 3.4, 0.45, 'wall');
box(4.4, 1.7, -25.5, 4.8, 3.4, 0.45, 'wall');
box(0, 0.06, -29.2, 13, 0.12, 6, 'alpha', { noCollide: true });

// ── Bravo bay (north) ───────────────────────────────────────────────────────
box(0, 1.7, 32.4, 14, 3.4, 0.5, 'bravo');
box(-6.9, 1.7, 28.8, 0.5, 3.4, 6.8, 'wall');
box(6.9, 1.7, 28.8, 0.5, 3.4, 6.8, 'wall');
box(-4.4, 1.7, 25.5, 4.8, 3.4, 0.45, 'wall');
box(4.4, 1.7, 25.5, 4.8, 3.4, 0.45, 'wall');
box(0, 0.06, 29.2, 13, 0.12, 6, 'bravo', { noCollide: true });

// ── Long lane walls (CS-style mid + sides) ──────────────────────────────────
wall(-10.5, -12, 0.55, 14, 1.5, 'brick');
wall(10.5, 12, 0.55, 14, 1.5, 'brick');
wall(-10.5, 12, 0.55, 12, 1.5, 'brick');
wall(10.5, -12, 0.55, 12, 1.5, 'brick');
wall(-18.5, 0, 0.55, 18, 1.55, 'brick');
wall(18.5, 0, 0.55, 18, 1.55, 'brick');

// Peek / cross walls
wall(-5.6, -15.5, 5.4, 0.5, 1.2, 'metal');
wall(5.6, 15.5, 5.4, 0.5, 1.2, 'metal');
wall(-5.6, 15.5, 5.4, 0.5, 1.2, 'metal');
wall(5.6, -15.5, 5.4, 0.5, 1.2, 'metal');
wall(-16.2, -20.5, 6, 0.5, 1.35, 'brick');
wall(16.2, 20.5, 6, 0.5, 1.35, 'brick');
wall(-16.2, 20.5, 6, 0.5, 1.35, 'brick');
wall(16.2, -20.5, 6, 0.5, 1.35, 'brick');
wall(0, -8.4, 3.6, 0.5, 1.05, 'metal');
wall(0, 8.4, 3.6, 0.5, 1.05, 'metal');
wall(-22.4, -8, 4.2, 0.5, 1.25, 'metal');
wall(22.4, 8, 4.2, 0.5, 1.25, 'metal');
wall(-22.4, 8, 4.2, 0.5, 1.25, 'metal');
wall(22.4, -8, 4.2, 0.5, 1.25, 'metal');

// Shipping containers as heavy cover
container(-14.2, 0, 2.4, 6.2);
container(14.2, 0, 2.4, 6.2);
container(-22.8, -26, 6.4, 2.4, 8 * DEG);
container(22.8, 26, 6.4, 2.4, 8 * DEG);
container(22.8, -26, 6.4, 2.4, -10 * DEG);
container(-22.8, 26, 6.4, 2.4, -10 * DEG);

// ── Mid crate city ──────────────────────────────────────────────────────────
stack(-2.6, 0.3, 3, 12 * DEG);
stack(2.8, -0.4, 2, -18 * DEG);
stack(0.2, 2.8, 2, 8 * DEG);
stack(-0.2, -2.9, 2, -6 * DEG);
crate(-1.3, 1.2, 0.95, 0.95, 25 * DEG);
crate(1.5, -1.4, 0.95, 0.95, -20 * DEG);
crate(4.4, 0.9, 0.7, 1.4, 8 * DEG);
crate(-4.5, -1.0, 0.7, 1.4, -10 * DEG);
stack(0, -5.2, 2, 4 * DEG);
stack(0, 5.2, 2, -8 * DEG);

// Lane crate stacks
stack(-13.4, -7.2, 2, 6 * DEG);
stack(13.6, 7.0, 2, -14 * DEG);
stack(-13.6, 7.6, 3, 20 * DEG);
stack(13.4, -7.8, 3, -8 * DEG);
stack(-6.8, -20.4, 2);
stack(6.6, 20.6, 2);
stack(7.0, -20.8, 2, 15 * DEG);
stack(-7.2, 21.0, 2, -12 * DEG);
stack(-13.8, -24.2, 2, 10 * DEG);
stack(13.6, 24.4, 2, -16 * DEG);
stack(13.8, -24.6, 3, 6 * DEG);
stack(-14.0, 24.8, 3, -10 * DEG);

crate(-19.2, -14.6, 0.95);
crate(-18.6, -15.4, 0.95, 0.95, 30 * DEG);
crate(19.0, 14.8, 0.95);
crate(19.6, 15.6, 1.9);
crate(-19.4, 14.2, 0.95, 0.95, -22 * DEG);
crate(19.2, -14.4, 0.95, 0.95, 18 * DEG);
crate(-24.2, 0.8, 0.95);
crate(24.2, -0.8, 0.95);
stack(-24.0, -16.5, 2);
stack(24.0, 16.5, 2);
stack(24.2, -16.8, 2, 12 * DEG);
stack(-24.4, 17.0, 2, -14 * DEG);

// Wood pallets / planks
plank(-8.6, -4.2, 3.0, 1.2, 18 * DEG);
plank(8.8, 4.4, 3.0, 1.2, -16 * DEG);
plank(0, 0, 3.6, 1.3, 40 * DEG);
plank(-15.6, 16.2, 2.8, 1.2, 8 * DEG);
plank(15.8, -16.4, 2.8, 1.2, -10 * DEG);
box(-12.6, 0.18, 16.4, 2.8, 0.22, 1.5, 'wood', { rotation: [0, 12 * DEG, 0] });
box(12.8, 0.18, -16.6, 2.8, 0.22, 1.5, 'wood', { rotation: [0, -14 * DEG, 0] });

brushes.push({
  kind: 'ramp',
  position: [-20.4, 0.75, -4],
  size: [2.6, 0.28, 6],
  angle: 16,
  yaw: 90 * DEG,
  material: 'wood',
});
brushes.push({
  kind: 'ramp',
  position: [20.4, 0.75, 4],
  size: [2.6, 0.28, 6],
  angle: 16,
  yaw: -90 * DEG,
  material: 'wood',
});
brushes.push({
  kind: 'ramp',
  position: [-8.2, 0.55, -24.8],
  size: [2.2, 0.24, 4.4],
  angle: 14,
  yaw: 0,
  material: 'wood',
});
brushes.push({
  kind: 'ramp',
  position: [8.2, 0.55, 24.8],
  size: [2.2, 0.24, 4.4],
  angle: 14,
  yaw: 180 * DEG,
  material: 'wood',
});

// Hazard drums
for (const [x, z] of [
  [-21.2, -10.4],
  [-20.4, -11.1],
  [21.0, 10.6],
  [21.6, 11.3],
  [-21.4, 12.2],
  [21.2, -12.0],
  [-4.6, -24.6],
  [4.7, 24.8],
  [11.4, -5.4],
  [-11.6, 5.6],
  [1.0, 13.8],
  [-0.8, -14.0],
  [-24.8, -4.2],
  [24.8, 4.4],
  [-16.8, -28.4],
  [16.8, 28.6],
  [7.4, -11.2],
  [-7.6, 11.4],
  [0.4, -18.6],
  [-0.4, 18.8],
] as const) {
  drum(x, z);
}

const spawnPoints: SpawnPointDef[] = [
  { position: [-1.6, 1.15, -29.4], yaw: 0, team: 1, role: 'player', id: 'alpha-l' },
  { position: [0, 1.15, -29.8], yaw: 0, team: 1, role: 'player', id: 'alpha-c' },
  { position: [1.6, 1.15, -29.4], yaw: 0, team: 1, role: 'player', id: 'alpha-r' },
  { position: [-1.6, 1.15, 29.4], yaw: 180 * DEG, team: 2, role: 'player', id: 'bravo-l' },
  { position: [0, 1.15, 29.8], yaw: 180 * DEG, team: 2, role: 'player', id: 'bravo-c' },
  { position: [1.6, 1.15, 29.4], yaw: 180 * DEG, team: 2, role: 'player', id: 'bravo-r' },
];

export const AIMPIT: MapDefinition = {
  id: 'aimpit',
  name: 'Aim Pit 1v1',
  description: 'Wide duel yard. Alpha and Bravo spawn on opposite sides with mid and lane cover.',
  author: 'RAGELAB',
  players: [2, 2],
  bounds: BOUNDS,
  killPlaneY: -10,
  environment: {
    skyTop: 0x6d8498,
    skyBottom: 0xc5cdd4,
    sunColor: 0xffe6c8,
    sunIntensity: 1.9,
    sunDirection: [0.32, 0.84, 0.3],
    ambientColor: 0x9aa8b4,
    ambientIntensity: 0.72,
    fogColor: 0xb8c2cc,
    fogDensity: 0.0024,
    ambience: 'indoor',
  },
  materials,
  brushes,
  props: [],
  doors: [],
  switches: [],
  pickups: [],
  lights: [
    { kind: 'point', position: [0, 8.5, 0], color: 0xfff4e0, intensity: 36, distance: 42 },
    { kind: 'point', position: [-12, 7, -14], color: 0xffe0b8, intensity: 16, distance: 22 },
    { kind: 'point', position: [12, 7, 14], color: 0xffe0b8, intensity: 16, distance: 22 },
    { kind: 'point', position: [-12, 7, 14], color: 0xffe0b8, intensity: 14, distance: 20 },
    { kind: 'point', position: [12, 7, -14], color: 0xffe0b8, intensity: 14, distance: 20 },
    { kind: 'point', position: [0, 5.6, -29], color: 0xff8a40, intensity: 12, distance: 16 },
    { kind: 'point', position: [0, 5.6, 29], color: 0x4aa8d8, intensity: 12, distance: 16 },
  ],
  spawnPoints,
};

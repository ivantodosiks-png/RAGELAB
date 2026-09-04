import type {
  Brush,
  LightDef,
  MapDecorDef,
  MapDefinition,
  MaterialDef,
  SpawnPointDef,
} from '../types/map';

const DEG = Math.PI / 180;
const BOUNDS = 40;

const materials: Record<string, MaterialDef> = {
  floor: {
    color: 0x6e747c,
    roughness: 0.95,
    metalness: 0.04,
    surface: 'concrete',
    texture: 'asphalt',
    textureScale: 12,
  },
  slab: {
    color: 0x9aa0a6,
    roughness: 0.88,
    metalness: 0.04,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 3.6,
  },
  wall: {
    color: 0x9aa0a6,
    roughness: 0.9,
    metalness: 0.04,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 3.2,
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
    roughness: 0.82,
    metalness: 0.03,
    surface: 'wood',
    texture: 'wood',
    textureScale: 1.8,
  },
  metal: {
    color: 0x7a848e,
    roughness: 0.34,
    metalness: 0.72,
    surface: 'metal',
    texture: 'metal',
    textureScale: 2.0,
  },
  drum: {
    color: 0xc45a22,
    roughness: 0.42,
    metalness: 0.48,
    surface: 'metal',
    texture: 'hazard',
    textureScale: 1.35,
  },
  brick: {
    color: 0xa24a32,
    roughness: 0.9,
    metalness: 0.02,
    surface: 'concrete',
    texture: 'brick',
    textureScale: 3.6,
  },
  grit: {
    color: 0x7a6a52,
    roughness: 0.96,
    metalness: 0,
    surface: 'sand',
    texture: 'sand',
    textureScale: 9,
  },
  paint: {
    color: 0xe8e2d4,
    roughness: 0.55,
    metalness: 0.05,
    surface: 'concrete',
    texture: 'pavement',
    textureScale: 2,
    decal: true,
  },
  alpha: {
    color: 0xd25a28,
    roughness: 0.42,
    metalness: 0.22,
    emissive: 0xff6a20,
    emissiveIntensity: 0.28,
    surface: 'metal',
    texture: 'hazard',
    textureScale: 1.8,
  },
  bravo: {
    color: 0x3a86a8,
    roughness: 0.42,
    metalness: 0.22,
    emissive: 0x3ab0e0,
    emissiveIntensity: 0.28,
    surface: 'metal',
    texture: 'metal',
    textureScale: 1.8,
  },
};

const brushes: Brush[] = [];
const decor: MapDecorDef[] = [];
const lights: LightDef[] = [];

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

function place(model: string, x: number, z: number, yaw = 0, y = 0, scale?: number): void {
  decor.push({ model, position: [x, y, z], yaw, ...(scale !== undefined ? { scale } : {}) });
}

function crate(x: number, z: number, h = 0.95, s = 0.95, yaw = 0): void {
  box(x, h / 2, z, s, h, s, 'crate', {
    invisible: true,
    ...(yaw ? { rotation: [0, yaw, 0] } : {}),
  });
  place('crate-medium', x, z, yaw, 0, s);
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
      {
        invisible: true,
        ...(yaw ? { rotation: [0, yaw, 0] } : {}),
      },
    );
    place('crate-medium', x + i * 0.03, z + i * 0.04, yaw, i * h, 0.95);
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
  box(x, 0.12, z, sx, 0.22, sz, 'wood', {
    invisible: true,
    ...(yaw ? { rotation: [0, yaw, 0] } : {}),
  });
  place('crate-wide', x, z, yaw, 0.02, Math.min(sx, sz) * 0.55);
}

// ── Shell: ~56 × 72 yard ────────────────────────────────────────────────────
box(0, -0.5, 0, 56, 1, 72, 'floor');
// Soft grit verge inside the walls for depth (no collision).
box(0, 0.02, 0, 54, 0.04, 70, 'grit', { noCollide: true });
box(0, 3.5, -35.6, 56, 7.0, 0.9, 'brick');
box(0, 3.5, 35.6, 56, 7.0, 0.9, 'brick');
box(-27.6, 3.5, 0, 0.9, 7.0, 72, 'brick');
box(27.6, 3.5, 0, 0.9, 7.0, 72, 'brick');
// Cap trim so walls read as a proper arena.
box(0, 7.05, -35.6, 56.4, 0.22, 1.1, 'metal', { noCollide: true });
box(0, 7.05, 35.6, 56.4, 0.22, 1.1, 'metal', { noCollide: true });
box(-27.6, 7.05, 0, 1.1, 0.22, 72.4, 'metal', { noCollide: true });
box(27.6, 7.05, 0, 1.1, 0.22, 72.4, 'metal', { noCollide: true });

// ── Alpha bay (south) ───────────────────────────────────────────────────────
box(0, 1.7, -32.4, 14, 3.4, 0.5, 'alpha');
box(-6.9, 1.7, -28.8, 0.5, 3.4, 6.8, 'wall');
box(6.9, 1.7, -28.8, 0.5, 3.4, 6.8, 'wall');
box(-4.4, 1.7, -25.5, 4.8, 3.4, 0.45, 'wall');
box(4.4, 1.7, -25.5, 4.8, 3.4, 0.45, 'wall');
box(0, 0.05, -29.2, 13.2, 0.1, 6.2, 'slab');
box(0, 0.11, -29.2, 12.4, 0.02, 5.4, 'alpha', { noCollide: true });
place('target-large', -3.2, -33.8, 0, 0.1);
place('target-large', 3.2, -33.8, 0, 0.1);
place('target-detail', 0, -33.9, 0, 0.1);
place('cone', -7.4, -26.2, 10 * DEG);
place('cone', 7.4, -26.2, -10 * DEG);

// ── Bravo bay (north) ───────────────────────────────────────────────────────
box(0, 1.7, 32.4, 14, 3.4, 0.5, 'bravo');
box(-6.9, 1.7, 28.8, 0.5, 3.4, 6.8, 'wall');
box(6.9, 1.7, 28.8, 0.5, 3.4, 6.8, 'wall');
box(-4.4, 1.7, 25.5, 4.8, 3.4, 0.45, 'wall');
box(4.4, 1.7, 25.5, 4.8, 3.4, 0.45, 'wall');
box(0, 0.05, 29.2, 13.2, 0.1, 6.2, 'slab');
box(0, 0.11, 29.2, 12.4, 0.02, 5.4, 'bravo', { noCollide: true });
place('target-large', -3.2, 33.8, 180 * DEG, 0.1);
place('target-large', 3.2, 33.8, 180 * DEG, 0.1);
place('target-detail', 0, 33.9, 180 * DEG, 0.1);
place('cone', -7.4, 26.2, 170 * DEG);
place('cone', 7.4, 26.2, -170 * DEG);

// Mid lane paint (raised slightly — no z-fight with grit).
box(0, 0.08, 0, 2.4, 0.02, 48, 'paint', { noCollide: true });
box(0, 0.08, 0, 18, 0.02, 0.35, 'paint', { noCollide: true });

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

// Extra range targets + construction dressing (visual only).
place('target-small', -10.8, -0.2, 90 * DEG, 0.05);
place('target-small', 10.8, 0.2, -90 * DEG, 0.05);
place('target-small', -18.2, -12.4, 40 * DEG, 0.05);
place('target-small', 18.2, 12.4, -140 * DEG, 0.05);
place('target-small', -22.0, -22.4, 25 * DEG, 0.05);
place('target-small', 22.0, 22.4, -155 * DEG, 0.05);
place('target-detail', -8.4, -28.6, 15 * DEG, 0.1);
place('target-detail', 8.4, 28.6, -165 * DEG, 0.1);
place('barrier', -9.2, -16.2, 12 * DEG);
place('barrier', 9.2, 16.2, -12 * DEG);
place('barrier', -16.8, 8.4, 90 * DEG);
place('barrier', 16.8, -8.4, -90 * DEG);
place('barrier', -4.2, -22.6, 8 * DEG);
place('barrier', 4.2, 22.6, -8 * DEG);
place('barrier', -20.4, -2.4, 90 * DEG);
place('barrier', 20.4, 2.4, -90 * DEG);
place('construction-light', -24.6, -28.4, 20 * DEG);
place('construction-light', 24.6, 28.4, -160 * DEG);
place('construction-light', -24.6, 28.4, 160 * DEG);
place('construction-light', 24.6, -28.4, -20 * DEG);
place('light-square', 0, 0, 0);
place('light-square', -14.2, -0.2, 90 * DEG);
place('light-square', 14.2, 0.2, -90 * DEG);
place('lamp', -25.2, -20, 90 * DEG);
place('lamp', 25.2, 20, -90 * DEG);
place('lamp', -25.2, 20, 90 * DEG);
place('lamp', 25.2, -20, -90 * DEG);
place('lamp', -12.4, -32.8, 0);
place('lamp', 12.4, 32.8, 180 * DEG);
place('sign', -8.8, -32.0, 0);
place('sign', 8.8, 32.0, 180 * DEG);
place('cone', -11.2, -18.4, 8 * DEG);
place('cone', 11.2, 18.4, -8 * DEG);
place('cone', -3.2, -12.6, -6 * DEG);
place('cone', 3.2, 12.6, 6 * DEG);
place('cone', -17.6, -4.2, 90 * DEG);
place('cone', 17.6, 4.2, -90 * DEG);
place('crate-small', -3.8, -7.6, 15 * DEG, 0);
place('crate-small', 3.6, 7.4, -20 * DEG, 0);
place('crate-small', -15.2, -10.8, 30 * DEG, 0);
place('crate-small', 15.0, 10.6, -25 * DEG, 0);
place('crate-wide', -6.2, -1.8, 70 * DEG, 0, 1.1);
place('crate-wide', 6.4, 1.6, -65 * DEG, 0, 1.1);
place('grenade-prop', -1.8, -3.2, 0, 0.95, 2.4);
place('grenade-prop', 2.0, 3.4, 40 * DEG, 0.95, 2.4);
place('grenade-prop', -13.2, 6.8, 20 * DEG, 1.9, 2.2);
place('grenade-prop', 13.0, -7.0, -15 * DEG, 1.9, 2.2);

// Perimeter fencing (visual).
for (const z of [-34.2, 34.2]) {
  for (let x = -22; x <= 22; x += 5.5) {
    place('fence-low', x, z, z > 0 ? 180 * DEG : 0);
  }
}
for (const x of [-26.4, 26.4]) {
  for (let z = -28; z <= 28; z += 5.5) {
    place('fence-low', x, z, x > 0 ? -90 * DEG : 90 * DEG);
  }
}

for (const [x, z] of [
  [-25.2, -20],
  [25.2, 20],
  [-25.2, 20],
  [25.2, -20],
  [-24.6, -28.4],
  [24.6, 28.4],
  [-24.6, 28.4],
  [24.6, -28.4],
] as const) {
  lights.push({
    kind: 'point',
    position: [x, 5.4, z],
    color: 0xffd8a8,
    intensity: 10,
    distance: 18,
    quality: 'medium',
  });
}

const spawnPoints: SpawnPointDef[] = [
  { position: [-1.6, 1.15, -29.4], yaw: 0, team: 1, role: 'player', id: 'alpha-l' },
  { position: [0, 1.15, -29.8], yaw: 0, team: 1, role: 'player', id: 'alpha-c' },
  { position: [1.6, 1.15, -29.4], yaw: 0, team: 1, role: 'player', id: 'alpha-r' },
  { position: [-1.6, 1.15, 29.4], yaw: 180 * DEG, team: 2, role: 'player', id: 'bravo-l' },
  { position: [0, 1.15, 29.8], yaw: 180 * DEG, team: 2, role: 'player', id: 'bravo-c' },
  { position: [1.6, 1.15, 29.4], yaw: 180 * DEG, team: 2, role: 'player', id: 'bravo-r' },
];

lights.push(
  { kind: 'point', position: [0, 9.2, 0], color: 0xfff2de, intensity: 42, distance: 46, quality: 'high' },
  { kind: 'point', position: [-12, 7.4, -14], color: 0xffe0b8, intensity: 18, distance: 24, quality: 'medium' },
  { kind: 'point', position: [12, 7.4, 14], color: 0xffe0b8, intensity: 18, distance: 24, quality: 'medium' },
  { kind: 'point', position: [-12, 7.4, 14], color: 0xffe0b8, intensity: 16, distance: 22, quality: 'medium' },
  { kind: 'point', position: [12, 7.4, -14], color: 0xffe0b8, intensity: 16, distance: 22, quality: 'medium' },
  { kind: 'point', position: [0, 5.8, -29], color: 0xff8a40, intensity: 16, distance: 18, quality: 'high' },
  { kind: 'point', position: [0, 5.8, 29], color: 0x4aa8d8, intensity: 16, distance: 18, quality: 'high' },
);

export const AIMPIT: MapDefinition = {
  id: 'aimpit',
  name: 'Aim Pit 1v1',
  description:
    'Wide duel yard with Alpha / Bravo bays, mid crate city, lane cover, range targets and shipping containers.',
  author: 'RAGELAB',
  players: [2, 2],
  bounds: BOUNDS,
  killPlaneY: -10,
  environment: {
    skyTop: 0x4a6a88,
    skyBottom: 0xd8c8b0,
    sunColor: 0xffe8c8,
    sunIntensity: 2.55,
    sunDirection: [0.38, 0.86, 0.24],
    ambientColor: 0xb0c0d0,
    ambientIntensity: 0.72,
    fogColor: 0xc8ccd2,
    fogDensity: 0.0015,
    ambience: 'indoor',
  },
  materials,
  brushes,
  props: [],
  doors: [],
  switches: [],
  pickups: [],
  lights,
  spawnPoints,
  decor,
};

import type {
  Brush,
  LightDef,
  MapDecorDef,
  MapDefinition,
  MaterialDef,
  PropDef,
  SpawnPointDef,
} from '../types/map';

const DEG = Math.PI / 180;
const TILE = 10;
const BOUNDS = 48;

const brushes: Brush[] = [];
const props: PropDef[] = [];
const decor: MapDecorDef[] = [];
const spawnPoints: SpawnPointDef[] = [];
const lights: LightDef[] = [];

function box(
  position: [number, number, number],
  size: [number, number, number],
  material: string,
  opts: { rotation?: [number, number, number]; noCollide?: boolean; invisible?: boolean } = {},
): void {
  brushes.push({ kind: 'box', position, size, material, ...opts });
}

function pillar(
  position: [number, number, number],
  radius: number,
  height: number,
  material: string,
  invisible = true,
): void {
  brushes.push({ kind: 'cylinder', position, radius, height, material, invisible });
}

function ramp(
  position: [number, number, number],
  size: [number, number, number],
  angle: number,
  material: string,
  yaw = 0,
): void {
  brushes.push({ kind: 'ramp', position, size, angle, yaw, material });
}

function place(model: string, x: number, z: number, yaw = 0, y = 0): void {
  decor.push({ model, position: [x, y, z], yaw });
}

/** Invisible AABB matching a Kenney building at scale 10, inset ~0.3 m. */
function hull(x: number, z: number, sx: number, sy: number, sz: number): void {
  box([x, sy / 2, z], [sx, sy, sz], 'concrete', { invisible: true });
}

function spawn(
  role: SpawnPointDef['role'],
  x: number,
  z: number,
  yawDeg: number,
  id?: string,
): void {
  spawnPoints.push({
    role,
    id,
    position: [x, 0.22, z],
    yaw: yawDeg * DEG,
  });
}

const materials: Record<string, MaterialDef> = {
  grass: {
    color: 0x6a8a48,
    roughness: 0.96,
    metalness: 0,
    surface: 'grass',
    texture: 'grass',
    textureScale: 36,
  },
  asphalt: {
    color: 0x45484e,
    roughness: 0.94,
    metalness: 0.03,
    surface: 'concrete',
    texture: 'asphalt',
    textureScale: 14,
  },
  pavement: {
    color: 0xb0aca4,
    roughness: 0.9,
    metalness: 0.02,
    surface: 'concrete',
    texture: 'pavement',
    textureScale: 8,
  },
  curb: {
    color: 0xc4c0b6,
    roughness: 0.82,
    metalness: 0.04,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 2.4,
  },
  brick: {
    color: 0x9a5a48,
    roughness: 0.88,
    metalness: 0.02,
    surface: 'concrete',
    texture: 'brick',
    textureScale: 5.5,
  },
  concrete: {
    color: 0x8a8e94,
    roughness: 0.9,
    metalness: 0.03,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 4.5,
  },
  metal: {
    color: 0x6a7380,
    roughness: 0.36,
    metalness: 0.82,
    surface: 'metal',
    texture: 'metal',
    textureScale: 2.8,
  },
  wood: {
    color: 0x8d6a42,
    roughness: 0.86,
    metalness: 0,
    surface: 'wood',
    texture: 'wood',
    textureScale: 2,
  },
  paint: {
    color: 0xe8e0cc,
    roughness: 0.62,
    metalness: 0.04,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 3.2,
  },
  dirt: {
    color: 0x7a6a52,
    roughness: 0.95,
    metalness: 0,
    surface: 'sand',
    texture: 'sand',
    textureScale: 10,
  },
  stall: {
    color: 0xece6d0,
    roughness: 0.55,
    metalness: 0.04,
    surface: 'concrete',
    texture: 'pavement',
    textureScale: 1.5,
    decal: true,
  },
};

// ── Ground, grass, perimeter ────────────────────────────────────────────────
// Kenney tiles sit on y=0 (road slab 0–0.20 m at scale 10). The grass slab
// tops out well below that so the two never share a plane (no z-fight).
box([0, -0.62, 0], [BOUNDS * 2, 1, BOUNDS * 2], 'grass');
// Soft dirt verge under perimeter walls so brick doesn't float on a flat green.
box([0, -0.08, -BOUNDS + 1.4], [BOUNDS * 2 - 4, 0.12, 2.2], 'dirt', { noCollide: true });
box([0, -0.08, BOUNDS - 1.4], [BOUNDS * 2 - 4, 0.12, 2.2], 'dirt', { noCollide: true });
box([-BOUNDS + 1.4, -0.08, 0], [2.2, 0.12, BOUNDS * 2 - 4], 'dirt', { noCollide: true });
box([BOUNDS - 1.4, -0.08, 0], [2.2, 0.12, BOUNDS * 2 - 4], 'dirt', { noCollide: true });
box([0, 3.4, -BOUNDS], [BOUNDS * 2, 6.8, 1.1], 'brick');
box([0, 3.4, BOUNDS], [BOUNDS * 2, 6.8, 1.1], 'brick');
box([-BOUNDS, 3.4, 0], [1.1, 6.8, BOUNDS * 2], 'brick');
box([BOUNDS, 3.4, 0], [1.1, 6.8, BOUNDS * 2], 'brick');

const ROAD_H = 0.2;
const ROAD_Y = ROAD_H / 2;

// Collision matches the Kenney road walking surface (y = 0.20). Invisible so
// the painted GLB tiles are the only visible asphalt.
box([0, ROAD_Y, 0], [90, ROAD_H, 10.2], 'asphalt', { invisible: true });
box([0, ROAD_Y, 0], [10.2, ROAD_H, 80], 'asphalt', { invisible: true });
box([35, ROAD_Y, 35], [20.2, ROAD_H, 20.2], 'asphalt', { invisible: true });
box([30, ROAD_Y, 15], [10.2, ROAD_H, 20], 'asphalt', { invisible: true });

// Sidewalk pads in grass quadrants — raised above grass, clear of road edges.
for (const x of [-12, 12]) {
  for (const z of [-12, 12]) {
    box([x, 0.055, z], [6.2, 0.11, 6.2], 'pavement');
    // Outer curb lip (not coplanar with plaza top).
    box([x, 0.12, z + 3.2], [6.4, 0.14, 0.22], 'curb', { noCollide: true });
    box([x, 0.12, z - 3.2], [6.4, 0.14, 0.22], 'curb', { noCollide: true });
    box([x + 3.2, 0.12, z], [0.22, 0.14, 6.0], 'curb', { noCollide: true });
    box([x - 3.2, 0.12, z], [0.22, 0.14, 6.0], 'curb', { noCollide: true });
  }
}

// Continuous curb strips along the cross roads (outside Kenney sidewalk lips).
for (const z of [-5.55, 5.55]) {
  for (const tx of [-3, -2, -1, 1, 2, 3]) {
    box([tx * TILE, 0.13, z], [9.2, 0.16, 0.26], 'curb', { noCollide: true });
  }
}
for (const x of [-5.55, 5.55]) {
  for (const tz of [-3, -2, -1, 1, 2, 3]) {
    box([x, 0.13, tz * TILE], [0.26, 0.16, 9.2], 'curb', { noCollide: true });
  }
}

// ── Kenney road tiles (visual) — 10 m grid, no overlapping footprints ───────
const EW = 90 * DEG;
place('road-cross', 0, 0, 0);
for (const tx of [-3, -2, -1, 1, 2, 3]) place('road-straight', tx * TILE, 0, EW);
place('road-end', -4 * TILE, 0, EW + Math.PI);
place('road-end', 4 * TILE, 0, EW);
for (const tz of [-3, -2, -1, 1, 2, 3]) place('road-straight', 0, tz * TILE, 0);
place('road-end', 0, -4 * TILE, Math.PI);
place('road-end', 0, 4 * TILE, 0);
place('road-straight', 30, 10, 0);
place('road-straight', 30, 20, 0);
place('road-square', 30, 30, 0);
place('road-square', 40, 30, 0);
place('road-square', 30, 40, 0);
place('road-square', 40, 40, 0);
place('driveway', 34, -14, 0, 0.04);

// Parking stall lines sit ABOVE the Kenney road surface (0.20) — never coplanar.
for (let i = 0; i < 5; i++) {
  const x = 26.6 + i * 3.4;
  box([x, 0.228, 30], [0.07, 0.01, 8.2], 'stall', { noCollide: true });
  box([x, 0.228, 40], [0.07, 0.01, 8.2], 'stall', { noCollide: true });
}
// End stops for each stall bay.
for (const z of [25.9, 34.1, 35.9, 44.1]) {
  for (let i = 0; i < 4; i++) {
    box([28.3 + i * 3.4, 0.228, z], [2.4, 0.01, 0.08], 'stall', { noCollide: true });
  }
}

// ── Buildings (visual + cheap hull) ─────────────────────────────────────────
place('building-a', -20, 16, 0);
hull(-20, 16, 8.2, 12.6, 8.8);

place('skyscraper-a', 18, 18, 180 * DEG);
hull(18, 18, 13.0, 28.4, 13.0);

place('building-g', -20, -16, 180 * DEG);
hull(-20, -16, 9.1, 16.4, 8.6);

place('building-d', 20, -16, 90 * DEG);
hull(20, -16, 8.6, 12.6, 8.0);

place('building-b', -34, -16, 90 * DEG);
hull(-34, -16, 9.0, 12.6, 9.4);

place('building-j', -36, 32, 0);
hull(-36, 32, 20.2, 16.4, 12.8);

place('building-l', 36, -32, 90 * DEG);
hull(36, -32, 13.4, 22.4, 13.1);

place('house-c', 42, 12, -90 * DEG);
hull(42, 12, 9.7, 10.0, 12.3);

place('house-f', -34, -32, 0);
hull(-34, -32, 13.7, 11.0, 13.5);

place('house-k', 16, -36, 180 * DEG);
hull(16, -36, 8.6, 11.2, 9.6);

place('house-p', 16, 42, 180 * DEG);
hull(16, 42, 11.8, 9.0, 9.3);

place('skyscraper-c', -16, 36, 0);
hull(-16, 36, 12.2, 26.0, 13.3);

// Courtyard brick between the west shops.
box([-27, 0.7, 0], [0.35, 1.4, 7.2], 'brick');
box([-40, 0.7, -22], [7.2, 1.4, 0.35], 'brick');

// ── Garage (open toward the SE lot / west) ──────────────────────────────────
box([40, 1.6, -18], [0.4, 3.2, 7.2], 'concrete');
box([32.4, 1.6, -21.4], [0.4, 3.2, 3.6], 'concrete');
box([36.2, 1.6, -22], [7.6, 3.2, 0.4], 'concrete');
box([36.2, 3.35, -18.6], [8.0, 0.28, 7.6], 'metal');
box([36.2, 0.05, -19.0], [7.2, 0.1, 5.8], 'concrete');

// ── Shipping containers in the SW alley ─────────────────────────────────────
box([-24, 1.3, -26], [6.1, 2.6, 2.44], 'metal');
box([-24, 3.9, -26], [6.1, 2.6, 2.44], 'metal');
box([-17.2, 1.3, -26], [6.1, 2.6, 2.44], 'metal', { rotation: [0, 22 * DEG, 0] });

// ── Courtyard / plaza dressing ──────────────────────────────────────────────
function bench(x: number, z: number, yaw: number): void {
  box([x, 0.42, z], [1.7, 0.12, 0.48], 'wood', { rotation: [0, yaw, 0] });
  box([x, 0.28, z], [1.55, 0.44, 0.08], 'wood', { rotation: [0, yaw, 0] });
  // Legs
  const ox = Math.cos(yaw);
  const oz = Math.sin(yaw);
  box([x - ox * 0.65, 0.18, z - oz * 0.65], [0.1, 0.36, 0.1], 'metal', { noCollide: true });
  box([x + ox * 0.65, 0.18, z + oz * 0.65], [0.1, 0.36, 0.1], 'metal', { noCollide: true });
}

function trash(x: number, z: number): void {
  box([x, 0.45, z], [0.42, 0.9, 0.42], 'metal', { noCollide: true });
  box([x, 0.92, z], [0.46, 0.06, 0.46], 'metal', { noCollide: true });
}

function bollard(x: number, z: number): void {
  box([x, 0.42, z], [0.18, 0.84, 0.18], 'metal', { noCollide: true });
  box([x, 0.86, z], [0.22, 0.06, 0.22], 'paint', { noCollide: true });
}

function hydrant(x: number, z: number): void {
  box([x, 0.35, z], [0.28, 0.7, 0.28], 'paint', { noCollide: true });
  box([x, 0.55, z], [0.55, 0.12, 0.18], 'paint', { noCollide: true });
}

bench(-26, 22, 0);
bench(-20, 22, 0);
bench(-12, 24, 90 * DEG);
bench(8, 12, 90 * DEG);
bench(-8, -12, 90 * DEG);
bench(10, -28, 0);
bench(12, 12, 0);
bench(-14, -14, 0);
bench(22, 12, 90 * DEG);
bench(-30, -10, 90 * DEG);

trash(-10, 14);
trash(10, -14);
trash(-28, 18);
trash(28, 18);
trash(38, -20);
trash(-18, -28);
trash(8, 40);
trash(-40, 20);

bollard(24.4, 26);
bollard(24.4, 34);
bollard(24.4, 36);
bollard(24.4, 44);
bollard(41.6, 26);
bollard(41.6, 44);
bollard(26, 12);
bollard(34, -12);

hydrant(-14, 8);
hydrant(14, -8);
hydrant(-30, 8);
hydrant(38, 18);

place('planter', -12, 22, 0);
place('planter', -44, 22, 30 * DEG);
place('planter', 10, 12, 0);
place('planter', -12, -12, 0);
place('planter', 10, 40, 15 * DEG);
place('planter', 12, -28, 20 * DEG);
place('planter', -30, 12, -10 * DEG);
place('planter', 40, 22, 0);
place('planter', -8, 40, 40 * DEG);
place('parasol', -23, 22, 20 * DEG);
place('parasol', -17, 24, -15 * DEG);
place('parasol', 8, -26, 35 * DEG);
place('path-stones', -28, 22, 0, 0.045);
place('path-long', -22, 20, 90 * DEG, 0.045);
place('path-stones', 12, -30, 90 * DEG, 0.045);
place('path-long', 10, 14, 0, 0.045);
place('path-stones', -14, 14, 45 * DEG, 0.045);

const trees: Array<[number, number, string]> = [
  [-44, 42, 'tree-large'],
  [-22, 44, 'tree-large'],
  [-8, 44, 'tree-small'],
  [24, 44, 'tree-small'],
  [44, 44, 'tree-small'],
  [-44, 18, 'tree-small'],
  [-44, -8, 'tree-small'],
  [-44, -42, 'tree-large'],
  [-20, -42, 'tree-small'],
  [8, -44, 'tree-small'],
  [44, -44, 'tree-large'],
  [44, -8, 'tree-small'],
  [-10, 12, 'tree-small'],
  [10, -12, 'tree-small'],
  [-36, 8, 'tree-small'],
  [36, 8, 'tree-small'],
  [-16, -36, 'tree-small'],
  [22, -40, 'tree-large'],
  [-40, 36, 'tree-small'],
  [12, 36, 'tree-small'],
];
for (const [x, z, model] of trees) place(model, x, z, (x + z) * 0.04);

for (let i = 0; i < 5; i++) {
  place('fence', -46 + i * 4.8, 42, 0);
  place('fence-low', 24 + i * 4.8, 42, 0);
}
place('fence', -46, 24, 90 * DEG);
place('fence', -46, 14, 90 * DEG);
place('fence-low', 42, -40, 90 * DEG);
place('fence-low', 42, -35, 90 * DEG);

box([-34, 0.7, 42], [24, 1.4, 0.18], 'wood', { invisible: true });
box([34, 0.55, 42], [22, 1.1, 0.16], 'wood', { invisible: true });
box([-46, 0.7, 19], [0.18, 1.4, 16], 'wood', { invisible: true });

// ── Lamps, signs, cones (kept off driving lanes) ────────────────────────────
const lamps: Array<[number, number, number]> = [
  [-30, 6.6, 0],
  [-10, 6.6, 0],
  [10, -6.6, Math.PI],
  [30, -6.6, Math.PI],
  [6.6, -20, -90 * DEG],
  [-6.6, 20, 90 * DEG],
  [24, 12, 0],
  [-24, 12, 0],
  [36, 24, -90 * DEG],
  [-36, -24, 90 * DEG],
  [16, -36, Math.PI],
  [-16, 36, 0],
];
for (const [x, z, yaw] of lamps) {
  place('lamp', x, z, yaw);
  pillar([x, 3.1, z], 0.12, 6.2, 'metal');
  lights.push({
    kind: 'point',
    position: [x, 5.6, z],
    color: 0xffd8a0,
    intensity: 6.8,
    distance: 15,
    quality: 'medium',
  });
}
place('lamp-curve', 42, 24, -90 * DEG);
place('lamp-curve', -42, -24, 90 * DEG);
place('light-square', 8, 8, 0);
place('light-square', -8, -8, 180 * DEG);
place('light-square', -8, 8, 90 * DEG);
place('light-square', 8, -8, -90 * DEG);
place('sign', -8, 8, 45 * DEG);
place('sign', 8, -8, 225 * DEG);
place('sign', 24, 8, 0);
place('sign', -24, -8, Math.PI);
place('sign-highway', 8, 8, -45 * DEG);
place('sign-highway-wide', -8, -8, 135 * DEG);
place('sign-highway', -24, 24, 30 * DEG);
hull(-8, 8, 0.4, 7, 0.4);
hull(8, -8, 0.4, 7, 0.4);
hull(8, 8, 0.4, 7, 0.4);
hull(-8, -8, 0.4, 7, 0.4);

place('cone', 24, 14, 0);
place('cone', 25.2, 14.4, 20 * DEG);
place('cone', 23.4, 15.0, -10 * DEG);
place('cone', 28, 22, 15 * DEG);
place('cone', 32, -12, -20 * DEG);
place('barrier', 26.4, 14.8, 18 * DEG);
place('barrier', -22, -24, 40 * DEG);
place('construction-light', 27.2, 16, 0);
box([24.6, 0.25, 14.6], [1.6, 0.5, 1.4], 'paint', { invisible: true });
box([26.4, 0.35, 14.8], [1.1, 0.7, 0.4], 'metal', { invisible: true });

// Low garden beds beside houses / plazas for depth (no overlap with roads).
box([-14, 0.2, 18], [2.4, 0.4, 1.1], 'dirt', { noCollide: true });
box([14, 0.2, -18], [2.4, 0.4, 1.1], 'dirt', { noCollide: true });
box([-32, 0.2, 28], [3.2, 0.36, 1.2], 'dirt', { noCollide: true });
box([18, 0.2, 36], [2.8, 0.36, 1.0], 'dirt', { noCollide: true });
box([-14, 0.42, 18], [2.5, 0.08, 1.2], 'curb', { noCollide: true });
box([14, 0.42, -18], [2.5, 0.08, 1.2], 'curb', { noCollide: true });

// ── Physics playground (west plaza, clear of buildings) ─────────────────────
ramp([-28, 0.85, 23], [4.2, 0.28, 6.4], 18, 'pavement', 90 * DEG);
box([-32, 0.35, 18], [5.2, 0.7, 1.2], 'concrete');
box([-26, 0.9, 16], [2.2, 1.8, 2.2], 'brick');

props.push(
  { kind: 'crate', position: [-26, 0.42, -24] },
  { kind: 'crate', position: [-25.1, 0.42, -24.4], rotation: [0, 22 * DEG, 0] },
  { kind: 'crate', position: [-25.6, 1.26, -24.1] },
  { kind: 'barrel', position: [-18, 0.48, -22] },
  { kind: 'barrel', position: [-17.2, 0.48, -22.6] },
  { kind: 'explosive_barrel', position: [-16.4, 0.48, -21.8] },
  { kind: 'canister', position: [32, 0.26, -16] },
  { kind: 'plank', position: [30.4, 0.12, -15.5], rotation: [0, 40 * DEG, 0] },
  { kind: 'ball', position: [-30, 0.36, 20] },
  { kind: 'chair', position: [-20, 0.44, 21] },
  { kind: 'crate', position: [44, 0.42, 22] },
  { kind: 'crate', position: [44.9, 0.42, 22.4] },
);

// ── Spawns (sidewalks / lots only — never in driving lanes) ─────────────────
spawn('player', -12, 12, 160, 'player-plaza');
spawn('player', 8, 10, -20, 'player-northwalk');
spawn('player', -12, -12, 20, 'player-southwalk');
spawn('player', 12, -12, 200, 'player-se');
spawn('player', -26, 18, 90, 'player-park');
spawn('player', 22, 10, 180, 'player-parking');
spawn('player', 8, -28, 0, 'player-houses');
spawn('player', -26, -12, 90, 'player-alley');
spawn('player', 8, 16, 180, 'player-north');
spawn('player', -8, -16, 0, 'player-south');
spawn('player', 30, -14, -90, 'player-garage');
spawn('player', -36, 8, 90, 'player-west');

spawn('npc', -12, 10, 0, 'npc-walk-a');
spawn('npc', 10, 12, 180, 'npc-walk-b');
spawn('npc', -12, -10, 0, 'npc-walk-c');
spawn('npc', 24, 40, 200, 'npc-park');
spawn('npc', -28, 20, 90, 'npc-plaza');
spawn('npc', 22, 14, -90, 'npc-house');
spawn('npc', -26, -22, 40, 'npc-alley');
spawn('npc', 10, -28, 0, 'npc-south');

spawn('vehicle', 27.2, 30, 0, 'stall-a1');
spawn('vehicle', 30.6, 30, 0, 'stall-a2');
spawn('vehicle', 34, 30, 0, 'stall-a3');
spawn('vehicle', 37.4, 30, 0, 'stall-a4');
spawn('vehicle', 27.2, 40, 180, 'stall-b1');
spawn('vehicle', 30.6, 40, 180, 'stall-b2');
spawn('vehicle', 42, 35, 90, 'lot-east');
spawn('vehicle', -32, 0, -90, 'street-west');
spawn('vehicle', 0, 36, 180, 'street-north');
spawn('vehicle', 38, -16, -90, 'lot-se');
spawn('vehicle', -30, 20, 90, 'plaza-lot');
spawn('vehicle', 24, -32, 0, 'south-pad');

spawn('prop', -28, 20, 0, 'prop-plaza');
spawn('prop', -22, -24, 0, 'prop-alley');
spawn('prop', 28, 20, 0, 'prop-parking');
spawn('prop', 32, -16, 0, 'prop-garage');
spawn('prop', 8, 12, 0, 'prop-corner');
spawn('prop', -8, -12, 0, 'prop-south');

lights.push(
  { kind: 'point', position: [0, 6.5, 0], color: 0xffe6c4, intensity: 6, distance: 22, quality: 'high' },
  { kind: 'point', position: [-26, 5.2, 22], color: 0xc8e4ff, intensity: 6, distance: 14, quality: 'high' },
  { kind: 'point', position: [36, 4.8, -18], color: 0xffc98a, intensity: 8, distance: 12, quality: 'high' },
);

export const HARBORLANE: MapDefinition = {
  id: 'harborlane',
  name: 'Harbor Lane',
  description:
    'A compact downtown block: crossed avenues, sidewalks, a parking lot, courtyards and a long straight for vehicles.',
  author: 'RAGELAB',
  players: [2, 16],
  bounds: BOUNDS,
  killPlaneY: -12,
  environment: {
    skyTop: 0x5a98d4,
    skyBottom: 0xf0d8b0,
    sunColor: 0xffe6c0,
    sunIntensity: 2.55,
    sunDirection: [0.52, 0.78, 0.36],
    ambientColor: 0xa8bdd4,
    ambientIntensity: 0.64,
    fogColor: 0xd0c8bc,
    fogDensity: 0.0016,
    ambience: 'yard',
  },
  materials,
  brushes,
  props,
  doors: [],
  switches: [],
  pickups: [
    { id: 'hl-pistol', kind: 'weapon', value: 'pistol', position: [-10, 1.1, 12], respawnMs: 20_000 },
    { id: 'hl-rifle', kind: 'weapon', value: 'rifle', position: [10, 1.1, -12], respawnMs: 24_000 },
    { id: 'hl-health', kind: 'health', value: 'health', amount: 50, position: [34, 1.1, -16], respawnMs: 16_000 },
    { id: 'hl-ammo', kind: 'ammo', value: 'ammo', amount: 30, position: [-24, 1.1, -24], respawnMs: 14_000 },
  ],
  lights,
  spawnPoints,
  decor,
};

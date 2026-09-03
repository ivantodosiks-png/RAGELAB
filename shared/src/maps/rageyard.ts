import type {
  Brush,
  DoorDef,
  LightDef,
  MapDefinition,
  MaterialDef,
  PickupDef,
  PropDef,
  SpawnPointDef,
  SwitchDef,
} from '../types/map';

const DEG = Math.PI / 180;

// ── Builder helpers ─────────────────────────────────────────────────────────
const brushes: Brush[] = [];
const props: PropDef[] = [];

function box(
  position: [number, number, number],
  size: [number, number, number],
  material: string,
  opts: { rotation?: [number, number, number]; noCollide?: boolean } = {},
): void {
  brushes.push({ kind: 'box', position, size, material, ...opts });
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

function pillar(
  position: [number, number, number],
  radius: number,
  height: number,
  material: string,
): void {
  brushes.push({ kind: 'cylinder', position, radius, height, material });
}

/**
 * A four-walled shell with configurable door gaps. `openings` lists which sides
 * get a doorway gap: n = -Z, s = +Z, e = +X, w = -X.
 */
function room(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  height: number,
  material: string,
  openings: string,
  wallThickness = 0.6,
  gapWidth = 3.2,
): void {
  const hw = width / 2;
  const hd = depth / 2;
  const y = height / 2;
  const t = wallThickness;

  const wall = (
    axis: 'x' | 'z',
    offset: number,
    span: number,
    hasGap: boolean,
    center: number,
  ): void => {
    if (!hasGap) {
      if (axis === 'x') box([cx + offset, y, cz], [t, height, span], material);
      else box([cx, y, cz + offset], [span, height, t], material);
      return;
    }
    const side = (span - gapWidth) / 2;
    const lintelH = Math.max(height - 2.4, 0.4);
    if (axis === 'x') {
      box([cx + offset, y, center - (gapWidth / 2 + side / 2)], [t, height, side], material);
      box([cx + offset, y, center + (gapWidth / 2 + side / 2)], [t, height, side], material);
      box([cx + offset, height - lintelH / 2, center], [t, lintelH, gapWidth], material);
    } else {
      box([center - (gapWidth / 2 + side / 2), y, cz + offset], [side, height, t], material);
      box([center + (gapWidth / 2 + side / 2), y, cz + offset], [side, height, t], material);
      box([center, height - lintelH / 2, cz + offset], [gapWidth, lintelH, t], material);
    }
  };

  wall('z', -hd, width, openings.includes('n'), cx);
  wall('z', hd, width, openings.includes('s'), cx);
  wall('x', -hw, depth, openings.includes('w'), cz);
  wall('x', hw, depth, openings.includes('e'), cz);
}

function crateStack(x: number, z: number, tiers: number, spread = 0.86): void {
  for (let t = 0; t < tiers; t++) {
    const n = tiers - t;
    for (let i = 0; i < n; i++) {
      props.push({
        kind: 'crate',
        position: [x + (i - (n - 1) / 2) * spread, 0.42 + t * 0.84, z],
        rotation: [0, (i * 17 + t * 9) * DEG, 0],
      });
    }
  }
}

// ── Materials ───────────────────────────────────────────────────────────────
const materials: Record<string, MaterialDef> = {
  ground: {
    color: 0x54585e,
    roughness: 0.93,
    metalness: 0.02,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 40,
  },
  dirt: {
    color: 0x7a6a4f,
    roughness: 0.97,
    metalness: 0.0,
    surface: 'sand',
    texture: 'sand',
    textureScale: 14,
  },
  concrete: {
    color: 0x6d7178,
    roughness: 0.88,
    metalness: 0.03,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 4,
  },
  concreteDark: {
    color: 0x474b52,
    roughness: 0.9,
    metalness: 0.04,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 5,
  },
  metal: {
    color: 0x5b636d,
    roughness: 0.42,
    metalness: 0.82,
    surface: 'metal',
    texture: 'metal',
    textureScale: 3,
  },
  metalRust: {
    color: 0x7d5a41,
    roughness: 0.62,
    metalness: 0.6,
    surface: 'metal',
    texture: 'metal',
    textureScale: 3,
  },
  containerBlue: {
    color: 0x2f5f86,
    roughness: 0.55,
    metalness: 0.55,
    surface: 'metal',
    texture: 'metal',
    textureScale: 4,
  },
  containerRed: {
    color: 0x8c3630,
    roughness: 0.55,
    metalness: 0.55,
    surface: 'metal',
    texture: 'metal',
    textureScale: 4,
  },
  containerGreen: {
    color: 0x2f6b4f,
    roughness: 0.55,
    metalness: 0.55,
    surface: 'metal',
    texture: 'metal',
    textureScale: 4,
  },
  catwalk: {
    color: 0x40454c,
    roughness: 0.5,
    metalness: 0.7,
    surface: 'metal',
    texture: 'grid',
    textureScale: 6,
  },
  wood: {
    color: 0x8a6237,
    roughness: 0.9,
    metalness: 0.0,
    surface: 'wood',
    texture: 'wood',
    textureScale: 4,
  },
  glass: {
    color: 0x9fd4e0,
    roughness: 0.08,
    metalness: 0.1,
    opacity: 0.28,
    transparent: true,
    surface: 'glass',
  },
  accent: {
    color: 0xff7a2f,
    roughness: 0.5,
    metalness: 0.3,
    emissive: 0xff5a00,
    emissiveIntensity: 0.35,
    surface: 'metal',
    texture: 'hazard',
    textureScale: 2,
  },
  lightPanel: {
    color: 0xfff2d0,
    roughness: 0.3,
    metalness: 0.0,
    emissive: 0xffe6b0,
    emissiveIntensity: 2.2,
    surface: 'glass',
  },
};

// ── Terrain & perimeter ─────────────────────────────────────────────────────
const BOUNDS = 62;

box([0, -0.5, 0], [BOUNDS * 2, 1, BOUNDS * 2], 'ground');
// Dirt patches for visual variety (no collision, sits just above the floor).
box([-34, 0.011, 30], [26, 0.02, 22], 'dirt', { noCollide: true });
box([32, 0.011, -28], [22, 0.02, 26], 'dirt', { noCollide: true });

// Perimeter walls with a lip so players cannot climb out.
const WALL_H = 9;
box([0, WALL_H / 2, -BOUNDS], [BOUNDS * 2, WALL_H, 1.2], 'concreteDark');
box([0, WALL_H / 2, BOUNDS], [BOUNDS * 2, WALL_H, 1.2], 'concreteDark');
box([-BOUNDS, WALL_H / 2, 0], [1.2, WALL_H, BOUNDS * 2], 'concreteDark');
box([BOUNDS, WALL_H / 2, 0], [1.2, WALL_H, BOUNDS * 2], 'concreteDark');

// ── Central warehouse (main fight space) ────────────────────────────────────
const WH_W = 34;
const WH_D = 26;
const WH_H = 9;
room(0, 0, WH_W, WH_D, WH_H, 'concrete', 'nsew', 0.7, 4.2);

// Roof with a skylight opening in the middle.
box([0, WH_H, -WH_D / 2 + 4.5], [WH_W, 0.5, 9], 'metal');
box([0, WH_H, WH_D / 2 - 4.5], [WH_W, 0.5, 9], 'metal');
box([-WH_W / 2 + 5.5, WH_H, 0], [11, 0.5, 8], 'metal');
box([WH_W / 2 - 5.5, WH_H, 0], [11, 0.5, 8], 'metal');
box([0, WH_H, 0], [12, 0.15, 8], 'glass', { noCollide: true });

// Interior support pillars.
for (const px of [-10, 10]) {
  for (const pz of [-7.5, 7.5]) {
    pillar([px, WH_H / 2, pz], 0.45, WH_H, 'metal');
  }
}

// Catwalk ring at 4.6m with two access ramps.
const CW_Y = 4.6;
box([-WH_W / 2 + 2.2, CW_Y, 0], [3.4, 0.25, WH_D - 2], 'catwalk');
box([WH_W / 2 - 2.2, CW_Y, 0], [3.4, 0.25, WH_D - 2], 'catwalk');
box([0, CW_Y, -WH_D / 2 + 2.2], [WH_W - 8, 0.25, 3.4], 'catwalk');
// Catwalk railings (thin, collidable so players do not fall off instantly).
box([-WH_W / 2 + 3.85, CW_Y + 0.55, 0], [0.12, 1.1, WH_D - 2], 'metalRust');
box([WH_W / 2 - 3.85, CW_Y + 0.55, 0], [0.12, 1.1, WH_D - 2], 'metalRust');
box([0, CW_Y + 0.55, -WH_D / 2 + 3.85], [WH_W - 8, 1.1, 0.12], 'metalRust');

ramp([-11.5, CW_Y / 2, 6.5], [3.2, 0.3, 9.5], 26, 'catwalk', 0);
ramp([11.5, CW_Y / 2, 6.5], [3.2, 0.3, 9.5], 26, 'catwalk', Math.PI);

// Interior half-height cover.
box([-4.5, 0.6, -2], [4.5, 1.2, 0.7], 'concreteDark');
box([4.5, 0.6, 2], [4.5, 1.2, 0.7], 'concreteDark');
box([0, 0.6, -9], [0.7, 1.2, 4], 'concreteDark');

// Ceiling light panels.
for (const lx of [-11, 11]) {
  for (const lz of [-8, 8]) {
    box([lx, WH_H - 0.6, lz], [2.6, 0.16, 2.6], 'lightPanel', { noCollide: true });
  }
}

// ── North outpost (two storey, glassed front) ───────────────────────────────
room(-30, -34, 18, 14, 4.2, 'concrete', 'se', 0.6, 3.4);
box([-30, 4.2, -34], [18, 0.4, 14], 'concrete'); // first floor slab
room(-30, -34, 18, 14, 3.6, 'concrete', 's', 0.5, 3.4);
box([-30, 7.9, -34], [18, 0.35, 14], 'metal'); // roof
box([-30, 6.2, -27.2], [12, 2.6, 0.12], 'glass', { noCollide: true });
ramp([-30, 2.1, -24], [3.6, 0.3, 9], 27, 'metal', Math.PI);
box([-21.4, 5.4, -34], [2.4, 0.3, 12], 'catwalk'); // balcony
box([-20.3, 6.0, -34], [0.12, 1.1, 12], 'metalRust');

// ── South-east workshop ─────────────────────────────────────────────────────
room(34, 30, 20, 18, 5.5, 'metalRust', 'nw', 0.55, 4.0);
box([34, 5.5, 30], [20, 0.4, 18], 'metal');
box([34, 3.4, 30], [8, 0.3, 8], 'catwalk'); // mezzanine
ramp([27.5, 1.7, 34.5], [3.2, 0.3, 7], 28, 'catwalk', 0);
box([34, 3.0, 21.2], [10, 2.2, 0.12], 'glass', { noCollide: true });

// ── Shipping containers as modular cover ────────────────────────────────────
const containerMats = ['containerBlue', 'containerRed', 'containerGreen'];
const containers: Array<[number, number, number, number]> = [
  // x, z, yaw(deg), stackHeight
  [-46, 4, 0, 2],
  [-46, 12.4, 0, 1],
  [-38, -8, 90, 1],
  [-24, 18, 12, 1],
  [-12, 34, 0, 2],
  [4, 38, 0, 1],
  [22, 44, 78, 1],
  [44, 6, 90, 2],
  [46, -14, 90, 1],
  [30, -22, 24, 1],
  [12, -36, 0, 2],
  [-6, -44, 0, 1],
  [-40, 44, 45, 1],
  [50, 48, 0, 1],
];
containers.forEach(([x, z, yawDeg, stack], i) => {
  for (let s = 0; s < stack; s++) {
    box(
      [x, 1.3 + s * 2.62, z],
      [6.1, 2.6, 2.44],
      containerMats[(i + s) % containerMats.length]!,
      { rotation: [0, yawDeg * DEG, 0] },
    );
  }
});

// Ramp onto the double-stacked container by the west wall.
ramp([-46, 1.3, -2.5], [4, 0.3, 6], 24, 'metal', 0);

// ── Scattered concrete cover + jump pads ────────────────────────────────────
const coverSpots: Array<[number, number, number]> = [
  [-18, 26, 0],
  [18, 24, 35],
  [26, 8, 0],
  [-26, -6, 60],
  [8, -20, 15],
  [-8, 46, 0],
  [40, -40, 20],
  [-50, -30, 0],
  [52, 24, 90],
];
for (const [x, z, yawDeg] of coverSpots) {
  box([x, 0.7, z], [4.2, 1.4, 0.8], 'concreteDark', { rotation: [0, yawDeg * DEG, 0] });
}

// Silos.
for (const [x, z] of [
  [-56, 24],
  [-52, 36],
  [56, -34],
] as Array<[number, number]>) {
  pillar([x, 5, z], 3.2, 10, 'metalRust');
}

// ── Sandbox props ───────────────────────────────────────────────────────────
crateStack(-14, 8, 3);
crateStack(14, -8, 2);
crateStack(-40, 20, 2);
crateStack(36, 40, 2);
crateStack(2, 30, 1);

for (const [x, z] of [
  [-6, -6],
  [-5, -7.4],
  [6, 7],
  [7.3, 6.2],
  [-20, 30],
  [20, -30],
  [42, 14],
  [-44, -20],
  [10, 44],
] as Array<[number, number]>) {
  props.push({ kind: 'barrel', position: [x, 0.5, z] });
}

for (const [x, z] of [
  [0, 11],
  [-16, -12],
  [16, 12],
  [-34, 8],
  [30, -8],
  [-2, -34],
  [38, 36],
] as Array<[number, number]>) {
  props.push({ kind: 'explosive_barrel', position: [x, 0.5, z] });
}

for (const [x, z] of [
  [-9, 3],
  [9, -3],
  [-30, -30],
  [33, 28],
] as Array<[number, number]>) {
  props.push({ kind: 'ball', position: [x, 0.4, z] });
}

for (let i = 0; i < 8; i++) {
  props.push({
    kind: 'plank',
    position: [-24 + i * 0.35, 0.1 + i * 0.14, 40 + (i % 3) * 0.4],
    rotation: [0, (i * 23) * DEG, 0],
  });
}

for (const [x, z] of [
  [-31, -33],
  [-28.5, -35],
  [34, 31],
  [-13.5, 8.2],
] as Array<[number, number]>) {
  props.push({ kind: 'chair', position: [x, 0.45, z] });
}

for (const [x, z] of [
  [-12, 5],
  [12, -5],
  [-29, -31],
  [35, 33],
  [-45, 6],
  [45, -12],
] as Array<[number, number]>) {
  props.push({ kind: 'canister', position: [x, 0.25, z] });
}

// ── Doors & switches ────────────────────────────────────────────────────────
const doors: DoorDef[] = [
  {
    id: 'wh_north_gate',
    position: [0, 2.1, -WH_D / 2],
    size: [4.2, 4.2, 0.25],
    mode: 'slide',
    travel: 4.4,
    openMs: 900,
    material: 'metal',
    requiresSwitch: 'wh_gate_switch',
  },
  {
    id: 'wh_east_door',
    position: [WH_W / 2, 2.1, 0],
    size: [0.25, 4.2, 4.2],
    yaw: 0,
    mode: 'swing',
    travel: 100 * DEG,
    openMs: 550,
    material: 'metalRust',
  },
  {
    id: 'outpost_door',
    position: [-30, 1.8, -27],
    size: [3.4, 3.6, 0.22],
    mode: 'swing',
    travel: 95 * DEG,
    openMs: 480,
    material: 'wood',
  },
  {
    id: 'workshop_door',
    position: [24, 2.3, 30],
    size: [0.22, 4.6, 4.0],
    mode: 'slide',
    travel: 4.2,
    openMs: 1100,
    material: 'metal',
    requiresSwitch: 'workshop_switch',
  },
];

const switches: SwitchDef[] = [
  {
    id: 'wh_gate_switch',
    position: [-2.4, 1.35, -WH_D / 2 + 0.9],
    yaw: 0,
    targets: ['wh_north_gate'],
    autoResetMs: 0,
    startsOn: false,
  },
  {
    id: 'workshop_switch',
    position: [26.5, 1.35, 33],
    yaw: 90 * DEG,
    targets: ['workshop_door'],
    autoResetMs: 0,
    startsOn: false,
  },
  {
    id: 'wh_lights_switch',
    position: [2.4, 1.35, -WH_D / 2 + 0.9],
    yaw: 0,
    targets: ['wh_light_a', 'wh_light_b', 'wh_light_c', 'wh_light_d'],
    autoResetMs: 0,
    startsOn: true,
  },
];

// ── Pickups ─────────────────────────────────────────────────────────────────
const pickups: PickupDef[] = [
  { id: 'pk_rifle_center', kind: 'weapon', value: 'rifle', position: [0, 0.6, 0], respawnMs: 20000 },
  { id: 'pk_sniper_cat', kind: 'weapon', value: 'sniper', position: [-14.8, 5.1, -6], respawnMs: 32000 },
  { id: 'pk_shotgun_wh', kind: 'weapon', value: 'shotgun', position: [0, 0.6, 9.5], respawnMs: 24000 },
  { id: 'pk_smg_outpost', kind: 'weapon', value: 'smg', position: [-30, 4.9, -34], respawnMs: 18000 },
  { id: 'pk_smg_work', kind: 'weapon', value: 'smg', position: [34, 3.9, 30], respawnMs: 18000 },
  { id: 'pk_health_a', kind: 'health', value: 'health', amount: 50, position: [-46, 0.6, 12.4], respawnMs: 22000 },
  { id: 'pk_health_b', kind: 'health', value: 'health', amount: 50, position: [44, 0.6, 6], respawnMs: 22000 },
  { id: 'pk_health_c', kind: 'health', value: 'health', amount: 25, position: [-12, 0.6, 34], respawnMs: 14000 },
  { id: 'pk_health_d', kind: 'health', value: 'health', amount: 25, position: [12, 0.6, -36], respawnMs: 14000 },
  { id: 'pk_ammo_a', kind: 'ammo', value: 'ammo', amount: 60, position: [-18, 0.5, 26], respawnMs: 15000 },
  { id: 'pk_ammo_b', kind: 'ammo', value: 'ammo', amount: 60, position: [18, 0.5, -26], respawnMs: 15000 },
  { id: 'pk_ammo_c', kind: 'ammo', value: 'ammo', amount: 60, position: [0, 4.9, -11], respawnMs: 15000 },
];

// ── Lights ──────────────────────────────────────────────────────────────────
const lights: LightDef[] = [
  {
    kind: 'point',
    position: [-11, 7.6, -8],
    color: 0xffe6b8,
    intensity: 22,
    distance: 22,
    quality: 'medium',
    switchId: 'wh_lights_switch',
  },
  {
    kind: 'point',
    position: [11, 7.6, -8],
    color: 0xffe6b8,
    intensity: 22,
    distance: 22,
    quality: 'medium',
    switchId: 'wh_lights_switch',
  },
  {
    kind: 'point',
    position: [-11, 7.6, 8],
    color: 0xffe6b8,
    intensity: 22,
    distance: 22,
    quality: 'high',
    switchId: 'wh_lights_switch',
  },
  {
    kind: 'point',
    position: [11, 7.6, 8],
    color: 0xffe6b8,
    intensity: 22,
    distance: 22,
    quality: 'high',
    switchId: 'wh_lights_switch',
  },
  {
    kind: 'point',
    position: [-30, 3.4, -30],
    color: 0xffc98a,
    intensity: 14,
    distance: 16,
    quality: 'high',
  },
  {
    kind: 'point',
    position: [34, 4.6, 30],
    color: 0x9fd4ff,
    intensity: 16,
    distance: 20,
    quality: 'high',
  },
];

// ── Spawn points (spread so players never spawn on each other) ──────────────
const spawnPoints: SpawnPointDef[] = [
  { position: [-46, 1.2, 20], yaw: -60 * DEG },
  { position: [46, 1.2, -20], yaw: 120 * DEG },
  { position: [-30, 5.0, -34], yaw: 180 * DEG },
  { position: [34, 6.0, 30], yaw: 0 * DEG },
  { position: [-12, 1.2, 40], yaw: 190 * DEG },
  { position: [12, 1.2, -40], yaw: 10 * DEG },
  { position: [-52, 1.2, -40], yaw: 45 * DEG },
  { position: [52, 1.2, 44], yaw: -135 * DEG },
  { position: [0, 5.1, -11], yaw: 180 * DEG },
  { position: [-20, 1.2, 0], yaw: 90 * DEG },
  { position: [20, 1.2, 0], yaw: -90 * DEG },
  { position: [-40, 1.2, -14], yaw: 70 * DEG },
  { position: [40, 1.2, 46], yaw: -150 * DEG },
  { position: [4, 1.2, 48], yaw: 175 * DEG },
  { position: [-4, 1.2, -50], yaw: -5 * DEG },
  { position: [56, 1.2, 10], yaw: -95 * DEG },
];

export const RAGEYARD: MapDefinition = {
  id: 'rageyard',
  name: 'Rage Yard',
  description:
    'An abandoned industrial yard. Central warehouse with a catwalk ring, two flanking buildings, stacked containers and a lot of things that explode.',
  author: 'RAGELAB',
  players: [2, 16],
  bounds: BOUNDS,
  killPlaneY: -12,
  environment: {
    skyTop: 0x2b4a72,
    skyBottom: 0xc9b18a,
    sunColor: 0xffe9c4,
    sunIntensity: 2.6,
    sunDirection: [0.42, 0.78, 0.46],
    ambientColor: 0x6b7d99,
    ambientIntensity: 0.65,
    fogColor: 0xa8a08e,
    fogDensity: 0.0055,
    ambience: 'yard',
  },
  materials,
  brushes,
  props,
  doors,
  switches,
  pickups,
  lights,
  spawnPoints,
};

import type { Brush, MapDefinition, MaterialDef, PropDef } from '../types/map';

const DEG = Math.PI / 180;
const BOUNDS = 30;

const materials: Record<string, MaterialDef> = {
  floor: {
    color: 0x5a6068,
    roughness: 0.9,
    metalness: 0.02,
    surface: 'concrete',
    texture: 'grid',
    textureScale: 30,
  },
  wall: {
    color: 0x6e747c,
    roughness: 0.85,
    metalness: 0.05,
    surface: 'concrete',
    texture: 'concrete',
    textureScale: 6,
  },
  accent: {
    color: 0xff7a2f,
    roughness: 0.5,
    metalness: 0.3,
    emissive: 0xff5a00,
    emissiveIntensity: 0.4,
    surface: 'metal',
  },
};

const brushes: Brush[] = [
  { kind: 'box', position: [0, -0.5, 0], size: [BOUNDS * 2, 1, BOUNDS * 2], material: 'floor' },
  { kind: 'box', position: [0, 3, -BOUNDS], size: [BOUNDS * 2, 6, 1], material: 'wall' },
  { kind: 'box', position: [0, 3, BOUNDS], size: [BOUNDS * 2, 6, 1], material: 'wall' },
  { kind: 'box', position: [-BOUNDS, 3, 0], size: [1, 6, BOUNDS * 2], material: 'wall' },
  { kind: 'box', position: [BOUNDS, 3, 0], size: [1, 6, BOUNDS * 2], material: 'wall' },
  // Stair-step test geometry.
  { kind: 'box', position: [8, 0.2, 0], size: [3, 0.4, 6], material: 'wall' },
  { kind: 'box', position: [11, 0.6, 0], size: [3, 1.2, 6], material: 'wall' },
  { kind: 'box', position: [14, 1.0, 0], size: [3, 2.0, 6], material: 'wall' },
  { kind: 'ramp', position: [-10, 1, 0], size: [4, 0.3, 10], angle: 25, yaw: 0, material: 'accent' },
  { kind: 'box', position: [0, 1.0, -12], size: [8, 2, 0.8], material: 'accent' },
  { kind: 'cylinder', position: [-6, 2, 10], radius: 0.6, height: 4, material: 'wall' },
];

const props: PropDef[] = [
  { kind: 'crate', position: [2, 0.42, 4] },
  { kind: 'crate', position: [2.9, 0.42, 4.3], rotation: [0, 20 * DEG, 0] },
  { kind: 'crate', position: [2.4, 1.26, 4.1] },
  { kind: 'barrel', position: [-3, 0.5, 4] },
  { kind: 'explosive_barrel', position: [-5, 0.5, 6] },
  { kind: 'ball', position: [0, 0.4, 8] },
  { kind: 'plank', position: [5, 0.1, -4] },
  { kind: 'canister', position: [-2, 0.25, -4] },
  { kind: 'chair', position: [4, 0.45, -6] },
];

/** Minimal map used for physics/network debugging and automated smoke tests. */
export const TESTBOX: MapDefinition = {
  id: 'testbox',
  name: 'Test Box',
  description: 'Small enclosed box for physics, movement and netcode debugging.',
  author: 'RAGELAB',
  players: [2, 8],
  bounds: BOUNDS,
  killPlaneY: -12,
  environment: {
    skyTop: 0x1a1e26,
    skyBottom: 0x39424f,
    sunColor: 0xffffff,
    sunIntensity: 1.8,
    sunDirection: [0.3, 0.85, 0.4],
    ambientColor: 0x8090a8,
    ambientIntensity: 0.9,
    fogColor: 0x2a303a,
    fogDensity: 0.008,
    ambience: 'indoor',
  },
  materials,
  brushes,
  props,
  doors: [
    {
      id: 'test_door',
      position: [0, 1.5, 6],
      size: [3, 3, 0.2],
      mode: 'swing',
      travel: 95 * DEG,
      openMs: 500,
      material: 'accent',
    },
  ],
  switches: [
    { id: 'test_switch', position: [-8, 1.35, -6], yaw: 0, targets: ['test_door'], startsOn: false },
  ],
  pickups: [
    { id: 'tb_rifle', kind: 'weapon', value: 'rifle', position: [0, 0.6, 0], respawnMs: 8000 },
    { id: 'tb_health', kind: 'health', value: 'health', amount: 50, position: [6, 0.6, 8], respawnMs: 10000 },
  ],
  lights: [],
  spawnPoints: [
    { position: [-20, 1.2, -20], yaw: 45 * DEG },
    { position: [20, 1.2, 20], yaw: -135 * DEG },
    { position: [-20, 1.2, 20], yaw: 135 * DEG },
    { position: [20, 1.2, -20], yaw: -45 * DEG },
    { position: [0, 1.2, 0], yaw: 0 },
    { position: [0, 1.2, -20], yaw: 0 },
    { position: [0, 1.2, 20], yaw: 180 * DEG },
    { position: [20, 3.2, 0], yaw: -90 * DEG },
  ],
};

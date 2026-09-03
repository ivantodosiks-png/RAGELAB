import type { Brush, MapDefinition, MaterialDef, SpawnPointDef } from '../types/map';

const DEG = Math.PI / 180;
const BOUNDS = 28;

const materials: Record<string, MaterialDef> = {
  floor: {
    color: 0x7a8086,
    roughness: 0.94,
    metalness: 0.03,
    surface: 'concrete',
    texture: 'asphalt',
    textureScale: 10,
  },
  wall: {
    color: 0x9aa0a6,
    roughness: 0.88,
    metalness: 0.05,
    surface: 'concrete',
    texture: 'brick',
    textureScale: 4.5,
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
    textureScale: 2.2,
  },
  metal: {
    color: 0x8a9298,
    roughness: 0.38,
    metalness: 0.62,
    surface: 'metal',
    texture: 'metal',
    textureScale: 2.4,
  },
  drum: {
    color: 0xc45a22,
    roughness: 0.4,
    metalness: 0.45,
    surface: 'metal',
    texture: 'hazard',
    textureScale: 1.6,
  },
  brick: {
    color: 0xa24a32,
    roughness: 0.9,
    metalness: 0.02,
    surface: 'concrete',
    texture: 'brick',
    textureScale: 2.8,
  },
  alpha: {
    color: 0xd dig65a30,
    roughness: 0.45,
    metalness: 0.18,
    emissive: 0xff6a20,
    emissiveIntensity: 0.2,
    surface: 'metal',
    texture: 'hazard',
    textureScale: 2,
  },
  bravo: {
    color: 0x3a7a96,
    roughness: 0.45,
    metalness: 0.18,
    emissive: 0x3aa0d8,
    emissiveIntensity: 0.2,
    surface: 'metal',
    texture: 'metal',
    textureScale: 2,
  },
};

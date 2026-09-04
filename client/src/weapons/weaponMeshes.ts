import * as THREE from 'three';
import type { WeaponDefinition } from '@ragelab/shared';

interface Kit {
  body: THREE.MeshPhysicalMaterial;
  accent: THREE.MeshPhysicalMaterial;
  steel: THREE.MeshPhysicalMaterial;
  polymer: THREE.MeshPhysicalMaterial;
  brass: THREE.MeshPhysicalMaterial;
  sight: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
  disposables: Array<{ dispose(): void }>;
}

function kit(def: WeaponDefinition, disposables: Array<{ dispose(): void }>): Kit {
  const body = new THREE.MeshPhysicalMaterial({
    color: def.visual.color,
    roughness: 0.32,
    metalness: 0.78,
    clearcoat: 0.18,
    clearcoatRoughness: 0.45,
    envMapIntensity: 1.15,
  });
  const accent = new THREE.MeshPhysicalMaterial({
    color: def.visual.accentColor,
    roughness: 0.38,
    metalness: 0.62,
    clearcoat: 0.12,
    clearcoatRoughness: 0.5,
    envMapIntensity: 1.05,
  });
  const steel = new THREE.MeshPhysicalMaterial({
    color: 0x6a7078,
    roughness: 0.16,
    metalness: 1,
    clearcoat: 0.45,
    clearcoatRoughness: 0.22,
    envMapIntensity: 1.4,
  });
  const polymer = new THREE.MeshPhysicalMaterial({
    color: 0x1c1e22,
    roughness: 0.72,
    metalness: 0.06,
    clearcoat: 0.08,
    clearcoatRoughness: 0.7,
    envMapIntensity: 0.55,
  });
  const brass = new THREE.MeshPhysicalMaterial({
    color: 0xc4a056,
    roughness: 0.28,
    metalness: 0.85,
    envMapIntensity: 1.2,
  });
  const sight = new THREE.MeshPhysicalMaterial({
    color: 0xb8f4ff,
    emissive: new THREE.Color(0x4ec8ee),
    emissiveIntensity: 2.2,
    roughness: 0.18,
    metalness: 0.35,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x8eb8d4,
    roughness: 0.06,
    metalness: 0.12,
    transparent: true,
    opacity: 0.55,
    envMapIntensity: 1.8,
  });
  disposables.push(body, accent, steel, polymer, brass, sight, glass);
  return { body, accent, steel, polymer, brass, sight, glass, disposables };
}

function box(
  parent: THREE.Object3D,
  mat: THREE.Material,
  size: [number, number, number],
  pos: [number, number, number],
  rot: [number, number, number] | undefined = [0, 0, 0],
  disposables: Array<{ dispose(): void }>,
  name?: string,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(...size);
  disposables.push(geo);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...pos);
  mesh.rotation.set(...(rot ?? [0, 0, 0]));
  mesh.castShadow = true;
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function cyl(
  parent: THREE.Object3D,
  mat: THREE.Material,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  pos: [number, number, number],
  rot: [number, number, number],
  disposables: Array<{ dispose(): void }>,
  segments = 16,
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
  disposables.push(geo);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

const ALONG_Z: [number, number, number] = [Math.PI / 2, 0, 0];

export interface BuiltWeapon {
  root: THREE.Group;
  magRestY: number;
}

/** Detailed first-person meshes. The rifle is an M4-style carbine. */
export function buildWeaponMesh(def: WeaponDefinition, disposables: Array<{ dispose(): void }>): BuiltWeapon {
  switch (def.id) {
    case 'rifle':
      return buildM4(def, disposables);
    case 'pistol':
    case 'glock':
      return buildPistol(def, disposables);
    case 'magnum':
      return buildMagnum(def, disposables);
    case 'smg':
      return buildSmg(def, disposables);
    case 'shotgun':
      return buildShotgun(def, disposables);
    case 'sniper':
      return buildSniper(def, disposables);
    default:
      return buildM4(def, disposables);
  }
}

function buildM4(def: WeaponDefinition, disposables: Array<{ dispose(): void }>): BuiltWeapon {
  const k = kit(def, disposables);
  const root = new THREE.Group();
  root.name = 'm4';

  // Lower / upper receiver
  box(root, k.body, [0.042, 0.05, 0.21], [0, 0.008, 0.018], undefined, disposables);
  box(root, k.steel, [0.04, 0.036, 0.23], [0, 0.044, -0.01], undefined, disposables);
  box(root, k.steel, [0.038, 0.012, 0.16], [0, 0.064, 0.0], undefined, disposables);

  // Ejection port + brass-colored bolt glimpse
  box(root, k.polymer, [0.002, 0.018, 0.055], [0.021, 0.046, -0.015], undefined, disposables);
  box(root, k.brass, [0.01, 0.014, 0.04], [0.014, 0.046, -0.012], undefined, disposables);
  box(root, k.accent, [0.014, 0.018, 0.036], [0.024, 0.048, -0.05], undefined, disposables);

  // Charging handle
  box(root, k.steel, [0.038, 0.008, 0.03], [0, 0.068, 0.09], undefined, disposables);
  box(root, k.steel, [0.05, 0.007, 0.012], [0, 0.07, 0.108], undefined, disposables);

  // Magazine well + STANAG mag with ribbing
  box(root, k.body, [0.034, 0.032, 0.058], [0, -0.022, 0.016], undefined, disposables);
  const mag = box(
    root,
    k.polymer,
    [0.03, 0.118, 0.05],
    [0, -0.09, 0.016],
    [0.14, 0, 0],
    disposables,
    'magazine',
  );
  box(mag, k.accent, [0.028, 0.006, 0.022], [0, -0.052, 0], undefined, disposables);
  for (const y of [-0.02, 0.01, 0.04]) {
    box(mag, k.body, [0.032, 0.004, 0.044], [0, y, 0], undefined, disposables);
  }

  // Pistol grip
  box(root, k.polymer, [0.03, 0.1, 0.034], [0, -0.068, 0.082], [0.46, 0, 0], disposables);
  box(root, k.polymer, [0.028, 0.03, 0.03], [0, -0.11, 0.1], [0.2, 0, 0], disposables);

  // Trigger + guard
  box(root, k.steel, [0.004, 0.018, 0.01], [0, -0.01, 0.052], [0.25, 0, 0], disposables);
  box(root, k.steel, [0.022, 0.004, 0.042], [0, -0.024, 0.058], undefined, disposables);
  box(root, k.steel, [0.004, 0.02, 0.004], [0.01, -0.032, 0.076], undefined, disposables);
  box(root, k.steel, [0.004, 0.02, 0.004], [-0.01, -0.032, 0.076], undefined, disposables);

  // Fire selector
  box(root, k.steel, [0.018, 0.004, 0.01], [0.022, 0.02, 0.07], [0, 0, 0.4], disposables);

  // Buffer tube + collapsible stock
  cyl(root, k.steel, 0.015, 0.015, 0.17, [0, 0.02, 0.175], ALONG_Z, disposables, 14);
  box(root, k.polymer, [0.042, 0.058, 0.15], [0, 0.006, 0.28], undefined, disposables);
  box(root, k.polymer, [0.04, 0.078, 0.022], [0, -0.012, 0.352], undefined, disposables);
  box(root, k.polymer, [0.038, 0.016, 0.09], [0, -0.028, 0.3], undefined, disposables);

  // Handguard with rails
  box(root, k.accent, [0.044, 0.044, 0.24], [0, 0.04, -0.22], undefined, disposables);
  box(root, k.steel, [0.048, 0.01, 0.22], [0, 0.066, -0.22], undefined, disposables);
  box(root, k.steel, [0.01, 0.032, 0.22], [0.026, 0.04, -0.22], undefined, disposables);
  box(root, k.steel, [0.01, 0.032, 0.22], [-0.026, 0.04, -0.22], undefined, disposables);
  box(root, k.steel, [0.03, 0.008, 0.22], [0, 0.016, -0.22], undefined, disposables);
  for (let i = 0; i < 9; i++) {
    const z = -0.12 - i * 0.024;
    box(root, k.body, [0.046, 0.006, 0.008], [0, 0.072, z], undefined, disposables);
  }

  // Barrel nut + barrel + gas tube
  cyl(root, k.steel, 0.016, 0.016, 0.028, [0, 0.04, -0.1], ALONG_Z, disposables, 12);
  cyl(root, k.steel, 0.009, 0.011, 0.36, [0, 0.04, -0.44], ALONG_Z, disposables, 18);
  cyl(root, k.steel, 0.004, 0.004, 0.2, [0, 0.058, -0.28], ALONG_Z, disposables, 8);

  // Gas block / front sight
  box(root, k.body, [0.02, 0.032, 0.032], [0, 0.058, -0.38], undefined, disposables);
  box(root, k.steel, [0.006, 0.026, 0.006], [0.006, 0.082, -0.38], undefined, disposables);
  box(root, k.steel, [0.006, 0.026, 0.006], [-0.006, 0.082, -0.38], undefined, disposables);
  box(root, k.sight, [0.004, 0.01, 0.004], [0, 0.094, -0.38], undefined, disposables);

  // Carry handle / rear sight
  box(root, k.body, [0.032, 0.01, 0.1], [0, 0.074, 0.018], undefined, disposables);
  box(root, k.body, [0.007, 0.03, 0.01], [0.012, 0.09, 0.055], undefined, disposables);
  box(root, k.body, [0.007, 0.03, 0.01], [-0.012, 0.09, 0.055], undefined, disposables);
  box(root, k.sight, [0.005, 0.01, 0.005], [0, 0.1, 0.052], undefined, disposables);

  // A2-style birdcage flash hider
  cyl(root, k.steel, 0.013, 0.011, 0.046, [0, 0.04, -0.63], ALONG_Z, disposables, 12);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    box(
      root,
      k.steel,
      [0.004, 0.022, 0.02],
      [Math.sin(a) * 0.012, 0.04 + Math.cos(a) * 0.012, -0.648],
      [0, 0, -a],
      disposables,
    );
  }

  return { root, magRestY: mag.position.y };
}

function buildMagnum(def: WeaponDefinition, disposables: Array<{ dispose(): void }>): BuiltWeapon {
  const k = kit(def, disposables);
  const root = new THREE.Group();
  root.name = 'magnum';

  box(root, k.steel, [0.046, 0.04, 0.24], [0, 0.03, -0.02], undefined, disposables);
  box(root, k.body, [0.044, 0.03, 0.2], [0, 0.004, 0.01], undefined, disposables);
  box(root, k.brass, [0.048, 0.008, 0.22], [0, 0.052, -0.03], undefined, disposables);
  cyl(root, k.steel, 0.012, 0.012, 0.18, [0, 0.028, -0.16], ALONG_Z, disposables, 16);
  cyl(root, k.brass, 0.016, 0.014, 0.036, [0, 0.028, -0.255], ALONG_Z, disposables, 12);
  for (const z of [-0.248, -0.258, -0.268]) {
    box(root, k.body, [0.028, 0.004, 0.008], [0, 0.04, z], undefined, disposables);
  }
  const mag = box(root, k.polymer, [0.032, 0.1, 0.04], [0, -0.062, 0.032], [0.12, 0, 0], disposables, 'magazine');
  box(mag, k.brass, [0.03, 0.008, 0.02], [0, -0.042, 0], undefined, disposables);
  box(root, k.polymer, [0.036, 0.12, 0.044], [0, -0.078, 0.072], [0.32, 0, 0], disposables);
  box(root, k.brass, [0.01, 0.022, 0.012], [0, -0.008, 0.048], [0.2, 0, 0], disposables);
  box(root, k.steel, [0.024, 0.005, 0.036], [0, -0.022, 0.058], undefined, disposables);
  box(root, k.sight, [0.006, 0.014, 0.006], [0, 0.058, -0.12], undefined, disposables);
  box(root, k.body, [0.02, 0.012, 0.01], [0, 0.056, 0.08], undefined, disposables);
  box(root, k.brass, [0.008, 0.008, 0.008], [0.022, 0.02, 0.06], undefined, disposables);
  return { root, magRestY: mag.position.y };
}

function buildPistol(def: WeaponDefinition, disposables: Array<{ dispose(): void }>): BuiltWeapon {
  const k = kit(def, disposables);
  const root = new THREE.Group();
  box(root, k.steel, [0.034, 0.03, 0.17], [0, 0.022, -0.02], undefined, disposables);
  box(root, k.body, [0.032, 0.024, 0.15], [0, 0.002, 0.0], undefined, disposables);
  cyl(root, k.steel, 0.0075, 0.0075, 0.13, [0, 0.02, -0.11], ALONG_Z, disposables, 14);
  cyl(root, k.steel, 0.01, 0.009, 0.018, [0, 0.02, -0.175], ALONG_Z, disposables, 10);
  const mag = box(root, k.accent, [0.026, 0.085, 0.032], [0, -0.052, 0.028], [0.16, 0, 0], disposables, 'magazine');
  box(root, k.polymer, [0.03, 0.088, 0.036], [0, -0.058, 0.058], [0.3, 0, 0], disposables);
  box(root, k.steel, [0.004, 0.016, 0.01], [0, -0.006, 0.04], [0.2, 0, 0], disposables);
  box(root, k.steel, [0.02, 0.004, 0.028], [0, -0.018, 0.048], undefined, disposables);
  box(root, k.sight, [0.005, 0.012, 0.005], [0, 0.042, -0.09], undefined, disposables);
  box(root, k.body, [0.018, 0.01, 0.008], [0, 0.04, 0.055], undefined, disposables);
  return { root, magRestY: mag.position.y };
}

function buildSmg(def: WeaponDefinition, disposables: Array<{ dispose(): void }>): BuiltWeapon {
  const k = kit(def, disposables);
  const root = new THREE.Group();
  box(root, k.body, [0.04, 0.052, 0.24], [0, 0.012, -0.02], undefined, disposables);
  cyl(root, k.steel, 0.011, 0.011, 0.22, [0, 0.032, -0.22], ALONG_Z, disposables, 14);
  cyl(root, k.steel, 0.014, 0.012, 0.04, [0, 0.032, -0.34], ALONG_Z, disposables, 10);
  box(root, k.accent, [0.042, 0.022, 0.18], [0, 0.044, -0.12], undefined, disposables);
  const mag = box(root, k.polymer, [0.02, 0.15, 0.042], [0, -0.086, -0.02], [0.06, 0, 0], disposables, 'magazine');
  box(root, k.polymer, [0.032, 0.095, 0.032], [0, -0.062, 0.085], [0.38, 0, 0], disposables);
  box(root, k.polymer, [0.032, 0.042, 0.13], [0, 0.012, 0.17], undefined, disposables);
  box(root, k.sight, [0.004, 0.018, 0.004], [0, 0.062, -0.24], undefined, disposables);
  box(root, k.steel, [0.036, 0.008, 0.05], [0, 0.04, 0.1], undefined, disposables);
  return { root, magRestY: mag.position.y };
}

function buildShotgun(def: WeaponDefinition, disposables: Array<{ dispose(): void }>): BuiltWeapon {
  const k = kit(def, disposables);
  const root = new THREE.Group();
  cyl(root, k.steel, 0.013, 0.013, 0.46, [0, 0.032, -0.22], ALONG_Z, disposables, 16);
  cyl(root, k.accent, 0.011, 0.011, 0.34, [0, 0.01, -0.14], ALONG_Z, disposables, 12);
  box(root, k.body, [0.042, 0.054, 0.18], [0, 0.012, 0.06], undefined, disposables);
  const mag = box(root, k.polymer, [0.038, 0.042, 0.13], [0, -0.018, -0.08], undefined, disposables, 'magazine');
  box(root, k.polymer, [0.034, 0.1, 0.036], [0, -0.058, 0.085], [0.32, 0, 0], disposables);
  box(root, k.polymer, [0.038, 0.055, 0.18], [0, 0.002, 0.22], undefined, disposables);
  box(root, k.steel, [0.036, 0.02, 0.05], [0, 0.04, 0.12], undefined, disposables);
  cyl(root, k.steel, 0.016, 0.014, 0.03, [0, 0.032, -0.46], ALONG_Z, disposables, 10);
  return { root, magRestY: mag.position.y };
}

function buildSniper(def: WeaponDefinition, disposables: Array<{ dispose(): void }>): BuiltWeapon {
  const k = kit(def, disposables);
  const root = new THREE.Group();
  box(root, k.body, [0.038, 0.042, 0.3], [0, 0.002, 0.02], undefined, disposables);
  cyl(root, k.steel, 0.008, 0.01, 0.58, [0, 0.022, -0.34], ALONG_Z, disposables, 18);
  cyl(root, k.accent, 0.017, 0.017, 0.2, [0, 0.058, -0.02], ALONG_Z, disposables, 16);
  cyl(root, k.glass, 0.014, 0.014, 0.04, [0, 0.058, 0.09], ALONG_Z, disposables, 12);
  cyl(root, k.steel, 0.021, 0.021, 0.04, [0, 0.058, 0.085], ALONG_Z, disposables, 12);
  cyl(root, k.steel, 0.019, 0.019, 0.032, [0, 0.058, -0.13], ALONG_Z, disposables, 12);
  const mag = box(root, k.polymer, [0.03, 0.074, 0.052], [0, -0.052, 0.0], undefined, disposables, 'magazine');
  box(root, k.polymer, [0.042, 0.052, 0.24], [0, -0.012, 0.22], undefined, disposables);
  box(root, k.polymer, [0.04, 0.08, 0.024], [0, -0.02, 0.34], undefined, disposables);
  box(root, k.sight, [0.006, 0.006, 0.006], [0, 0.058, -0.13], undefined, disposables);
  box(root, k.steel, [0.004, 0.05, 0.004], [0.018, -0.02, -0.18], undefined, disposables);
  box(root, k.steel, [0.004, 0.05, 0.004], [-0.018, -0.02, -0.18], undefined, disposables);
  return { root, magRestY: mag.position.y };
}

export function muzzleOffsetFor(def: WeaponDefinition): [number, number, number] {
  switch (def.id) {
    case 'rifle':
      return [0, 0.04, -0.67];
    case 'pistol':
      return [0, 0.028, -0.22];
    case 'glock':
      return [0, 0.02, -0.19];
    case 'magnum':
      return [0, 0.028, -0.27];
    case 'smg':
      return [0, 0.032, -0.37];
    case 'shotgun':
      return [0, 0.032, -0.48];
    case 'sniper':
      return [0, 0.022, -0.64];
    default:
      return [0, 0.04, -0.5];
  }
}

export function ejectOffsetFor(def: WeaponDefinition): [number, number, number] {
  switch (def.id) {
    case 'rifle':
      return [0.03, 0.05, -0.015];
    case 'pistol':
    case 'glock':
    case 'magnum':
      return [0.02, 0.03, 0.0];
    default:
      return [0.04, 0.04, 0.0];
  }
}

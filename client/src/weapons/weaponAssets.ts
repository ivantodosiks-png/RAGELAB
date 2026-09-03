import * as THREE from 'three';
import { assetManager } from '../assets/assetManager';

const BASE = import.meta.env.BASE_URL;

export type WeaponModelId = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'melee';
export type SandboxWeaponKind = 'pistol' | 'rifle' | 'shotgun' | 'smg' | 'melee';

export const SANDBOX_WEAPON_KINDS: SandboxWeaponKind[] = ['pistol', 'rifle', 'shotgun', 'smg', 'melee'];

export const WEAPON_MODEL_FILES: Record<WeaponModelId, string> = {
  pistol: 'pistol.glb',
  smg: 'smg.glb',
  rifle: 'rifle.glb',
  shotgun: 'shotgun.glb',
  sniper: 'sniper.glb',
  melee: 'melee.glb',
};

export function weaponModelUrl(id: string): string | null {
  const file = WEAPON_MODEL_FILES[id as WeaponModelId];
  if (!file) return null;
  return `${BASE}models/weapons/${file}`;
}

export interface WeaponPhysDef {
  mass: number;
  hx: number;
  hy: number;
  hz: number;
  length: number;
}

export const WEAPON_PHYSICS: Record<SandboxWeaponKind, WeaponPhysDef> = {
  pistol: { mass: 1.05, hx: 0.035, hy: 0.07, hz: 0.11, length: 0.22 },
  rifle: { mass: 3.35, hx: 0.04, hy: 0.09, hz: 0.41, length: 0.82 },
  shotgun: { mass: 3.55, hx: 0.045, hy: 0.08, hz: 0.38, length: 0.78 },
  smg: { mass: 2.45, hx: 0.035, hy: 0.085, hz: 0.26, length: 0.52 },
  melee: { mass: 1.15, hx: 0.03, hy: 0.035, hz: 0.46, length: 0.92 },
};

const tmpBox = new THREE.Box3();
const tmpSize = new THREE.Vector3();
const tmpCenter = new THREE.Vector3();

/** Align the longest axis to -Z (view-model / world barrel direction) and fit length. */
export function fitWeaponModel(root: THREE.Object3D, targetLength: number, ground = false): THREE.Vector3 {
  root.updateMatrixWorld(true);
  tmpBox.setFromObject(root);
  tmpBox.getSize(tmpSize);
  if (tmpSize.y >= tmpSize.x && tmpSize.y >= tmpSize.z) {
    root.rotateX(-Math.PI / 2);
  } else if (tmpSize.x >= tmpSize.y && tmpSize.x >= tmpSize.z) {
    root.rotateY(Math.PI / 2);
  }
  root.updateMatrixWorld(true);
  tmpBox.setFromObject(root);
  tmpBox.getSize(tmpSize);
  if (tmpBox.max.z > -tmpBox.min.z) root.rotateY(Math.PI);

  root.updateMatrixWorld(true);
  tmpBox.setFromObject(root);
  tmpBox.getSize(tmpSize);
  const longest = Math.max(tmpSize.x, tmpSize.y, tmpSize.z, 0.01);
  root.scale.multiplyScalar(targetLength / longest);

  root.updateMatrixWorld(true);
  tmpBox.setFromObject(root);
  tmpBox.getCenter(tmpCenter);
  tmpBox.getSize(tmpSize);
  root.position.x -= tmpCenter.x;
  root.position.z -= tmpCenter.z;
  if (ground) root.position.y -= tmpBox.min.y;
  else root.position.y -= tmpCenter.y;
  return tmpSize.clone();
}

export function prepareWeaponVisual(
  source: THREE.Group,
  targetLength: number,
  options: { lod?: boolean; ground?: boolean; shadows?: boolean } = {},
): THREE.Object3D {
  const content = source;
  content.name = 'weaponMesh';
  content.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = options.shadows !== false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
  });
  const size = fitWeaponModel(content, targetLength, options.ground === true);

  if (!options.lod) return content;

  const lod = new THREE.LOD();
  lod.name = 'weaponLod';
  lod.addLevel(content, 0);

  const mid = content.clone(true);
  mid.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material;
    const list = Array.isArray(src) ? src : [src];
    const cheap = list.map((mat) => {
      const next = (mat as THREE.Material).clone();
      if (next instanceof THREE.MeshStandardMaterial) {
        next.envMapIntensity = 0;
        next.metalness = Math.min(next.metalness, 0.35);
      }
      return next;
    });
    mesh.material = Array.isArray(src) ? cheap : cheap[0]!;
    mesh.castShadow = false;
  });
  lod.addLevel(mid, 11);

  const farMat = new THREE.MeshStandardMaterial({
    color: 0x2a2e33,
    roughness: 0.55,
    metalness: 0.4,
  });
  const far = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), farMat);
  far.castShadow = false;
  far.frustumCulled = true;
  far.position.y = options.ground ? size.y / 2 : 0;
  lod.addLevel(far, 26);
  return lod;
}

export function instantiateWeaponVisual(
  id: string,
  targetLength: number,
  options: { lod?: boolean; ground?: boolean; shadows?: boolean } = {},
): THREE.Object3D | null {
  const url = weaponModelUrl(id);
  if (!url) return null;
  const clone = assetManager.cloneScene(url);
  if (!clone) return null;
  return prepareWeaponVisual(clone, targetLength, options);
}

export function loadWeaponModel(id: string): Promise<THREE.Group | null> {
  const url = weaponModelUrl(id);
  if (!url) return Promise.resolve(null);
  return assetManager.cloneSceneWhenReady(url);
}

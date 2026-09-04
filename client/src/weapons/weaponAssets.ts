import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getWeapon, isWeaponId } from '@ragelab/shared';
import { assetManager } from '../assets/assetManager';
import { buildWeaponMesh } from './weaponMeshes';

const BASE = import.meta.env.BASE_URL;

/** Desert Eagle by AdamKokrito — CC BY 3.0 https://poly.pizza/m/5HnKjrbxUx */
export const MAGNUM_URL = new URL('../../../assets/hammer/desert-eagle.glb', import.meta.url).href;

export type WeaponModelId = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'melee' | 'glock' | 'magnum';
export type SandboxWeaponKind = WeaponModelId;

export const SANDBOX_WEAPON_KINDS: SandboxWeaponKind[] = [
  'pistol',
  'glock',
  'magnum',
  'smg',
  'rifle',
  'shotgun',
  'sniper',
  'melee',
];

export const WEAPON_MODEL_FILES: Partial<Record<WeaponModelId, string>> = {
  pistol: 'pistol.glb',
  smg: 'smg.glb',
  rifle: 'rifle.glb',
  shotgun: 'shotgun.glb',
  sniper: 'sniper.glb',
  melee: 'melee.glb',
};

export function weaponModelUrl(id: string): string | null {
  if (id === 'magnum') return MAGNUM_URL;
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
  pistol: { mass: 1.35, hx: 0.038, hy: 0.075, hz: 0.13, length: 0.26 },
  glock: { mass: 0.95, hx: 0.032, hy: 0.065, hz: 0.1, length: 0.2 },
  magnum: { mass: 1.85, hx: 0.04, hy: 0.08, hz: 0.14, length: 0.28 },
  rifle: { mass: 3.35, hx: 0.04, hy: 0.09, hz: 0.41, length: 0.82 },
  shotgun: { mass: 3.55, hx: 0.045, hy: 0.08, hz: 0.38, length: 0.78 },
  smg: { mass: 2.45, hx: 0.035, hy: 0.085, hz: 0.26, length: 0.52 },
  sniper: { mass: 4.1, hx: 0.04, hy: 0.09, hz: 0.48, length: 1.05 },
  melee: { mass: 1.15, hx: 0.03, hy: 0.035, hz: 0.46, length: 0.92 },
};

export function weaponPhysics(kind: string): WeaponPhysDef {
  return WEAPON_PHYSICS[kind as SandboxWeaponKind] ?? WEAPON_PHYSICS.rifle;
}

const tmpBox = new THREE.Box3();
const tmpSize = new THREE.Vector3();
const tmpCenter = new THREE.Vector3();
const tmpVertex = new THREE.Vector3();

/**
 * Optional per-weapon fine-tuning after AABB fit + barrel polarity.
 * Prefer fixing orientation in fitWeaponModel; use this only for author quirks.
 */
const WEAPON_ORIENT: Partial<Record<WeaponModelId, { yaw?: number; pitch?: number; roll?: number }>> = {
  // FBX2glTF −90° X leaves the barrel on +Z after longest-axis fit.
  magnum: { yaw: Math.PI },
};

/**
 * Align the longest axis to Z (view-model barrel direction), force muzzle toward
 * -Z (camera forward), then fit length.
 */
export function fitWeaponModel(root: THREE.Object3D, targetLength: number, ground = false, id?: string): THREE.Vector3 {
  root.updateMatrixWorld(true);
  tmpBox.setFromObject(root);
  tmpBox.getSize(tmpSize);
  if (tmpSize.y >= tmpSize.x && tmpSize.y >= tmpSize.z) {
    root.rotateX(-Math.PI / 2);
  } else if (tmpSize.x >= tmpSize.y && tmpSize.x >= tmpSize.z) {
    root.rotateY(Math.PI / 2);
  }

  ensureBarrelTowardNegZ(root);

  const extra = id ? WEAPON_ORIENT[id as WeaponModelId] : undefined;
  if (extra?.pitch) root.rotateX(extra.pitch);
  if (extra?.yaw) root.rotateY(extra.yaw);
  if (extra?.roll) root.rotateZ(extra.roll);

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

/**
 * Grip / stock mass sits lower on the rear (+Z). If the lower mass is on the
 * front (-Z) half, the barrel is pointing at the camera — yaw 180°.
 */
function ensureBarrelTowardNegZ(root: THREE.Object3D): void {
  const stats = sampleZHalves(root);
  if (!stats) return;
  if (stats.frontMeanY < stats.backMeanY - 0.002) {
    root.rotateY(Math.PI);
  }
}

function sampleZHalves(root: THREE.Object3D): { frontMeanY: number; backMeanY: number } | null {
  root.updateMatrixWorld(true);
  tmpBox.setFromObject(root);
  const minZ = tmpBox.min.z;
  const maxZ = tmpBox.max.z;
  const span = maxZ - minZ;
  if (span < 1e-4) return null;
  const frontCut = minZ + span * 0.34;
  const backCut = maxZ - span * 0.34;
  let frontSum = 0;
  let frontN = 0;
  let backSum = 0;
  let backN = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      tmpVertex.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (tmpVertex.z <= frontCut) {
        frontSum += tmpVertex.y;
        frontN += 1;
      } else if (tmpVertex.z >= backCut) {
        backSum += tmpVertex.y;
        backN += 1;
      }
    }
  });
  if (frontN < 8 || backN < 8) return null;
  return { frontMeanY: frontSum / frontN, backMeanY: backSum / backN };
}

export function prepareWeaponVisual(
  source: THREE.Group,
  targetLength: number,
  options: { lod?: boolean; ground?: boolean; shadows?: boolean; id?: string } = {},
): THREE.Object3D {
  const content = source;
  content.name = 'weaponMesh';
  content.traverse((obj) => {
    if (obj.name === 'Glock19.001') obj.visible = false;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = options.shadows !== false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
      if (options.id === 'glock') {
        mat.metalness = Math.min(mat.metalness, 0.22);
        mat.roughness = Math.max(mat.roughness, 0.5);
        mat.envMapIntensity = 0.35;
        continue;
      }
      if (options.id === 'magnum') {
        mat.metalness = Math.min(mat.metalness, 0.55);
        mat.roughness = Math.max(mat.roughness, 0.28);
        mat.envMapIntensity = 0.55;
        if (/second/i.test(mat.name)) {
          mat.color.setHex(0xd4a44a);
          mat.metalness = 0.78;
          mat.roughness = 0.3;
        }
        continue;
      }
      mat.envMapIntensity = Math.min(mat.envMapIntensity, 0.55);
      mat.metalness = Math.min(mat.metalness, 0.72);
      mat.roughness = Math.max(mat.roughness, 0.28);
    }
  });
  const size =
    options.id === 'glock'
      ? fitByGeometry(content, targetLength, options.ground === true)
      : fitWeaponModel(content, targetLength, options.ground === true, options.id);

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

/** GLB if we have one, otherwise the procedural view-model mesh. */
export function createWeaponVisual(
  id: string,
  targetLength: number,
  options: { lod?: boolean; ground?: boolean; shadows?: boolean } = {},
): THREE.Object3D | null {
  const fromFile = instantiateWeaponVisual(id, targetLength, options);
  if (fromFile) return fromFile;
  if (!isWeaponId(id)) return null;
  const built = buildWeaponMesh(getWeapon(id), []);
  built.root.name = 'weaponMesh';
  built.root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = options.shadows !== false;
    mesh.receiveShadow = true;
  });
  return built.root;
}

export function instantiateWeaponVisual(
  id: string,
  targetLength: number,
  options: { lod?: boolean; ground?: boolean; shadows?: boolean } = {},
): THREE.Object3D | null {
  const url = weaponModelUrl(id);
  if (!url) return null;
  const clone = cloneWeaponScene(url, id);
  if (!clone) return null;
  return prepareWeaponVisual(clone, targetLength, { ...options, lod: id === 'glock' ? false : options.lod, id });
}

export function loadWeaponModel(id: string): Promise<THREE.Group | null> {
  const url = weaponModelUrl(id);
  if (!url) return Promise.resolve(null);
  return assetManager.loadGltf(url).then(
    () => cloneWeaponScene(url, id),
    () => null,
  );
}

export function preloadWeaponModels(): void {
  void assetManager.loadGltf(MAGNUM_URL);
}

function cloneWeaponScene(url: string, id: string): THREE.Group | null {
  const gltf = assetManager.peek(url);
  if (!gltf) return null;
  const clone = (id === 'glock' ? cloneSkinned(gltf.scene) : gltf.scene.clone(true)) as THREE.Group;
  clone.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material;
    const list = Array.isArray(src) ? src : [src];
    const copies = list.map((mat) => (mat as THREE.Material).clone());
    mesh.material = Array.isArray(src) ? copies : copies[0]!;
  });
  return clone;
}

const geomBox = new THREE.Box3();

/** Bind-pose AABB — skinned setFromObject double-counts Unity bone worlds. */
function fitByGeometry(root: THREE.Object3D, targetLength: number, ground: boolean): THREE.Vector3 {
  root.updateMatrixWorld(true);
  tmpBox.makeEmpty();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox) return;
    geomBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    tmpBox.union(geomBox);
  });
  tmpBox.getSize(tmpSize);
  const longest = Math.max(tmpSize.x, tmpSize.y, tmpSize.z, 0.01);
  root.scale.multiplyScalar(targetLength / longest);
  root.updateMatrixWorld(true);
  tmpBox.makeEmpty();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || !mesh.geometry?.boundingBox) return;
    geomBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    tmpBox.union(geomBox);
  });
  tmpBox.getCenter(tmpCenter);
  tmpBox.getSize(tmpSize);
  root.position.x -= tmpCenter.x;
  root.position.z -= tmpCenter.z;
  if (ground) root.position.y -= tmpBox.min.y;
  else root.position.y -= tmpCenter.y;
  return tmpSize.clone();
}

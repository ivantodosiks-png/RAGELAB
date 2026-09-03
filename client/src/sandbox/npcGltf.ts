import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { NpcPartId } from './types';
import type { NpcLook } from './npcModel';
import { assetManager } from '../assets/assetManager';

export const NPC_HUMANOID_URL = `${import.meta.env.BASE_URL}models/npc/humanoid.glb`;

const BONE_ALIASES: Record<NpcPartId, string[]> = {
  pelvis: ['pelvis', 'hips', 'hip'],
  torso: ['spine_02', 'spine_01', 'spine_03', 'spine', 'chest'],
  head: ['head'],
  upperArmL: ['upperarm_l', 'leftarm', 'upper_arm.l'],
  lowerArmL: ['lowerarm_l', 'leftforearm', 'forearm.l'],
  handL: ['hand_l', 'lefthand', 'hand.l'],
  upperArmR: ['upperarm_r', 'rightarm', 'upper_arm.r'],
  lowerArmR: ['lowerarm_r', 'rightforearm', 'forearm.r'],
  handR: ['hand_r', 'righthand', 'hand.r'],
  upperLegL: ['thigh_l', 'leftupleg', 'upleg.l', 'upperleg.l'],
  lowerLegL: ['calf_l', 'leftleg', 'leg.l', 'lowerleg.l'],
  footL: ['foot_l', 'leftfoot', 'foot.l'],
  upperLegR: ['thigh_r', 'rightupleg', 'upleg.r', 'upperleg.r'],
  lowerLegR: ['calf_r', 'rightleg', 'leg.r', 'lowerleg.r'],
  footR: ['foot_r', 'rightfoot', 'foot.r'],
};

const tmpMat = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const parentInv = new THREE.Matrix4();
const worldMat = new THREE.Matrix4();
/** Capsule parts are Y-up; UE mannequin bones are X-along-limb in the exported glTF. */
const Y_TO_BONE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);

export interface NpcGltfInstance {
  root: THREE.Group;
  bones: Partial<Record<NpcPartId, THREE.Bone | THREE.Object3D>>;
  bindLocal: Partial<Record<NpcPartId, THREE.Matrix4>>;
  materials: THREE.MeshStandardMaterial[];
  captured: boolean;
}

export async function preloadNpcHumanoid(): Promise<GLTF | null> {
  try {
    return await assetManager.loadGltf(NPC_HUMANOID_URL);
  } catch {
    return null;
  }
}

export function instantiateNpcHumanoid(look: NpcLook): NpcGltfInstance | null {
  const gltf = assetManager.peek(NPC_HUMANOID_URL);
  if (!gltf) return null;

  const cloned = cloneSkinned(gltf.scene) as THREE.Group;
  cloned.name = 'humanoidGltf';
  cloned.rotation.y = Math.PI;
  fitHeight(cloned, 1.72);

  const materials: THREE.MeshStandardMaterial[] = [];
  cloned.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const src = mesh.material;
    const list = Array.isArray(src) ? src : [src];
    const clones = list.map((mat, index) => {
      const next = (mat as THREE.Material).clone();
      if (next instanceof THREE.MeshStandardMaterial) {
        const joint = /joint/i.test(next.name) || /joint/i.test((mat as THREE.Material).name) || index === 1;
        next.color.setHex(joint ? look.pants : look.shirt);
        next.color.lerp(new THREE.Color(look.skin), joint ? 0.15 : 0.22);
        next.roughness = joint ? 0.38 : 0.52;
        next.metalness = joint ? 0.18 : 0.08;
        next.envMapIntensity = 1;
        next.emissive.setHex(0x000000);
        next.emissiveIntensity = 0;
        materials.push(next);
      }
      return next;
    });
    mesh.material = Array.isArray(src) ? clones : clones[0]!;
  });

  const bones: NpcGltfInstance['bones'] = {};
  cloned.updateMatrixWorld(true);
  cloned.traverse((obj) => {
    const key = obj.name.replace(/\|/g, '_').toLowerCase();
    for (const [part, aliases] of Object.entries(BONE_ALIASES) as Array<[NpcPartId, string[]]>) {
      if (bones[part]) continue;
      if (aliases.some((alias) => key === alias || key.endsWith(`_${alias}`) || key.endsWith(`.${alias}`))) {
        bones[part] = obj;
      }
    }
  });

  return { root: cloned, bones, bindLocal: {}, materials, captured: false };
}

export function captureBoneBind(
  instance: NpcGltfInstance,
  _parts: Record<NpcPartId, { group: THREE.Object3D }>,
): void {
  instance.captured = true;
}

export function driveBonesFromParts(
  instance: NpcGltfInstance,
  parts: Record<NpcPartId, { group: THREE.Object3D }>,
): void {
  if (!instance.captured) return;
  for (const [id, bone] of Object.entries(instance.bones) as Array<[NpcPartId, THREE.Object3D]>) {
    const group = parts[id]?.group;
    if (!group || !bone) continue;
    group.updateWorldMatrix(true, false);
    group.matrixWorld.decompose(tmpPos, tmpQuat, tmpScale);
    tmpQuat.multiply(Y_TO_BONE);
    setWorldTransform(bone, tmpPos, tmpQuat);
  }
}

function setWorldTransform(obj: THREE.Object3D, pos: THREE.Vector3, quat: THREE.Quaternion): void {
  const parent = obj.parent;
  if (parent) {
    parent.updateWorldMatrix(true, false);
    parentInv.copy(parent.matrixWorld).invert();
    worldMat.compose(pos, quat, obj.scale);
    tmpMat.multiplyMatrices(parentInv, worldMat);
    tmpMat.decompose(obj.position, obj.quaternion, tmpScale);
  } else {
    obj.position.copy(pos);
    obj.quaternion.copy(quat);
  }
}

function fitHeight(root: THREE.Object3D, target: number): void {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (size.y < 0.1) return;
  const scale = target / size.y;
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  const next = new THREE.Box3().setFromObject(root);
  root.position.y -= next.min.y;
}

import * as THREE from 'three';
import type { NpcPartId } from './types';
import type { NpcLook } from './npcModel';
import {
  HUMANOID_URL,
  SOLDIER_URL,
  instantiateCharacter,
  peekCharacter,
  preloadCharacter,
  randomCharacterKind,
  type CharacterKind,
  type SkinnedCharacter,
} from '../characters/skinnedHumanoid';

export const NPC_HUMANOID_URL = HUMANOID_URL;
export const NPC_SOLDIER_URL = SOLDIER_URL;

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const parentInv = new THREE.Matrix4();
const worldMat = new THREE.Matrix4();
const tmpMat = new THREE.Matrix4();
/** UE-style mannequin bones are X-along-limb; Mixamo is Y-along-limb. */
const Y_TO_UE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);

export interface NpcGltfInstance {
  character: SkinnedCharacter;
  kind: CharacterKind;
}

export async function preloadNpcHumanoid(): Promise<unknown> {
  await preloadCharacter('soldier');
  return peekCharacter('soldier');
}

export function instantiateNpcHumanoid(look: NpcLook, kind?: CharacterKind): NpcGltfInstance | null {
  const use: CharacterKind = kind ?? 'soldier';
  if (!peekCharacter(use)) return null;
  const character = instantiateCharacter(use, look);
  if (!character) return null;
  return { character, kind: use };
}

export function pickNpcKind(rng: () => number): CharacterKind {
  return randomCharacterKind(rng);
}

export function driveBonesFromParts(
  instance: NpcGltfInstance,
  parts: Record<NpcPartId, { group: THREE.Object3D }>,
): void {
  const mixamo = instance.kind === 'soldier';
  for (const [id, bone] of Object.entries(instance.character.bones) as Array<[NpcPartId, THREE.Object3D]>) {
    const group = parts[id]?.group;
    if (!group || !bone) continue;
    group.updateWorldMatrix(true, false);
    group.matrixWorld.decompose(tmpPos, tmpQuat, tmpScale);
    if (!mixamo) tmpQuat.multiply(Y_TO_UE);
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

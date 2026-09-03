import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { assetManager } from '../assets/assetManager';
import type { NpcPartId } from '../sandbox/types';
import type { NpcLook } from '../sandbox/npcModel';

const BASE = import.meta.env.BASE_URL;

/**
 * KayKit Adventurers (CC0). Real humanoid meshes with faces, hair, clothes and
 * a matching skeleton + locomotion clips. The old Mixamo Vanguard / UE mannequin
 * assets are gone — they looked like robots and their +Z bind fought the game's -Z forward.
 */
export const CHARACTER_KINDS = ['knight', 'mage', 'rogue', 'rogueHooded', 'barbarian'] as const;
export type CharacterKind = (typeof CHARACTER_KINDS)[number];
export type LocoClip = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'getup';

const KIND_FILE: Record<CharacterKind, string> = {
  knight: 'knight.glb',
  mage: 'mage.glb',
  rogue: 'rogue.glb',
  rogueHooded: 'rogue-hooded.glb',
  barbarian: 'barbarian.glb',
};

const CLIP_ALIASES: Record<LocoClip, string[]> = {
  idle: ['idle', 'unarmed_idle'],
  walk: ['walking_a', 'walking_b', 'walking_c', 'walk'],
  run: ['running_a', 'running_b', 'run'],
  jump: ['jump_start', 'jump_full_short', 'jump'],
  fall: ['jump_idle', 'jump_land', 'fall'],
  getup: ['lie_standup', 'sit_floor_standup', 'standup'],
};

const BONE_ALIASES: Record<NpcPartId, string[]> = {
  pelvis: ['hips', 'pelvis', 'hip'],
  torso: ['chest', 'spine2', 'spine1', 'spine_02', 'spine_01', 'spine'],
  head: ['head'],
  upperArmL: ['upperarm.l', 'leftarm', 'upperarm_l', 'upper_arm.l'],
  lowerArmL: ['lowerarm.l', 'leftforearm', 'lowerarm_l', 'forearm.l'],
  handL: ['hand.l', 'lefthand', 'hand_l'],
  upperArmR: ['upperarm.r', 'rightarm', 'upperarm_r', 'upper_arm.r'],
  lowerArmR: ['lowerarm.r', 'rightforearm', 'lowerarm_r', 'forearm.r'],
  handR: ['hand.r', 'righthand', 'hand_r'],
  upperLegL: ['upperleg.l', 'leftupleg', 'thigh_l', 'upleg.l'],
  lowerLegL: ['lowerleg.l', 'leftleg', 'calf_l', 'leg.l'],
  footL: ['foot.l', 'leftfoot', 'foot_l'],
  upperLegR: ['upperleg.r', 'rightupleg', 'thigh_r', 'upleg.r'],
  lowerLegR: ['lowerleg.r', 'rightleg', 'calf_r', 'leg.r'],
  footR: ['foot.r', 'rightfoot', 'foot_r'],
};

const WEAPON_NAME = /sword|shield|knife|wand|staff|bow|axe|smokebomb|spellbook|crossbow|quiver/i;

const tmpRight = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const tmpFwd = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

export function characterUrl(kind: CharacterKind): string {
  return `${BASE}models/characters/${KIND_FILE[kind]}`;
}

export function randomCharacterKind(rng: () => number): CharacterKind {
  return CHARACTER_KINDS[Math.floor(rng() * CHARACTER_KINDS.length)]!;
}

export function kindFromSeed(seed: number): CharacterKind {
  const i = ((seed % CHARACTER_KINDS.length) + CHARACTER_KINDS.length) % CHARACTER_KINDS.length;
  return CHARACTER_KINDS[i]!;
}

export async function preloadCharacter(kind: CharacterKind = 'knight'): Promise<GLTF | null> {
  try {
    return await assetManager.loadGltf(characterUrl(kind));
  } catch {
    return null;
  }
}

export async function preloadAllCharacters(): Promise<void> {
  await Promise.all(CHARACTER_KINDS.map((kind) => preloadCharacter(kind)));
}

export function peekCharacter(kind: CharacterKind): GLTF | null {
  return assetManager.peek(characterUrl(kind));
}

export class SkinnedCharacter {
  readonly root: THREE.Group;
  readonly materials: THREE.MeshStandardMaterial[] = [];
  readonly bones: Partial<Record<NpcPartId, THREE.Object3D>> = {};
  readonly extras: THREE.Object3D[] = [];
  kind: CharacterKind;
  private readonly facing = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: LocoClip | 'none' = 'none';
  private headBone: THREE.Object3D | null = null;
  private readonly headMeshes: THREE.Object3D[] = [];
  private readonly walkNames: string[];
  private readonly animRate: number;

  constructor(kind: CharacterKind, look: NpcLook) {
    this.kind = kind;
    this.animRate = look.animRate ?? 1;
    this.walkNames = look.walkVariant === 1 ? ['walking_b', 'walking_c', 'walking_a'] : ['walking_a', 'walking_b'];
    this.root = new THREE.Group();
    this.root.name = `skinned:${kind}`;
    this.facing.name = 'facing';
    this.root.add(this.facing);

    const gltf = peekCharacter(kind);
    if (!gltf) return;

    const cloned = cloneSkinned(gltf.scene) as THREE.Group;
    hideGear(cloned);
    fitHeight(cloned, 1.78 * (look.heightScale ?? 1));
    this.facing.add(cloned);

    cloned.updateMatrixWorld(true);
    this.facing.rotation.y = detectModelYawOffset(cloned);
    cloned.updateMatrixWorld(true);

    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = true;
        const src = mesh.material;
        const list = Array.isArray(src) ? src : [src];
        const clones = list.map((mat) => {
          const next = (mat as THREE.Material).clone();
          if (next instanceof THREE.MeshStandardMaterial) {
            if (look.gltfTint && look.gltfTint !== 0xffffff) {
              next.color.lerp(new THREE.Color(look.gltfTint), 0.12);
            }
            next.envMapIntensity = 1.05;
            next.emissive.setHex(0x000000);
            next.emissiveIntensity = 0;
            this.materials.push(next);
          }
          return next;
        });
        mesh.material = Array.isArray(src) ? clones : clones[0]!;
        if (/head|helmet|hood|hair|hat/i.test(mesh.name)) this.headMeshes.push(mesh);
      }
      const key = normalizeBone(obj.name);
      if (key === 'head') this.headBone = obj;
      for (const [part, aliases] of Object.entries(BONE_ALIASES) as Array<[NpcPartId, string[]]>) {
        if (this.bones[part]) continue;
        if (aliases.some((alias) => key === alias || key === alias.replace(/\./g, ''))) {
          this.bones[part] = obj;
        }
      }
    });

    if (gltf.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(cloned);
      for (const clip of gltf.animations) {
        const cleaned = stripRootMotion(clip);
        const action = this.mixer.clipAction(cleaned);
        action.enabled = true;
        this.actions.set(clip.name.toLowerCase(), action);
      }
      this.play('idle', 0);
    }
  }

  get ready(): boolean {
    return this.facing.children.length > 0;
  }

  get hasMixer(): boolean {
    return this.mixer !== null && this.actions.size > 0;
  }

  setHeadVisible(visible: boolean): void {
    if (this.headBone) this.headBone.scale.setScalar(visible ? 1 : 0.001);
    for (const mesh of this.headMeshes) mesh.visible = visible;
  }

  /** Hide head so an FPS camera can sit inside the chest. Arms stay — weapons are a separate viewmodel. */
  setFirstPersonBody(on: boolean): void {
    this.setHeadVisible(!on);
  }

  play(clip: LocoClip, fade = 0.18, timeScale = 1): void {
    if (!this.mixer) return;
    const scale = timeScale * this.animRate;
    if (this.current === clip) {
      const running = this.actionFor(clip);
      if (running) running.timeScale = scale;
      return;
    }
    const next = this.actionFor(clip) ?? this.actionFor('idle');
    if (!next) return;
    const prev = this.current === 'none' ? null : this.actionFor(this.current);
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    next.timeScale = scale;
    if (clip === 'getup') {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    prev?.fadeOut(fade);
    this.current = clip;
  }

  private actionFor(clip: LocoClip): THREE.AnimationAction | undefined {
    const aliases = clip === 'walk' ? this.walkNames : CLIP_ALIASES[clip];
    for (const alias of aliases) {
      const exact = this.actions.get(alias);
      if (exact) return exact;
      for (const [key, action] of this.actions) {
        if (key === alias || key.endsWith('|' + alias) || key.endsWith('/' + alias)) return action;
      }
    }
    for (const alias of aliases) {
      for (const [key, action] of this.actions) {
        if (key.includes(alias) && !key.includes('t-pose') && !key.includes('tpose')) return action;
      }
    }
    return undefined;
  }

  stop(): void {
    this.mixer?.stopAllAction();
    this.current = 'none';
  }

  update(dt: number, camDist = 0): void {
    if (!this.mixer) return;
    const step = camDist > 70 ? dt * 0.35 : camDist > 42 ? dt * 0.65 : dt;
    this.mixer.update(step);
  }

  setHighlight(_color: number, _intensity: number): void {
    /* Hover highlight removed — it lit accessory quads into a white square. */
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.mixer = null;
    for (const mat of this.materials) mat.dispose();
    this.materials.length = 0;
    this.root.removeFromParent();
  }
}

export function instantiateCharacter(kind: CharacterKind, look: NpcLook): SkinnedCharacter | null {
  if (!peekCharacter(kind)) return null;
  const inst = new SkinnedCharacter(kind, look);
  return inst.ready ? inst : null;
}

/**
 * Game forward is -Z (yaw 0). Rotate the un-animated facing parent so the
 * mesh's own forward lands on -Z. Never bake this into the mixer target —
 * clips overwrite TRS on animated nodes every frame.
 */
function detectModelYawOffset(rig: THREE.Object3D): number {
  const hips = findBone(rig, ['hips', 'pelvis']);
  const head = findBone(rig, ['head']);
  const armL = findBone(rig, ['upperarm.l', 'leftarm']);
  const armR = findBone(rig, ['upperarm.r', 'rightarm']);
  if (!hips || !head || !armL || !armR) return 0;
  hips.getWorldPosition(tmpA);
  head.getWorldPosition(tmpB);
  tmpUp.subVectors(tmpB, tmpA).normalize();
  armL.getWorldPosition(tmpA);
  armR.getWorldPosition(tmpB);
  tmpRight.subVectors(tmpB, tmpA).normalize();
  tmpFwd.crossVectors(tmpUp, tmpRight);
  tmpFwd.y = 0;
  if (tmpFwd.lengthSq() < 1e-6) return 0;
  tmpFwd.normalize();
  return Math.PI - Math.atan2(tmpFwd.x, tmpFwd.z);
}

function findBone(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (found) return;
    const key = normalizeBone(obj.name);
    if (names.some((n) => key === n || key === n.replace(/\./g, ''))) found = obj;
  });
  return found;
}

function hideGear(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (WEAPON_NAME.test(obj.name) && !/head|hood|hair|hat|helmet|cape|body/i.test(obj.name)) {
      obj.visible = false;
    }
  });
}

/** In-place clips should not drag the character through XZ — physics owns that. */
function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  const next = clip.clone();
  for (const track of next.tracks) {
    if (!/\.position$/.test(track.name)) continue;
    if (!/(^|\.)(root|hips|armature|characterarmature)$/i.test(track.name.replace(/\.position$/, ''))) continue;
    const values = track.values;
    if (values.length < 3) continue;
    const rootTrack = /root$/i.test(track.name.replace(/\.position$/i, ''));
    for (let i = 0; i < values.length; i += 3) {
      values[i] = 0;
      values[i + 2] = 0;
      if (rootTrack) values[i + 1] = 0;
    }
  }
  return next;
}

function normalizeBone(name: string): string {
  return name.replace(/mixamorig:?/gi, '').replace(/[|_]/g, '.').toLowerCase();
}

function fitHeight(root: THREE.Object3D, target: number): void {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (size.y < 0.1) return;
  root.scale.multiplyScalar(target / size.y);
  root.updateMatrixWorld(true);
  const next = new THREE.Box3().setFromObject(root);
  root.position.y -= next.min.y;
}

export function clothingTint(rng: () => number): number {
  const list = [0xffffff, 0xc9d6c2, 0xd4c4a8, 0x9bb7c9, 0xc9a4a4, 0xb7c99b, 0xd0c8e0];
  return list[Math.floor(rng() * list.length)]!;
}

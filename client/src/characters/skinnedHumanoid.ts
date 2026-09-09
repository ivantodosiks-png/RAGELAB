import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { assetManager } from '../assets/assetManager';
import type { NpcPartId } from '../sandbox/types';
import type { NpcLook } from '../sandbox/npcModel';

const BASE = import.meta.env.BASE_URL;

/**
 * Shared characters: Quaternius SWAT operator (players) + civilian humanoids (NPCs).
 * Facing is on an un-animated parent so bind pose cannot overwrite game yaw (−Z).
 */
export const CHARACTER_KINDS = ['operator', 'man', 'woman'] as const;
export type CharacterKind = (typeof CHARACTER_KINDS)[number];
export type LocoClip = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'getup';

/** Primary player mesh — Quaternius SWAT (CC0) with Idle/Walk/Run clips. */
export const PLAYER_CHARACTER_KIND: CharacterKind = 'operator';

const KIND_FILE: Record<CharacterKind, string> = {
  operator: 'operator.glb',
  man: 'man.glb',
  woman: 'woman.glb',
};

const CLIP_ALIASES: Record<LocoClip, string[]> = {
  idle: ['idle', 'idle_neutral', 'idle_gun', 'standing_idle', 'unarmed_idle'],
  walk: ['walk', 'walking_a', 'walking_b'],
  run: ['run', 'run_shoot', 'running_a'],
  jump: ['jump', 'jump_start', 'walk_jump', 'roll', 'idle'],
  fall: ['fall', 'falling_idle', 'jump_idle', 'idle'],
  getup: ['getup', 'lie_standup', 'standup'],
};

const BONE_ALIASES: Record<NpcPartId, string[]> = {
  pelvis: ['hips', 'pelvis', 'hip'],
  torso: ['chest', 'torso', 'abdomen', 'spine2', 'spine1', 'spine_02', 'spine_01', 'spine'],
  head: ['head'],
  upperArmL: ['upperarml', 'upperarm.l', 'leftarm', 'upperarm_l', 'upper_arm.l'],
  lowerArmL: ['lowerarml', 'lowerarm.l', 'leftforearm', 'lowerarm_l', 'forearm.l'],
  handL: ['wristl', 'hand.l', 'lefthand', 'hand_l', 'handl'],
  upperArmR: ['upperarmr', 'upperarm.r', 'rightarm', 'upperarm_r', 'upper_arm.r'],
  lowerArmR: ['lowerarmr', 'lowerarm.r', 'rightforearm', 'lowerarm_r', 'forearm.r'],
  handR: ['wristr', 'hand.r', 'righthand', 'hand_r', 'handr'],
  upperLegL: ['upperlegl', 'upperleg.l', 'leftupleg', 'thigh_l', 'upleg.l'],
  lowerLegL: ['lowerlegl', 'lowerleg.l', 'leftleg', 'calf_l', 'leg.l'],
  footL: ['footl', 'foot.l', 'leftfoot', 'foot_l'],
  upperLegR: ['upperlegr', 'upperleg.r', 'rightupleg', 'thigh_r', 'upleg.r'],
  lowerLegR: ['lowerlegr', 'lowerleg.r', 'rightleg', 'calf_r', 'leg.r'],
  footR: ['footr', 'foot.r', 'rightfoot', 'foot_r'],
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
  // Sandbox NPCs keep civilian variety; players always use PLAYER_CHARACTER_KIND.
  const npc = ['man', 'woman'] as const;
  return npc[Math.floor(rng() * npc.length)]!;
}

export function kindFromSeed(_seed: number): CharacterKind {
  return PLAYER_CHARACTER_KIND;
}

export async function preloadCharacter(kind: CharacterKind = PLAYER_CHARACTER_KIND): Promise<GLTF | null> {
  try {
    return await assetManager.loadGltf(characterUrl(kind));
  } catch {
    return null;
  }
}

export async function preloadAllCharacters(): Promise<void> {
  await Promise.all(CHARACTER_KINDS.map((kind) => preloadCharacter(kind)));
}

export async function preloadPlayerCharacter(): Promise<GLTF | null> {
  return preloadCharacter(PLAYER_CHARACTER_KIND);
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
  private meshRoot: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: LocoClip | 'none' = 'none';
  private headBone: THREE.Object3D | null = null;
  private readonly headMeshes: THREE.Object3D[] = [];
  private readonly walkNames: string[];
  private readonly animRate: number;
  private groundY = 0;
  private locoPhase = 0;

  constructor(kind: CharacterKind, look: NpcLook) {
    this.kind = kind;
    this.animRate = look.animRate ?? 1;
    this.walkNames = look.walkVariant === 1 ? ['walking_b', 'walk', 'walking_a'] : ['walk', 'walking_b'];
    this.root = new THREE.Group();
    this.root.name = `skinned:${kind}`;
    this.facing.name = 'facing';
    this.root.add(this.facing);

    const gltf = peekCharacter(kind);
    if (!gltf) return;

    const cloned = cloneSkinned(gltf.scene) as THREE.Group;
    hideGear(cloned);
    // Mixamo / FBX Z-up static meshes: upright first, then fit height.
    cloned.updateMatrixWorld(true);
    ensureUpright(cloned);
    fitHeight(cloned, 1.78 * (look.heightScale ?? 1));
    this.facing.add(cloned);
    this.meshRoot = cloned;

    cloned.updateMatrixWorld(true);
    this.facing.rotation.y = detectModelYawOffset(cloned);
    cloned.updateMatrixWorld(true);
    groundToOrigin(cloned);
    this.groundY = cloned.position.y;

    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        const src = mesh.material;
        const list = Array.isArray(src) ? src : [src];
        const clones = list.map((mat) => {
          const next = (mat as THREE.Material).clone();
          if (next instanceof THREE.MeshStandardMaterial) {
            if (isOutfitMesh(mesh.name) && look.gltfTint && look.gltfTint !== 0xffffff) {
              next.color.lerp(new THREE.Color(look.gltfTint), 0.18);
            }
            next.envMapIntensity = 1.05;
            next.emissive.setHex(0x000000);
            next.emissiveIntensity = 0;
            this.materials.push(next);
          }
          return next;
        });
        mesh.material = Array.isArray(src) ? clones : clones[0]!;
        if (isHeadMesh(mesh.name)) this.headMeshes.push(mesh);
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

    // Static meshes without a skeleton get a synthetic right-hand socket.
    if (!this.bones.handR) {
      const hand = new THREE.Object3D();
      hand.name = 'synth:handR';
      hand.position.set(0.22, 1.02, -0.12);
      cloned.add(hand);
      this.bones.handR = hand;
    }

    if (gltf.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(cloned);
      for (const clip of gltf.animations) {
        const cleaned = stripRootMotion(clip);
        const action = this.mixer.clipAction(cleaned);
        action.enabled = true;
        this.actions.set(clip.name.toLowerCase(), action);
      }
      this.play('idle', 0);
      this.mixer.update(1 / 60);
      groundToOrigin(cloned);
      this.groundY = cloned.position.y;
    } else {
      this.current = 'idle';
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

  play(clip: LocoClip, fade = 0.28, timeScale = 1): void {
    if (!this.mixer) {
      this.current = clip;
      return;
    }
    const scale = timeScale * this.animRate;
    if (this.current === clip) {
      const running = this.actionFor(clip);
      if (running) running.timeScale = scale;
      return;
    }
    const next = this.actionFor(clip) ?? this.actionFor('idle');
    if (!next) {
      this.current = clip;
      return;
    }
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
        // Prefer whole-token match so `run` does not steal `run_left` / `run_back`.
        const token = key.split(/[|:/]/).pop() ?? key;
        if (token === alias && !token.includes('t-pose') && !token.includes('tpose')) return action;
      }
    }
    return undefined;
  }

  stop(): void {
    this.mixer?.stopAllAction();
    this.current = 'none';
  }

  update(dt: number, camDist = 0): void {
    if (this.mixer) {
      const step = camDist > 70 ? dt * 0.35 : camDist > 42 ? dt * 0.65 : dt;
      this.mixer.update(step);
      // SWAT pack has no dedicated Jump/Fall — bias the grounded mesh for airborne read.
      if (this.meshRoot) {
        const air =
          this.current === 'jump' ? 0.05 : this.current === 'fall' ? 0.02 : 0;
        this.meshRoot.position.y = this.groundY + air;
      }
      return;
    }
    // Static mesh locomotion: light bob so walk/run still read at a glance.
    if (!this.meshRoot) return;
    const moving = this.current === 'walk' || this.current === 'run';
    const rate = (this.current === 'run' ? 11 : 7.2) * this.animRate;
    const amp = this.current === 'run' ? 0.035 : this.current === 'walk' ? 0.022 : 0;
    if (moving) this.locoPhase += dt * rate;
    const bob = moving ? Math.abs(Math.sin(this.locoPhase)) * amp : 0;
    const air = this.current === 'jump' ? 0.05 : this.current === 'fall' ? 0.02 : 0;
    this.meshRoot.position.y = this.groundY + bob + air;
    const lean = this.current === 'run' ? 0.06 : this.current === 'walk' ? 0.03 : 0;
    this.meshRoot.rotation.x = lean;
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
  const armL = findBone(rig, ['upperarml', 'upperarm.l', 'leftarm', 'leftuparm']);
  const armR = findBone(rig, ['upperarmr', 'upperarm.r', 'rightarm', 'rightuparm']);
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

/** Rotate the rig so the body points roughly +Y (Mixamo bind or FBX Z-up static). */
function ensureUpright(rig: THREE.Object3D): void {
  const hips = findBone(rig, ['hips', 'pelvis']);
  const head = findBone(rig, ['head']);
  if (hips && head) {
    hips.getWorldPosition(tmpA);
    head.getWorldPosition(tmpB);
    tmpUp.subVectors(tmpB, tmpA);
    if (tmpUp.lengthSq() > 1e-8) {
      tmpUp.normalize();
      if (tmpUp.y < 0.75) {
        tmpFwd.set(0, 1, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(tmpUp, tmpFwd);
        rig.quaternion.premultiply(q);
        rig.updateMatrixWorld(true);
      }
      return;
    }
  }

  // Static mesh fallback (madtrollstudio Soldier): longest axis becomes height.
  rig.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig);
  const size = box.getSize(tmpA);
  if (!Number.isFinite(size.x)) return;
  if (size.z >= size.y && size.z >= size.x * 0.9) {
    // Z-up → Y-up
    rig.rotateX(-Math.PI / 2);
    rig.updateMatrixWorld(true);
  } else if (size.x >= size.y && size.x >= size.z * 0.9) {
    rig.rotateZ(Math.PI / 2);
    rig.updateMatrixWorld(true);
  }
}

function groundToOrigin(rig: THREE.Object3D): void {
  rig.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig);
  if (!Number.isFinite(box.min.y)) return;
  // Slight sink so boot soles sit flush on the movement feet plane.
  rig.position.y -= box.min.y + 0.008;
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

const HEAD_MESH = /head|helmet|hood|hair|hat|beard|teeth|eyeleft|eyeright|headwear|glasses/i;
const OUTFIT_MESH = /outfit|footwear/i;

function isHeadMesh(name: string): boolean {
  return HEAD_MESH.test(name);
}

function isOutfitMesh(name: string): boolean {
  return OUTFIT_MESH.test(name);
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
    const node = track.name.replace(/\.position$/i, '');
    const joint = node.split(/[.:/]/).pop() ?? node;
    if (!/^(root|hips|armature|characterarmature)$/i.test(joint)) continue;
    const values = track.values;
    if (values.length < 3) continue;
    const rootTrack = /^root$/i.test(joint);
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
  const h = Math.max(size.y, 1e-4);
  if (h < 1e-4) return;
  root.scale.multiplyScalar(target / h);
  root.updateMatrixWorld(true);
  const next = new THREE.Box3().setFromObject(root);
  root.position.y -= next.min.y;
}

export function clothingTint(rng: () => number): number {
  const list = [0xffffff, 0xc9d6c2, 0xd4c4a8, 0x9bb7c9, 0xc9a4a4, 0xb7c99b, 0xd0c8e0];
  return list[Math.floor(rng() * list.length)]!;
}

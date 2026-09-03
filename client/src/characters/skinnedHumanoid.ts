import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { assetManager } from '../assets/assetManager';
import type { NpcPartId } from '../sandbox/types';
import type { NpcLook } from '../sandbox/npcModel';

const BASE = import.meta.env.BASE_URL;
export const SOLDIER_URL = `${BASE}models/characters/soldier.glb`;
export const HUMANOID_URL = `${BASE}models/npc/humanoid.glb`;

export type CharacterKind = 'soldier';
export type LocoClip = 'idle' | 'walk' | 'run' | 'jump' | 'fall';

const BONE_ALIASES: Record<NpcPartId, string[]> = {
  pelvis: ['hips', 'pelvis', 'hip'],
  torso: ['spine2', 'spine1', 'spine_02', 'spine_01', 'spine', 'chest'],
  head: ['head'],
  upperArmL: ['leftarm', 'upperarm_l', 'upper_arm.l'],
  lowerArmL: ['leftforearm', 'lowerarm_l', 'forearm.l'],
  handL: ['lefthand', 'hand_l', 'hand.l'],
  upperArmR: ['rightarm', 'upperarm_r', 'upper_arm.r'],
  lowerArmR: ['rightforearm', 'lowerarm_r', 'forearm.r'],
  handR: ['righthand', 'hand_r', 'hand.r'],
  upperLegL: ['leftupleg', 'thigh_l', 'upleg.l', 'upperleg.l'],
  lowerLegL: ['leftleg', 'calf_l', 'leg.l', 'lowerleg.l'],
  footL: ['leftfoot', 'foot_l', 'foot.l'],
  upperLegR: ['rightupleg', 'thigh_r', 'upleg.r', 'upperleg.r'],
  lowerLegR: ['rightleg', 'calf_r', 'leg.r', 'lowerleg.r'],
  footR: ['rightfoot', 'foot_r', 'foot.r'],
};

const CLOTHING = [0xffffff, 0xc9d6c2, 0xd4c4a8, 0x9bb7c9, 0xc9a4a4, 0xb7c99b, 0xd0c8e0];

export function characterUrl(_kind: CharacterKind): string {
  return SOLDIER_URL;
}

export function randomCharacterKind(_rng: () => number): CharacterKind {
  return 'soldier';
}

export async function preloadCharacter(kind: CharacterKind = 'soldier'): Promise<GLTF | null> {
  try {
    return await assetManager.loadGltf(characterUrl(kind));
  } catch {
    return null;
  }
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
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: LocoClip | 'none' = 'none';
  private readonly airBones: THREE.Object3D[] = [];
  private visor: THREE.Object3D | null = null;
  private headBone: THREE.Object3D | null = null;

  constructor(kind: CharacterKind, look: NpcLook) {
    this.kind = kind;
    this.root = new THREE.Group();
    this.root.name = `skinned:${kind}`;
    const gltf = peekCharacter(kind);
    if (!gltf) return;

    const cloned = cloneSkinned(gltf.scene) as THREE.Group;
    // Mixamo bind faces +Z; the game treats -Z as forward (same as the camera).
    cloned.rotation.y = Math.PI;
    fitHeight(cloned, 1.78 * (look.heightScale ?? 1));
    this.root.add(cloned);

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
            const visor = /visor/i.test(next.name) || /visor/i.test(mesh.name);
            if (!visor) {
              next.color.lerp(new THREE.Color(look.gltfTint), 0.55);
              next.color.lerp(new THREE.Color(look.shirt), 0.22);
              next.roughness = Math.min(0.95, next.roughness + 0.04);
            }
            next.envMapIntensity = 1.05;
            next.emissive.setHex(0x000000);
            next.emissiveIntensity = 0;
            this.materials.push(next);
          }
          return next;
        });
        mesh.material = Array.isArray(src) ? clones : clones[0]!;
        if (/visor/i.test(mesh.name)) this.visor = mesh;
      }
      const key = normalizeBone(obj.name);
      if (/head$/i.test(key) && !/top/.test(key)) this.headBone = obj;
      for (const [part, aliases] of Object.entries(BONE_ALIASES) as Array<[NpcPartId, string[]]>) {
        if (this.bones[part]) continue;
        if (aliases.some((alias) => key === alias || key.endsWith(alias))) this.bones[part] = obj;
      }
      if (key === 'leftupleg' || key === 'rightupleg') this.airBones.push(obj);
    });

    if (this.visor) this.visor.visible = look.hairStyle !== 2;
    this.attachExtras(look);

    if (gltf.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(cloned);
      for (const clip of gltf.animations) {
        const action = this.mixer.clipAction(clip);
        action.enabled = true;
        this.actions.set(clip.name.toLowerCase(), action);
      }
      this.play('idle', 0);
    }
  }

  get ready(): boolean {
    return this.root.children.length > 0;
  }

  get hasMixer(): boolean {
    return this.mixer !== null && this.actions.size > 0;
  }

  setHeadVisible(visible: boolean): void {
    if (this.headBone) this.headBone.scale.setScalar(visible ? 1 : 0.001);
    if (this.visor) this.visor.visible = visible;
    for (const extra of this.extras) extra.visible = visible;
  }

  /** Hide head and arms so an FPS camera can sit inside the chest. */
  setFirstPersonBody(on: boolean): void {
    this.setHeadVisible(!on);
    const limbs: NpcPartId[] = ['upperArmL', 'lowerArmL', 'handL', 'upperArmR', 'lowerArmR', 'handR'];
    for (const id of limbs) {
      const bone = this.bones[id];
      if (bone) bone.scale.setScalar(on ? 0.001 : 1);
    }
  }

  play(clip: LocoClip, fade = 0.18, timeScale = 1): void {
    if (!this.mixer) return;
    const mapped = clip === 'jump' || clip === 'fall' ? 'idle' : clip;
    if (this.current === clip) {
      const running = this.actionFor(mapped);
      if (running) running.timeScale = clip === 'jump' || clip === 'fall' ? 0.35 : timeScale;
      return;
    }
    const next = this.actionFor(mapped) ?? this.actionFor('idle');
    if (!next) return;
    const prevKey = this.current === 'none' ? null : this.current === 'jump' || this.current === 'fall' ? 'idle' : this.current;
    const prev = prevKey ? this.actionFor(prevKey) : null;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    next.timeScale = mapped === 'idle' && (clip === 'jump' || clip === 'fall') ? 0.35 : timeScale;
    prev?.fadeOut(fade);
    this.current = clip;
  }

  private actionFor(name: string): THREE.AnimationAction | undefined {
    const exact = this.actions.get(name);
    if (exact) return exact;
    for (const [key, action] of this.actions) {
      if (key.includes(name) && !key.includes('tpose')) return action;
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
    if (this.current === 'jump' || this.current === 'fall') {
      const kick = this.current === 'jump' ? -0.55 : 0.35;
      for (const bone of this.airBones) bone.rotation.x += kick * 0.015;
    }
  }

  setHighlight(color: number, intensity: number): void {
    for (const mat of this.materials) {
      mat.emissive.setHex(color);
      mat.emissiveIntensity = intensity;
    }
  }

  private attachExtras(look: NpcLook): void {
    const head = this.bones.head ?? this.headBone;
    if (!head) return;
    if (look.hairStyle === 1 || look.hairStyle === 3) {
      const hair = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
        new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.86, metalness: 0.02 }),
      );
      hair.name = 'hairOverlay';
      hair.position.set(0, 0.08, 0.02);
      hair.castShadow = true;
      head.add(hair);
      this.extras.push(hair);
      this.materials.push(hair.material as THREE.MeshStandardMaterial);
    }
    if (look.hairStyle === 3) {
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.11, 0.05, 12),
        new THREE.MeshStandardMaterial({ color: look.shirt, roughness: 0.7, metalness: 0.05 }),
      );
      cap.name = 'capOverlay';
      cap.position.set(0, 0.12, 0);
      cap.castShadow = true;
      head.add(cap);
      this.extras.push(cap);
      this.materials.push(cap.material as THREE.MeshStandardMaterial);
    }
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.mixer = null;
    for (const extra of this.extras) {
      extra.removeFromParent();
      const mesh = extra as THREE.Mesh;
      mesh.geometry?.dispose();
    }
    this.extras.length = 0;
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

function normalizeBone(name: string): string {
  return name.replace(/mixamorig:?/gi, '').replace(/[|_.]/g, '').toLowerCase();
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
  return CLOTHING[Math.floor(rng() * CLOTHING.length)]!;
}

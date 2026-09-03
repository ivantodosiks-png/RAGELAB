import * as THREE from 'three';
import { AnimationState, type AnimationStateId, type PlayerIdentity } from '@ragelab/shared';
import {
  instantiateCharacter,
  preloadCharacter,
  type LocoClip,
  type SkinnedCharacter,
} from '../characters/skinnedHumanoid';
import type { NpcLook } from '../sandbox/npcModel';

const TEAM_COLORS = [0xf05b4a, 0x4a9df0, 0x67e08a, 0xf0c14a];

/**
 * First-person body for the local player. Head and arms are hidden so they
 * do not fight the camera or view-model; legs, torso, clothes and boots stay
 * visible when looking down.
 */
export class LocalCharacter {
  readonly root = new THREE.Group();
  private character: SkinnedCharacter | null = null;
  private look: NpcLook;

  constructor(identity: PlayerIdentity | undefined) {
    this.root.name = 'localCharacter';
    this.look = lookFromIdentity(identity);
    void preloadCharacter('soldier').then(() => this.attach());
  }

  setIdentity(identity: PlayerIdentity): void {
    this.look = lookFromIdentity(identity);
    this.character?.dispose();
    this.character = null;
    this.attach();
  }

  update(
    dt: number,
    feet: { x: number; y: number; z: number },
    yaw: number,
    clip: LocoClip,
    alive: boolean,
  ): void {
    this.root.visible = alive;
    if (!alive) return;
    this.root.position.set(feet.x, feet.y, feet.z);
    this.root.rotation.y = yaw;
    this.character?.play(clip);
    this.character?.update(dt, 0);
  }

  dispose(): void {
    this.character?.dispose();
    this.character = null;
    this.root.removeFromParent();
  }

  private attach(): void {
    if (this.character) return;
    const inst = instantiateCharacter('soldier', this.look);
    if (!inst) return;
    inst.setFirstPersonBody(true);
    this.character = inst;
    this.root.add(inst.root);
  }
}

export function clipFromAnimation(state: AnimationStateId, speed: number): LocoClip {
  if (state === AnimationState.Jump) return 'jump';
  if (state === AnimationState.Fall) return 'fall';
  if (state === AnimationState.Run || speed > 5.4) return 'run';
  if (state === AnimationState.Walk || state === AnimationState.CrouchWalk || speed > 0.35) return 'walk';
  return 'idle';
}

export function lookFromIdentity(identity: PlayerIdentity | undefined): NpcLook {
  const shirt = TEAM_COLORS[(identity?.team ?? 0) % TEAM_COLORS.length]!;
  return {
    skin: 0xe0ac69,
    hair: 0x1a120b,
    shirt,
    pants: 0x22223b,
    shoes: 0x1a1a1a,
    hairStyle: 0,
    gltfTint: shirt,
  };
}

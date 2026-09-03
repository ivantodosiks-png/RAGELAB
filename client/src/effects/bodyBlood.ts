import * as THREE from 'three';
import { bloodDecalTexture } from '../renderer/textures';

interface Slot {
  sprite: THREE.Sprite;
  expiresAt: number;
  fadeStart: number;
  baseScale: number;
}

const LIFE_MS = 9_000;
const FADE_MS = 2_200;

/**
 * Blood that lives on a character bone. Recycled sprites are unparented so they
 * never stay behind in world space when the NPC walks away.
 */
export class BodyBloodPool {
  private readonly slots: Slot[] = [];
  private cursor = 0;
  private readonly material: THREE.SpriteMaterial;

  constructor(capacity: number) {
    this.material = new THREE.SpriteMaterial({
      map: bloodDecalTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      sizeAttenuation: true,
    });
    for (let i = 0; i < capacity; i++) {
      const sprite = new THREE.Sprite(this.material);
      sprite.visible = false;
      sprite.renderOrder = 5;
      this.slots.push({ sprite, expiresAt: 0, fadeStart: 0, baseScale: 1 });
    }
  }

  spawn(parent: THREE.Object3D, worldPoint: THREE.Vector3, size: number, nowMs: number): void {
    const slot = this.slots[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.slots.length;
    const sprite = slot.sprite;
    sprite.removeFromParent();
    parent.updateWorldMatrix(true, false);
    const local = parent.worldToLocal(worldPoint.clone());
    sprite.position.copy(local);
    sprite.scale.setScalar(size);
    sprite.visible = true;
    parent.add(sprite);
    slot.baseScale = size;
    slot.expiresAt = nowMs + LIFE_MS;
    slot.fadeStart = slot.expiresAt - FADE_MS;
  }

  update(nowMs: number): void {
    for (const slot of this.slots) {
      if (!slot.sprite.visible) continue;
      if (nowMs >= slot.expiresAt) {
        slot.sprite.visible = false;
        slot.sprite.removeFromParent();
        continue;
      }
      if (nowMs > slot.fadeStart) {
        const t = 1 - (nowMs - slot.fadeStart) / FADE_MS;
        slot.sprite.scale.setScalar(slot.baseScale * Math.max(0.05, t));
      }
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.sprite.visible = false;
      slot.sprite.removeFromParent();
      slot.expiresAt = 0;
    }
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}

import * as THREE from 'three';
import { bloodDecalTexture, bulletHoleTexture } from '../renderer/textures';

export type DecalKind = 'bullet' | 'blood' | 'scorch';

interface DecalSlot {
  mesh: THREE.Mesh;
  expiresAt: number;
  fadeStart: number;
  baseScale: number;
}

const LIFETIME_MS = 26_000;
const FADE_MS = 4_000;

/**
 * Ring buffer of decal quads.
 *
 * Fixed capacity per kind: once full, the oldest decal is recycled, so bullet
 * holes never accumulate into a memory leak during a long match. Each kind is
 * one material, so the whole system is three draw calls.
 */
export class DecalPool {
  readonly root = new THREE.Group();

  private readonly slots = new Map<DecalKind, DecalSlot[]>();
  private readonly cursors = new Map<DecalKind, number>();
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly materials = new Map<DecalKind, THREE.MeshBasicMaterial>();
  private readonly normalTarget = new THREE.Vector3();

  constructor(capacity: number) {
    this.root.name = 'decals';

    const configs: Array<{ kind: DecalKind; texture: THREE.Texture; color: number; opacity: number }> = [
      { kind: 'bullet', texture: bulletHoleTexture(), color: 0xffffff, opacity: 0.95 },
      { kind: 'blood', texture: bloodDecalTexture(), color: 0xffffff, opacity: 0.85 },
      { kind: 'scorch', texture: bulletHoleTexture(), color: 0x181410, opacity: 0.8 },
    ];

    for (const cfg of configs) {
      const material = new THREE.MeshBasicMaterial({
        map: cfg.texture,
        color: cfg.color,
        transparent: true,
        opacity: cfg.opacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      this.materials.set(cfg.kind, material);

      const perKind = cfg.kind === 'bullet' ? capacity : Math.max(8, Math.floor(capacity / 3));
      const list: DecalSlot[] = [];
      for (let i = 0; i < perKind; i++) {
        const mesh = new THREE.Mesh(this.geometry, material);
        mesh.visible = false;
        mesh.frustumCulled = true;
        mesh.renderOrder = 4;
        this.root.add(mesh);
        list.push({ mesh, expiresAt: 0, fadeStart: 0, baseScale: 1 });
      }
      this.slots.set(cfg.kind, list);
      this.cursors.set(cfg.kind, 0);
    }
  }

  spawn(
    kind: DecalKind,
    position: THREE.Vector3 | { x: number; y: number; z: number },
    normal: { x: number; y: number; z: number },
    size: number,
    nowMs: number,
  ): void {
    const list = this.slots.get(kind);
    if (!list || list.length === 0) return;
    const cursor = this.cursors.get(kind)!;
    const slot = list[cursor]!;
    this.cursors.set(kind, (cursor + 1) % list.length);

    const mesh = slot.mesh;
    // Lift slightly off the surface; polygon offset alone still z-fights on
    // large coplanar brushes.
    mesh.position.set(
      position.x + normal.x * 0.012,
      position.y + normal.y * 0.012,
      position.z + normal.z * 0.012,
    );
    this.normalTarget.set(
      mesh.position.x + normal.x,
      mesh.position.y + normal.y,
      mesh.position.z + normal.z,
    );
    mesh.lookAt(this.normalTarget);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    mesh.scale.setScalar(size);
    mesh.visible = true;

    slot.baseScale = size;
    slot.expiresAt = nowMs + LIFETIME_MS;
    slot.fadeStart = slot.expiresAt - FADE_MS;
  }

  update(nowMs: number): void {
    for (const list of this.slots.values()) {
      for (const slot of list) {
        if (!slot.mesh.visible) continue;
        if (nowMs >= slot.expiresAt) {
          slot.mesh.visible = false;
          continue;
        }
        // Materials are shared, so fading is done by shrinking rather than by
        // touching per-mesh opacity (which would need a material clone).
        if (nowMs > slot.fadeStart) {
          const t = 1 - (nowMs - slot.fadeStart) / FADE_MS;
          slot.mesh.scale.setScalar(slot.baseScale * t);
        }
      }
    }
  }

  clear(): void {
    for (const list of this.slots.values()) {
      for (const slot of list) {
        slot.mesh.visible = false;
        slot.expiresAt = 0;
      }
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.slots.clear();
    this.root.clear();
  }
}

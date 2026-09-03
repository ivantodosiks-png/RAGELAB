import * as THREE from 'three';
import { getArchetype, type PropKind } from '@ragelab/shared';
import type { SpawnEntry } from './spawnCatalog';
import { isPropCategory, propKindFromEntry } from './spawnCatalog';
import { createPropVisual } from './propVisuals';

const ghostMat = new THREE.MeshBasicMaterial({
  color: 0xd6ff3d,
  transparent: true,
  opacity: 0.38,
  depthWrite: false,
});

const blockedMat = new THREE.MeshBasicMaterial({
  color: 0xff4d3a,
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
});

const npcGeo = new THREE.CapsuleGeometry(0.22, 1.15, 4, 8);
const weaponGeo = new THREE.BoxGeometry(0.08, 0.16, 0.42);

function paintGhost(root: THREE.Object3D, material: THREE.Material): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.material = material;
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
    if (obj instanceof THREE.Light) obj.visible = false;
  });
}

/**
 * One reused ghost. Never participates in physics. Hidden when the spawn
 * menu is open or the selection is a world tool.
 */
export class SpawnPreview {
  readonly root = new THREE.Group();
  private holder = new THREE.Group();
  private currentId = '';

  constructor() {
    this.root.name = 'spawnPreview';
    this.root.visible = false;
    this.holder.name = 'spawnPreviewHolder';
    this.root.add(this.holder);
  }

  setEntry(entry: SpawnEntry | null): void {
    if (!entry || this.currentId === entry.id) return;
    this.currentId = entry.id;
    this.holder.clear();
    const blocked = entry.category === 'weapons';
    const material = blocked ? blockedMat : ghostMat;

    if (entry.category === 'npc') {
      const mesh = new THREE.Mesh(npcGeo, material);
      mesh.position.set(0, 0.8, 0);
      this.holder.add(mesh);
      return;
    }
    if (isPropCategory(entry.category)) {
      const kind = propKindFromEntry(entry.id);
      if (!kind) return;
      const visual = createPropVisual(kind);
      paintGhost(visual, material);
      visual.position.set(0, halfY(kind), 0);
      this.holder.add(visual);
      return;
    }
    if (entry.category === 'weapons') {
      const mesh = new THREE.Mesh(weaponGeo, material);
      mesh.position.set(0, 0.12, 0);
      this.holder.add(mesh);
    }
  }

  update(
    point: { x: number; y: number; z: number } | null,
    yaw: number,
    visible: boolean,
  ): void {
    if (!visible || !point) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    this.root.position.set(point.x, point.y, point.z);
    this.root.rotation.set(0, yaw, 0);
  }

  dispose(): void {
    this.holder.clear();
    this.root.removeFromParent();
  }
}

function halfY(kind: PropKind): number {
  const shape = getArchetype(kind).shape;
  if (shape.type === 'box') return shape.halfExtents[1];
  if (shape.type === 'cylinder') return shape.halfHeight;
  if (shape.type === 'sphere') return shape.radius;
  return 0.4;
}

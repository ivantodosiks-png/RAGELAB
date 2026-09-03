import * as THREE from 'three';
import { getArchetype, type PropKind } from '@ragelab/shared';
import { propGeometry } from '../maps/mapMeshBuilder';
import type { SpawnEntry } from './spawnCatalog';
import { propKindFromEntry } from './spawnCatalog';

const ghostMat = new THREE.MeshBasicMaterial({
  color: 0xd6ff3d,
  transparent: true,
  opacity: 0.32,
  depthWrite: false,
  wireframe: false,
});

const blockedMat = new THREE.MeshBasicMaterial({
  color: 0xff4d3a,
  transparent: true,
  opacity: 0.28,
  depthWrite: false,
});

const geoCache = new Map<string, THREE.BufferGeometry>();

function npcGhostGeo(): THREE.BufferGeometry {
  let geo = geoCache.get('npc');
  if (!geo) {
    geo = new THREE.CapsuleGeometry(0.22, 1.15, 4, 8);
    geoCache.set('npc', geo);
  }
  return geo;
}

function propGhostGeo(kind: PropKind): THREE.BufferGeometry {
  const key = `prop:${kind}`;
  let geo = geoCache.get(key);
  if (!geo) {
    geo = propGeometry(kind);
    geoCache.set(key, geo);
  }
  return geo;
}

function weaponGhostGeo(): THREE.BufferGeometry {
  let geo = geoCache.get('weapon');
  if (!geo) {
    geo = new THREE.BoxGeometry(0.08, 0.16, 0.42);
    geoCache.set('weapon', geo);
  }
  return geo;
}

/**
 * One reused ghost mesh. Never participates in physics. Hidden when the spawn
 * menu is open or the selection is a world tool.
 */
export class SpawnPreview {
  readonly root = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private currentId = '';

  constructor() {
    this.root.name = 'spawnPreview';
    this.root.visible = false;
    this.root.matrixAutoUpdate = true;
    this.mesh = new THREE.Mesh(npcGhostGeo(), ghostMat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.root.add(this.mesh);
  }

  setEntry(entry: SpawnEntry | null): void {
    if (!entry || this.currentId === entry.id) return;
    this.currentId = entry.id;
    const blocked = entry.category === 'weapons';
    this.mesh.material = blocked ? blockedMat : ghostMat;
    if (entry.category === 'npc') {
      this.mesh.geometry = npcGhostGeo();
      this.mesh.position.set(0, 0.8, 0);
    } else if (entry.category === 'props') {
      const kind = propKindFromEntry(entry.id);
      this.mesh.geometry = kind ? propGhostGeo(kind) : npcGhostGeo();
      const hy = kind ? halfY(kind) : 0.8;
      this.mesh.position.set(0, hy, 0);
    } else if (entry.category === 'weapons') {
      this.mesh.geometry = weaponGhostGeo();
      this.mesh.position.set(0, 0.12, 0);
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

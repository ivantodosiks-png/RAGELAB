import * as THREE from 'three';
import type { MapDefinition } from '@ragelab/shared';
import { assetManager } from '../assets/assetManager';
import { cityModelScale, cityModelUrl } from './mapCatalog';
import { mapSpawns } from './spawnLayout';

const tmpMat = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpEuler = new THREE.Euler();

/** Small props cast no shadows — keeps the sun map cheap on dense city dressing. */
const NO_SHADOW_CAST = new Set([
  'cone',
  'barrier',
  'planter',
  'path-stones',
  'path-long',
  'parasol',
  'sign',
  'fence',
  'fence-low',
]);

/**
 * Client-only Kenney scenery. Physics stays on cheap brush colliders so the
 * server and the prediction world never load GLBs.
 */
export class MapDecor {
  readonly root = new THREE.Group();
  private loaded = false;

  constructor(private readonly map: MapDefinition) {
    this.root.name = `decor:${map.id}`;
    this.mountSpawnAnchors();
  }

  /** Empty named nodes so vehicles / NPCs can be parented later without relayout. */
  private mountSpawnAnchors(): void {
    const roles = ['player', 'npc', 'vehicle', 'prop'] as const;
    for (const role of roles) {
      const group = new THREE.Group();
      group.name = `${role}Spawns`;
      for (const spawn of mapSpawns(this.map, role)) {
        const node = new THREE.Object3D();
        node.name = spawn.id ?? `${role}-${group.children.length}`;
        node.position.set(...spawn.position);
        node.rotation.y = spawn.yaw;
        group.add(node);
      }
      this.root.add(group);
    }
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const items = this.map.decor ?? [];
    if (items.length === 0) return;

    const byModel = new Map<string, typeof items>();
    for (const item of items) {
      const list = byModel.get(item.model) ?? [];
      list.push(item);
      byModel.set(item.model, list);
    }

    const keys = [...byModel.keys()];
    const concurrency = 4;
    for (let i = 0; i < keys.length; i += concurrency) {
      await Promise.all(keys.slice(i, i + concurrency).map((id) => this.spawnGroup(id, byModel.get(id)!)));
    }
  }

  private async spawnGroup(id: string, items: NonNullable<MapDefinition['decor']>): Promise<void> {
    const url = cityModelUrl(id);
    try {
      await assetManager.loadGltf(url);
    } catch (err) {
      console.error(`[MapDecor] failed to load ${url}`, err);
      return;
    }
    const gltf = assetManager.peek(url);
    if (!gltf) return;
    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const cast = !NO_SHADOW_CAST.has(id);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
        if (!mat.map) {
          console.error(`[MapDecor] missing texture on ${url} (${mesh.name || mesh.uuid})`);
          // Avoid blown-out white placeholders when a colormap failed to embed.
          mat.color.setHex(0x8a9098);
          mat.roughness = 0.85;
        }
        // Kenney colormaps are already fully lit albedo. Strong env/metal
        // reads as blown-out white once the texture is actually loaded.
        mat.envMapIntensity = 0.18;
        mat.metalness = 0;
        mat.roughness = Math.max(0.58, mat.roughness);
        if (mat.map) {
          mat.map.colorSpace = THREE.SRGBColorSpace;
          mat.map.anisotropy = 8;
        }
      }
    });

    const meshes: THREE.Mesh[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) meshes.push(mesh);
    });

    if (meshes.length === 1 && items.length > 1) {
      this.instanceMesh(meshes[0]!, items, id);
      return;
    }

    for (const item of items) {
      const clone = assetManager.cloneSceneShared(url);
      if (!clone) continue;
      this.place(clone, item, id);
      clone.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = !NO_SHADOW_CAST.has(id);
        mesh.receiveShadow = true;
        mesh.frustumCulled = true;
      });
      this.root.add(clone);
    }
  }

  private instanceMesh(src: THREE.Mesh, items: NonNullable<MapDefinition['decor']>, id: string): void {
    src.updateWorldMatrix(true, false);
    const geometry = src.geometry;
    const material = src.material;
    const inst = new THREE.InstancedMesh(geometry, material, items.length);
    inst.name = `decor:${id}`;
    inst.castShadow = !NO_SHADOW_CAST.has(id);
    inst.receiveShadow = true;
    inst.frustumCulled = true;
    src.matrixWorld.decompose(tmpPos, tmpQuat, tmpScale);
    const local = new THREE.Matrix4().compose(tmpPos, tmpQuat, tmpScale);
    for (let i = 0; i < items.length; i++) {
      this.itemMatrix(items[i]!, id);
      tmpMat.multiply(local);
      inst.setMatrixAt(i, tmpMat);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.computeBoundingBox();
    this.root.add(inst);
  }

  private place(obj: THREE.Object3D, item: NonNullable<MapDefinition['decor']>[number], id: string): void {
    const scale = item.scale ?? cityModelScale(id);
    obj.position.set(...item.position);
    obj.rotation.set(0, item.yaw ?? 0, 0);
    obj.scale.setScalar(scale);
  }

  private itemMatrix(item: NonNullable<MapDefinition['decor']>[number], id: string): void {
    const scale = item.scale ?? cityModelScale(id);
    tmpPos.set(...item.position);
    tmpEuler.set(0, item.yaw ?? 0, 0, 'YXZ');
    tmpQuat.setFromEuler(tmpEuler);
    tmpScale.set(scale, scale, scale);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
  }

  dispose(): void {
    this.root.traverse((obj) => {
      const inst = obj as THREE.InstancedMesh;
      if (inst.isInstancedMesh) inst.dispose();
    });
    this.root.removeFromParent();
  }
}

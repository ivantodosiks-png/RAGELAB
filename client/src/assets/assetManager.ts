import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Lazy GLB/glTF cache. Each URL is fetched once; callers clone the result.
 * Failed loads are remembered so spawn paths do not hammer a missing file.
 */
export class AssetManager {
  private readonly loader = new GLTFLoader();
  private readonly inflight = new Map<string, Promise<GLTF>>();
  private readonly ready = new Map<string, GLTF>();
  private readonly failed = new Map<string, string>();
  private onError: ((url: string, message: string) => void) | null = null;

  setErrorHandler(handler: ((url: string, message: string) => void) | null): void {
    this.onError = handler;
  }

  peek(url: string): GLTF | null {
    return this.ready.get(url) ?? null;
  }

  has(url: string): boolean {
    return this.ready.has(url);
  }

  /** Clone sharing geometry and materials — used for map instancing. */
  cloneSceneShared(url: string): THREE.Group | null {
    const gltf = this.ready.get(url);
    if (!gltf) return null;
    return gltf.scene.clone(true);
  }

  /** Deep-clone a cached scene, rebinding skeletons so skinned meshes keep their bones. */
  cloneScene(url: string): THREE.Group | null {
    const gltf = this.ready.get(url);
    if (!gltf) return null;
    const clone = cloneSkinned(gltf.scene) as THREE.Group;
    clone.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material;
      const list = Array.isArray(src) ? src : [src];
      const copies = list.map((mat) => (mat as THREE.Material).clone());
      mesh.material = Array.isArray(src) ? copies : copies[0]!;
    });
    return clone;
  }

  async cloneSceneWhenReady(url: string): Promise<THREE.Group | null> {
    try {
      await this.loadGltf(url);
    } catch {
      return null;
    }
    return this.cloneScene(url);
  }

  errorFor(url: string): string | null {
    return this.failed.get(url) ?? null;
  }

  loadGltf(url: string): Promise<GLTF> {
    const hit = this.ready.get(url);
    if (hit) return Promise.resolve(hit);
    const pending = this.inflight.get(url);
    if (pending) return pending;

    const task = this.loader.loadAsync(url).then(
      (gltf) => {
        this.ready.set(url, gltf);
        this.inflight.delete(url);
        return gltf;
      },
      (err: unknown) => {
        this.inflight.delete(url);
        const message = err instanceof Error ? err.message : String(err);
        this.failed.set(url, message);
        this.onError?.(url, message);
        throw err;
      },
    );
    this.inflight.set(url, task);
    return task;
  }

  dispose(): void {
    this.inflight.clear();
    this.failed.clear();
    for (const gltf of this.ready.values()) {
      gltf.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) mat?.dispose();
        }
      });
    }
    this.ready.clear();
  }
}

export const assetManager = new AssetManager();

import { assetManager } from '../assets/assetManager';

/** Source GLBs live in the repo `assets/` folder — Vite emits one hashed URL each. */
export const GLOCK_17_URL = new URL(
  '../../../assets/glock-17/Rigged Glock by J-Toastie - FpMvDqjZFr.glb',
  import.meta.url,
).href;

export const FPS_ARMS_URL = new URL(
  '../../../assets/Rigged Fps Arms/Rigged Fps Arms by J-Toastie - XdHWM8uSAO.glb',
  import.meta.url,
).href;

let preload: Promise<void> | null = null;

/** Warm the shared GLB cache once. Clones afterwards are free. */
export function preloadFpsView(): Promise<void> {
  if (!preload) {
    preload = Promise.all([assetManager.loadGltf(GLOCK_17_URL), assetManager.loadGltf(FPS_ARMS_URL)]).then(
      () => undefined,
      () => undefined,
    );
  }
  return preload;
}

export function cloneFpsAsset(url: string) {
  return assetManager.cloneScene(url);
}

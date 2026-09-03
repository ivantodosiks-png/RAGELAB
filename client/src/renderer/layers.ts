import type { Object3D } from 'three';

/** Default world geometry, NPCs, remotes, weapons in the main scene. */
export const LAYER_WORLD = 0;
/**
 * Local player's full third-person body. The first-person camera does not
 * enable this layer, so the mesh cannot clip the near plane or fill the view.
 * A future third-person / reflection camera can enable it without duplicating
 * the skeleton.
 */
export const LAYER_LOCAL_BODY = 1;

export function setLayerRecursive(obj: Object3D, layer: number): void {
  obj.layers.set(layer);
  obj.traverse((child) => child.layers.set(layer));
}

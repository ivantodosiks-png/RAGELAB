import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { assetManager } from '../assets/assetManager';

const BASE = import.meta.env.BASE_URL;
export const VIEW_ARMS_URL = `${BASE}models/viewmodel/arms_pistol.glb`;

/** Preload first-person grip arms (WRAD Arms, CC0 — posed for pistol). */
export function preloadViewArms(): Promise<void> {
  return assetManager.loadGltf(VIEW_ARMS_URL).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Two-handed wrap around a fitted pistol view-model.
 * Parent is the weapon mesh root so hands track recoil / ADS.
 */
export function createPistolGripArms(weaponRoot: THREE.Object3D): THREE.Object3D | null {
  const gltf = assetManager.peek(VIEW_ARMS_URL);
  if (!gltf) return null;

  const root = new THREE.Group();
  root.name = 'viewArms';

  const clone = (gltf.animations.length > 0 ? cloneSkinned(gltf.scene) : gltf.scene.clone(true)) as THREE.Group;
  clone.traverse((obj) => {
    // Helper/target empties from the IK rig — keep the mesh only.
    if (/head|arm_target|wrist_ik/i.test(obj.name) && !(obj as THREE.Mesh).isMesh) {
      obj.visible = false;
    }
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const src = mesh.material;
    const list = Array.isArray(src) ? src : [src];
    const copies = list.map((mat) => {
      const next = (mat as THREE.Material).clone();
      if (next instanceof THREE.MeshStandardMaterial) {
        next.envMapIntensity = 0.18;
        next.roughness = Math.max(next.roughness, 0.7);
        next.metalness = Math.min(next.metalness, 0.12);
        if (next.map) next.map.colorSpace = THREE.SRGBColorSpace;
        // Slightly darker so hands match the black Glock lighting.
        next.color.multiplyScalar(0.82);
      }
      return next;
    });
    mesh.material = Array.isArray(src) ? copies : copies[0]!;
  });

  // Fit arms into the view-model scale around the grip.
  weaponRoot.updateMatrixWorld(true);
  const gun = new THREE.Box3().setFromObject(weaponRoot);
  const gunSize = gun.getSize(new THREE.Vector3());
  const gunCenter = gun.getCenter(new THREE.Vector3());

  clone.updateMatrixWorld(true);
  const armBox = new THREE.Box3().setFromObject(clone);
  const armSize = armBox.getSize(new THREE.Vector3());
  const targetSpan = Math.max(gunSize.y * 2.4, 0.28);
  const scale = targetSpan / Math.max(armSize.y, 1e-4);
  clone.scale.setScalar(scale);
  clone.updateMatrixWorld(true);

  const fitted = new THREE.Box3().setFromObject(clone);
  const fittedCenter = fitted.getCenter(new THREE.Vector3());
  // Place fists on the grip: below/behind the frame so palms wrap the handle.
  clone.position.set(
    gunCenter.x - fittedCenter.x,
    gun.min.y - fitted.min.y - gunSize.y * 0.05,
    gun.max.z - fittedCenter.z + gunSize.z * 0.05,
  );
  clone.rotation.set(-0.12, 0.06, 0.02);

  root.add(clone);
  return root;
}

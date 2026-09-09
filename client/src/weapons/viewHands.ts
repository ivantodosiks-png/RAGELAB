import * as THREE from 'three';

/**
 * Always-visible two-hand tactical gloves wrapping a pistol grip.
 * Procedural so we never depend on a missing / oddly-scaled GLB.
 */
export function preloadViewArms(): Promise<void> {
  return Promise.resolve();
}

export const VIEW_ARMS_URL = '';

export function createPistolGripArms(weaponRoot: THREE.Object3D): THREE.Object3D | null {
  weaponRoot.updateMatrixWorld(true);
  const gun = new THREE.Box3().setFromObject(weaponRoot);
  if (!Number.isFinite(gun.min.x)) {
    gun.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, 0.16, 0.28));
  }

  const root = new THREE.Group();
  root.name = 'viewArms';

  const mat = new THREE.MeshStandardMaterial({
    color: 0x15171a,
    roughness: 0.86,
    metalness: 0.06,
    envMapIntensity: 0.12,
  });

  const gs = gun.getSize(new THREE.Vector3());
  const gc = gun.getCenter(new THREE.Vector3());

  const makeHand = (side: 1 | -1): THREE.Group => {
    const g = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.03, 0.078), mat);
    palm.position.set(side * 0.01, 0, 0);
    g.add(palm);

    for (let i = 0; i < 4; i++) {
      const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.015, 0.028), mat);
      knuckle.position.set(side * (0.006 + i * 0.012), -0.01, -0.02);
      knuckle.rotation.x = 1.05;
      g.add(knuckle);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.013, 0.024), mat);
      tip.position.set(side * (0.006 + i * 0.012), -0.028, -0.01);
      tip.rotation.x = 1.55;
      g.add(tip);
    }

    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.014, 0.036), mat);
    thumb.position.set(side * -0.024, 0.01, 0.012);
    thumb.rotation.set(0.4, side * 0.7, side * 0.35);
    g.add(thumb);

    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.022, 0.09, 8), mat);
    wrist.rotation.x = Math.PI / 2;
    wrist.position.set(side * 0.008, 0.008, 0.085);
    g.add(wrist);

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.16, 8), mat);
    forearm.rotation.x = Math.PI / 2;
    forearm.position.set(side * 0.01, 0.015, 0.2);
    g.add(forearm);

    return g;
  };

  // Primary wrap on the rear grip (right).
  const right = makeHand(1);
  right.position.set(
    gc.x + gs.x * 0.12,
    gun.min.y + gs.y * 0.22,
    gun.max.z - gs.z * 0.08,
  );
  right.rotation.set(0.22, 0.1, 0.18);
  right.scale.setScalar(1.05);

  // Support hand slightly forward / opposite side.
  const left = makeHand(-1);
  left.position.set(
    gc.x - gs.x * 0.14,
    gun.min.y + gs.y * 0.28,
    gun.max.z - gs.z * 0.22,
  );
  left.rotation.set(0.28, -0.16, -0.22);
  left.scale.setScalar(0.98);

  root.add(right, left);
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
  return root;
}

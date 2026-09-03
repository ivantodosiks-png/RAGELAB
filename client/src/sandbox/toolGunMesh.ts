import * as THREE from 'three';

const bodyMat = () =>
  new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.38, metalness: 0.72 });
const accentMat = () =>
  new THREE.MeshStandardMaterial({ color: 0xe07a2f, roughness: 0.42, metalness: 0.28 });
const darkMat = () =>
  new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.55, metalness: 0.4 });
const screenMat = () =>
  new THREE.MeshStandardMaterial({
    color: 0xd6ff3d,
    emissive: 0x6a8a12,
    emissiveIntensity: 0.85,
    roughness: 0.22,
    metalness: 0.1,
  });
const glowMat = () =>
  new THREE.MeshStandardMaterial({
    color: 0xffc070,
    emissive: 0xff8a3a,
    emissiveIntensity: 1.1,
    roughness: 0.3,
    metalness: 0.2,
  });

function box(
  parent: THREE.Group,
  mat: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  disposables: THREE.BufferGeometry[],
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  disposables.push(geo);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function cyl(
  parent: THREE.Group,
  mat: THREE.Material,
  rTop: number,
  rBot: number,
  h: number,
  x: number,
  y: number,
  z: number,
  rx: number,
  disposables: THREE.BufferGeometry[],
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, 10, 1);
  disposables.push(geo);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  mesh.castShadow = false;
  parent.add(mesh);
  return mesh;
}

/**
 * Compact first-person Tool Gun. Shared-style materials, low-poly boxes/cylinders
 * only — cheap enough to keep in the view-model pass every frame.
 */
export function buildToolGunMesh(disposables: Array<{ dispose(): void }>): THREE.Group {
  const root = new THREE.Group();
  root.name = 'toolGun';
  const geos: THREE.BufferGeometry[] = [];
  const body = bodyMat();
  const accent = accentMat();
  const dark = darkMat();
  const screen = screenMat();
  const glow = glowMat();
  for (const mat of [body, accent, dark, screen, glow]) disposables.push(mat);

  // Receiver + orange shell
  box(root, body, 0.055, 0.07, 0.16, 0, 0.02, -0.02, geos);
  box(root, accent, 0.058, 0.042, 0.11, 0, 0.038, -0.01, geos);
  // Grip
  const grip = box(root, dark, 0.038, 0.095, 0.05, 0.0, -0.055, 0.035, geos);
  grip.rotation.x = 0.28;
  // Trigger guard + trigger
  box(root, dark, 0.012, 0.028, 0.04, 0, -0.018, 0.012, geos);
  box(root, accent, 0.008, 0.018, 0.01, 0, -0.012, 0.004, geos);
  // Barrel / emitter
  cyl(root, body, 0.016, 0.018, 0.09, 0, 0.018, -0.13, Math.PI / 2, geos);
  cyl(root, dark, 0.02, 0.02, 0.018, 0, 0.018, -0.175, Math.PI / 2, geos);
  cyl(root, glow, 0.011, 0.008, 0.02, 0, 0.018, -0.188, Math.PI / 2, geos);
  // Side LCD
  box(root, dark, 0.004, 0.032, 0.048, 0.03, 0.034, -0.02, geos);
  box(root, screen, 0.002, 0.024, 0.038, 0.033, 0.034, -0.02, geos);
  // Top rail + screws
  box(root, dark, 0.018, 0.008, 0.1, 0, 0.058, -0.02, geos);
  box(root, accent, 0.01, 0.006, 0.01, 0, 0.064, -0.05, geos);
  box(root, accent, 0.01, 0.006, 0.01, 0, 0.064, 0.01, geos);
  // Magazine well
  box(root, dark, 0.032, 0.05, 0.028, 0, -0.02, 0.048, geos);
  box(root, accent, 0.034, 0.01, 0.03, 0, -0.042, 0.048, geos);

  for (const geo of geos) disposables.push(geo);
  return root;
}

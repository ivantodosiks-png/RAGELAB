import * as THREE from 'three';
import { GLOCK_17_URL, FPS_ARMS_URL, cloneFpsAsset, preloadFpsView } from './fpsAssets';

/**
 * Local first-person Glock kit.
 *
 * Both J-Toastie GLBs are untextured FBX→glTF (solid Phong colors only) with
 * Unity scale on the nodes. Fit the visible bind-pose mesh, not the tiny
 * bone cluster — otherwise the Glock explodes to half the screen.
 */
export class FpsPistolRig {
  readonly root = new THREE.Group();
  readonly weaponSocket = new THREE.Group();
  readonly muzzleAnchor = new THREE.Object3D();

  private readonly arms = new THREE.Group();
  private readonly glock = new THREE.Group();
  private assembled = false;

  constructor() {
    this.root.name = 'fpsPistolRig';
    this.arms.name = 'fpsArms';
    this.glock.name = 'glock17';
    this.weaponSocket.name = 'WeaponSocket';
    this.muzzleAnchor.name = 'MuzzlePoint';
    this.root.add(this.arms);
    this.root.add(this.weaponSocket);
    this.weaponSocket.add(this.glock);
    this.weaponSocket.add(this.muzzleAnchor);
  }

  get ready(): boolean {
    return this.assembled;
  }

  async assemble(): Promise<boolean> {
    await preloadFpsView();
    const armsScene = cloneFpsAsset(FPS_ARMS_URL);
    const glockScene = cloneFpsAsset(GLOCK_17_URL);
    if (!armsScene || !glockScene) return false;

    prepareViewMesh(armsScene);
    prepareViewMesh(glockScene);
    hideNamed(glockScene, 'Glock19.001');
    tuneViewMaterials(armsScene, 'arms');
    tuneViewMaterials(glockScene, 'glock');

    const armsFit = new THREE.Group();
    armsFit.name = 'fpsArmsFit';
    armsFit.add(armsScene);
    this.arms.add(armsFit);
    refreshSkins(armsFit);
    fitByMesh(armsFit, 0.4);
    centerByMesh(armsFit);
    this.arms.position.set(0.04, -0.24, -0.34);

    const glockFit = new THREE.Group();
    glockFit.name = 'glockFit';
    glockFit.add(glockScene);
    this.glock.add(glockFit);
    refreshSkins(glockFit);
    fitByMesh(glockFit, 0.18);
    centerByMesh(glockFit);

    this.weaponSocket.position.set(0.09, -0.13, -0.26);
    this.weaponSocket.rotation.set(0.02, 0.04, 0.02);
    this.muzzleAnchor.position.set(0, 0.014, -0.09);
    this.muzzleAnchor.rotation.set(0, 0, 0);

    this.assembled = true;
    return true;
  }

  syncMuzzle(muzzlePoint: THREE.Object3D): void {
    if (!muzzlePoint.parent) return;
    this.muzzleAnchor.updateWorldMatrix(true, false);
    this.muzzleAnchor.getWorldPosition(tmpPos);
    this.muzzleAnchor.getWorldQuaternion(tmpQuat);
    muzzlePoint.parent.worldToLocal(tmpPos);
    muzzlePoint.position.copy(tmpPos);
    const parentQuat = tmpParentQuat.setFromRotationMatrix(tmpMat.copy(muzzlePoint.parent.matrixWorld));
    muzzlePoint.quaternion.copy(parentQuat.invert().multiply(tmpQuat));
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.clear();
    this.assembled = false;
  }
}

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpParentQuat = new THREE.Quaternion();
const tmpMat = new THREE.Matrix4();
const tmpBox = new THREE.Box3();
const tmpGeomBox = new THREE.Box3();
const tmpSize = new THREE.Vector3();
const tmpCenter = new THREE.Vector3();

function prepareViewMesh(root: THREE.Object3D): void {
  root.traverse((obj) => {
    obj.frustumCulled = false;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
  });
}

function hideNamed(root: THREE.Object3D, name: string): void {
  root.traverse((obj) => {
    if (obj.name === name) obj.visible = false;
  });
}

/** These GLBs have no maps — keep the FBX colors from blowing out under view lights. */
function tuneViewMaterials(root: THREE.Object3D, kind: 'arms' | 'glock'): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const raw of list) {
      if (!(raw instanceof THREE.MeshStandardMaterial)) continue;
      raw.metalness = kind === 'glock' ? 0.12 : 0.04;
      raw.roughness = kind === 'glock' ? Math.max(raw.roughness, 0.55) : Math.max(raw.roughness, 0.7);
      raw.envMapIntensity = 0.15;
      if (raw.name === 'White') {
        raw.color.setRGB(0.72, 0.74, 0.7);
        raw.metalness = 0;
        raw.roughness = 0.85;
      }
      raw.needsUpdate = true;
    }
  });
}

function refreshSkins(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) mesh.skeleton.update();
  });
}

/** Bind-pose geometry × mesh matrix. Skinned AABB double-counts bone worlds. */
function expandMeshBox(root: THREE.Object3D, box: THREE.Box3): boolean {
  let any = false;
  box.makeEmpty();
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    tmpGeomBox.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    box.union(tmpGeomBox);
    any = true;
  });
  return any;
}

function fitByMesh(root: THREE.Object3D, targetLength: number): void {
  if (!expandMeshBox(root, tmpBox)) return;
  tmpBox.getSize(tmpSize);
  const longest = Math.max(tmpSize.x, tmpSize.y, tmpSize.z, 0.001);
  root.scale.multiplyScalar(targetLength / longest);
}

function centerByMesh(root: THREE.Object3D): void {
  if (!expandMeshBox(root, tmpBox)) return;
  tmpBox.getCenter(tmpCenter);
  root.position.sub(tmpCenter);
}

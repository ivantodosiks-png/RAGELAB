import * as THREE from 'three';
import { GLOCK_17_URL, FPS_ARMS_URL, cloneFpsAsset, preloadFpsView } from './fpsAssets';

/**
 * Local first-person Glock kit.
 *
 * The J-Toastie arms GLB is a Blender/Unity export (Z-up, huge scale, +X
 * offset). We never parent the gun into that armature — we stand the arms up
 * in camera space and keep the Glock on a fixed WeaponSocket so the muzzle
 * stays on the barrel, not under the HUD name.
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

    // Stand the authored Z-up / sideways kit up and face camera -Z.
    const armsFit = new THREE.Group();
    armsFit.name = 'fpsArmsFit';
    armsFit.add(armsScene);
    armsFit.rotation.set(-Math.PI / 2, Math.PI, 0);
    this.arms.add(armsFit);
    fitObject(armsFit, 0.52);
    centerObject(armsFit);
    this.arms.position.set(0.07, -0.3, -0.4);

    const glockFit = new THREE.Group();
    glockFit.name = 'glockFit';
    glockFit.add(glockScene);
    this.glock.add(glockFit);
    fitObject(glockFit, 0.2);
    centerObject(glockFit);
    glockFit.rotation.y = Math.PI;
    glockFit.position.y -= 0.02;
    glockFit.position.z += 0.02;

    // Fixed view-space socket: lower-right, barrel toward -Z.
    this.weaponSocket.position.set(0.11, -0.15, -0.3);
    this.weaponSocket.rotation.set(0.02, 0.08, 0.04);
    this.muzzleAnchor.position.set(0, 0.018, -0.11);
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

function fitObject(root: THREE.Object3D, targetLength: number): void {
  root.updateMatrixWorld(true);
  tmpBox.setFromObject(root);
  tmpBox.getSize(tmpSize);
  const longest = Math.max(tmpSize.x, tmpSize.y, tmpSize.z, 0.001);
  root.scale.multiplyScalar(targetLength / longest);
}

function centerObject(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  tmpBox.setFromObject(root);
  tmpBox.getCenter(tmpCenter);
  root.position.sub(tmpCenter);
}

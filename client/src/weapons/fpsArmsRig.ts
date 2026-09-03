import * as THREE from 'three';
import { GLOCK_17_URL, FPS_ARMS_URL, cloneFpsAsset, preloadFpsView } from './fpsAssets';

/**
 * Local first-person Glock kit.
 *
 * Both GLBs are Unity skinned exports (≈50–188 scale, −90° X already on the
 * nodes). Clone via SkeletonUtils, then uniformly fit the whole tree — never
 * re-parent the gun into the 188× armature.
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
    stripSceneOffset(armsScene, 'Armature', 'ArmModel');

    const armsFit = new THREE.Group();
    armsFit.name = 'fpsArmsFit';
    armsFit.add(armsScene);
    this.arms.add(armsFit);
    refreshSkins(armsFit);
    fitByBones(armsFit, 0.36);
    centerByBones(armsFit);
    this.arms.position.set(0.05, -0.28, -0.32);

    const glockFit = new THREE.Group();
    glockFit.name = 'glockFit';
    glockFit.add(glockScene);
    this.glock.add(glockFit);
    refreshSkins(glockFit);
    fitByBones(glockFit, 0.19);
    centerByBones(glockFit);
    glockFit.rotation.y = Math.PI;

    this.weaponSocket.position.set(0.1, -0.14, -0.28);
    this.weaponSocket.rotation.set(0.02, 0.06, 0.03);
    this.muzzleAnchor.position.set(0, 0.016, -0.1);
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

/** Drop the shared Unity scene translation so mesh + armature stay aligned. */
function stripSceneOffset(scene: THREE.Object3D, armatureName: string, meshName: string): void {
  const armature = scene.getObjectByName(armatureName);
  const mesh = scene.getObjectByName(meshName);
  if (armature) armature.position.set(0, 0, 0);
  if (mesh) mesh.position.set(0, 0, 0);
}

function refreshSkins(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) mesh.skeleton.update();
  });
}

function expandBoneBox(root: THREE.Object3D, box: THREE.Box3): boolean {
  let any = false;
  box.makeEmpty();
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (!(obj as THREE.Bone).isBone) return;
    obj.getWorldPosition(tmpPos);
    box.expandByPoint(tmpPos);
    any = true;
  });
  return any;
}

function fitByBones(root: THREE.Object3D, targetLength: number): void {
  if (!expandBoneBox(root, tmpBox)) {
    root.updateMatrixWorld(true);
    tmpBox.setFromObject(root);
  }
  tmpBox.getSize(tmpSize);
  const longest = Math.max(tmpSize.x, tmpSize.y, tmpSize.z, 0.001);
  root.scale.multiplyScalar(targetLength / longest);
}

function centerByBones(root: THREE.Object3D): void {
  if (!expandBoneBox(root, tmpBox)) {
    root.updateMatrixWorld(true);
    tmpBox.setFromObject(root);
  }
  tmpBox.getCenter(tmpCenter);
  root.position.sub(tmpCenter);
}

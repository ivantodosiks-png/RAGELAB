import * as THREE from 'three';
import { GLOCK_17_URL, FPS_ARMS_URL, cloneFpsAsset, preloadFpsView } from './fpsAssets';

/**
 * First-person Glock kit: camera-space arms + a WeaponSocket on the right
 * palm. Only ever added to the local view-model scene.
 */
export class FpsPistolRig {
  readonly root = new THREE.Group();
  readonly weaponSocket = new THREE.Group();
  readonly muzzleAnchor = new THREE.Object3D();

  private readonly arms = new THREE.Group();
  private readonly glock = new THREE.Group();
  private handR: THREE.Bone | null = null;
  private attached = false;
  private readonly boneRests = new Map<THREE.Bone, THREE.Quaternion>();

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
    return this.attached;
  }

  async assemble(): Promise<boolean> {
    await preloadFpsView();
    const armsScene = cloneFpsAsset(FPS_ARMS_URL);
    const glockScene = cloneFpsAsset(GLOCK_17_URL);
    if (!armsScene || !glockScene) return false;

    prepareViewMesh(armsScene);
    prepareViewMesh(glockScene);
    hideNamed(glockScene, 'Glock19.001');

    this.arms.add(armsScene);
    this.glock.add(glockScene);

    // Authored Unity scales are huge; fit each piece independently.
    fitObject(this.arms, 0.62);
    centerObject(this.arms);
    this.arms.position.set(0.045, -0.3, -0.3);
    this.arms.rotation.set(0.12, 0.18, 0.02);

    fitObject(this.glock, 0.195);
    alignGlockGrip(this.glock);
    this.weaponSocket.position.set(0.11, -0.2, -0.34);
    this.weaponSocket.rotation.set(-0.12, 0.35, 0.18);
    this.muzzleAnchor.position.set(0.0, 0.03, -0.11);

    this.handR = findBone(this.arms, 'Hand.R.001') ?? findBone(this.arms, 'Hand.R');
    this.captureBoneRests(this.arms);
    this.applyGripPose();
    this.arms.updateMatrixWorld(true);
    this.followHand();
    this.attached = true;
    return true;
  }

  /**
   * Keep the Glock on the right palm without parenting into the skinned
   * armature — the authored Unity scales would explode the gun.
   */
  followHand(): void {
    if (!this.handR) return;
    this.handR.updateWorldMatrix(true, false);
    this.handR.getWorldPosition(tmpPos);
    this.handR.getWorldQuaternion(tmpQuat);
    const parent = this.weaponSocket.parent;
    if (!parent) return;
    parent.worldToLocal(tmpPos);
    this.weaponSocket.position.copy(tmpPos);
    const parentWorld = tmpParentQuat.setFromRotationMatrix(tmpMat.copy(parent.matrixWorld));
    this.weaponSocket.quaternion.copy(parentWorld.invert().multiply(tmpQuat));
    this.weaponSocket.rotateX(-0.55);
    this.weaponSocket.rotateY(1.15);
    this.weaponSocket.rotateZ(1.35);
    this.weaponSocket.position.y += 0.012;
    this.weaponSocket.position.z += 0.004;
  }

  /** Keep a rest-relative pistol grip without baking a new animation clip. */
  private applyGripPose(): void {
    const deg = Math.PI / 180;
    pose(this.arms, this.boneRests, 'LowerArm.R.001', 8 * deg, 6 * deg, -12 * deg);
    pose(this.arms, this.boneRests, 'Hand.R.001', 18 * deg, 8 * deg, 14 * deg);
    pose(this.arms, this.boneRests, 'IndexBeginning.R.001', 12 * deg, 0, 8 * deg);
    pose(this.arms, this.boneRests, 'Index.R.001', 28 * deg, 0, 0);
    pose(this.arms, this.boneRests, 'IndexTip.R.001', 16 * deg, 0, 0);
    pose(this.arms, this.boneRests, 'DoubleFingersBeginning.001', 36 * deg, 4 * deg, 6 * deg);
    pose(this.arms, this.boneRests, 'DoubleFingers.R.001', 42 * deg, 0, 0);
    pose(this.arms, this.boneRests, 'DoubleFingersTip.R.001', 22 * deg, 0, 0);
    pose(this.arms, this.boneRests, 'ThumbBeginning.R.001', -8 * deg, 22 * deg, 18 * deg);
    pose(this.arms, this.boneRests, 'Thumb.R.001', 10 * deg, 8 * deg, 12 * deg);

    pose(this.arms, this.boneRests, 'LowerArm.L', 10 * deg, -18 * deg, 16 * deg);
    pose(this.arms, this.boneRests, 'Hand.L', 14 * deg, -12 * deg, -10 * deg);
    pose(this.arms, this.boneRests, 'IndexBeginning.L', 20 * deg, 0, 0);
    pose(this.arms, this.boneRests, 'Index.L', 32 * deg, 0, 0);
    pose(this.arms, this.boneRests, 'DoubleFingersBeginning', 34 * deg, 0, 0);
    pose(this.arms, this.boneRests, 'DoubleFingers.L', 38 * deg, 0, 0);
    pose(this.arms, this.boneRests, 'ThumbBeginning.L', -6 * deg, -16 * deg, -14 * deg);
  }

  private captureBoneRests(root: THREE.Object3D): void {
    root.traverse((obj) => {
      if (obj instanceof THREE.Bone && !this.boneRests.has(obj)) {
        this.boneRests.set(obj, obj.quaternion.clone());
      }
    });
  }

  syncMuzzle(muzzlePoint: THREE.Object3D): void {
    this.followHand();
    if (!muzzlePoint.parent) return;
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
    this.boneRests.clear();
    this.handR = null;
    this.attached = false;
  }
}

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpParentQuat = new THREE.Quaternion();
const tmpMat = new THREE.Matrix4();
const tmpBox = new THREE.Box3();
const tmpSize = new THREE.Vector3();
const tmpCenter = new THREE.Vector3();
const tmpEuler = new THREE.Euler();
const tmpExtra = new THREE.Quaternion();

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

/** Sit the grip on the socket origin, barrel along local -Z. */
function alignGlockGrip(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  tmpBox.setFromObject(root);
  tmpBox.getCenter(tmpCenter);
  tmpBox.getSize(tmpSize);
  root.position.set(-tmpCenter.x, -tmpBox.min.y - tmpSize.y * 0.18, -tmpCenter.z + tmpSize.z * 0.12);
  root.rotation.set(0, Math.PI, 0);
}

function findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((obj) => {
    if (obj instanceof THREE.Bone && obj.name === name) found = obj;
  });
  return found;
}

function pose(
  root: THREE.Object3D,
  rests: Map<THREE.Bone, THREE.Quaternion>,
  name: string,
  x: number,
  y: number,
  z: number,
): void {
  const bone = findBone(root, name);
  if (!bone) return;
  const rest = rests.get(bone) ?? bone.quaternion.clone();
  tmpEuler.set(x, y, z, 'XYZ');
  tmpExtra.setFromEuler(tmpEuler);
  bone.quaternion.copy(rest).multiply(tmpExtra);
}

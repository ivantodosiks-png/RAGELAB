import * as THREE from 'three';
import { GLOCK_17_URL, FPS_ARMS_URL, cloneFpsAsset, preloadFpsView } from './fpsAssets';

/** View-space grip: on the look axis (−Z), lower third of the frame. */
const GRIP = new THREE.Vector3(0.035, -0.095, -0.28);
const LOOK = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

const LEFT_FINGERS: Array<[string, number]> = [
  ['DoubleFingersBeginning', 0.7],
  ['DoubleFingers.L', 0.95],
  ['DoubleFingersTip.L', 0.55],
  ['IndexBeginning.L', 0.65],
  ['Index.L', 0.9],
  ['IndexTip.L', 0.5],
];

const RIGHT_FINGERS: Array<[string, number]> = [
  ['DoubleFingersBeginning.001', 0.7],
  ['DoubleFingers.R.001', 0.95],
  ['DoubleFingersTip.R.001', 0.55],
  ['IndexBeginning.R.001', 0.65],
  ['Index.R.001', 0.9],
  ['IndexTip.R.001', 0.5],
];

/**
 * Local first-person Glock kit: small gun on the look axis, hands IK'd to the
 * grip, fingers curled around it. GLBs have no image textures.
 */
export class FpsPistolRig {
  readonly root = new THREE.Group();
  readonly weaponSocket = new THREE.Group();
  readonly muzzleAnchor = new THREE.Object3D();

  private readonly arms = new THREE.Group();
  private readonly glock = new THREE.Group();
  private barrelBone: THREE.Object3D | null = null;
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
    flattenViewMaterials(armsScene);
    flattenViewMaterials(glockScene);

    const armsFit = new THREE.Group();
    armsFit.name = 'fpsArmsFit';
    armsFit.add(armsScene);
    armsFit.rotation.y = Math.PI / 2;
    this.arms.add(armsFit);
    refreshSkins(armsFit);
    fitByMesh(armsFit, 0.32);
    centerByMesh(armsFit);
    this.arms.position.set(0.02, -0.16, -0.22);

    const glockFit = new THREE.Group();
    glockFit.name = 'glockFit';
    glockFit.add(glockScene);
    this.glock.add(glockFit);
    refreshSkins(glockFit);
    alignBarrelToLook(glockFit);
    fitByMesh(glockFit, 0.086);
    centerOnNamed(glockFit, 'Magazine');

    this.barrelBone = this.glock.getObjectByName('Barrel') ?? null;
    this.weaponSocket.position.copy(GRIP);
    this.weaponSocket.rotation.set(0.05, 0.04, 0.02);

    this.root.updateMatrixWorld(true);
    const left = this.arms.getObjectByName('Hand.L');
    const right = this.arms.getObjectByName('Hand.R.001');
    const gripWorld = GRIP.clone();
    this.root.localToWorld(gripWorld);
    if (right) {
      pullHandTo(right, tmpRight.copy(gripWorld).add(tmpOff.set(0.012, -0.008, 0.016)));
    }
    if (left) {
      pullHandTo(left, tmpLeft.copy(gripWorld).add(tmpOff.set(-0.028, -0.004, 0.01)));
    }
    curlFingers(this.arms, LEFT_FINGERS, 1);
    curlFingers(this.arms, RIGHT_FINGERS, -1);
    curlThumb(this.arms.getObjectByName('ThumbBeginning.L'), 1);
    curlThumb(this.arms.getObjectByName('Thumb.L'), 1);
    curlThumb(this.arms.getObjectByName('ThumbTip.L'), 1);
    curlThumb(this.arms.getObjectByName('ThumbBeginning.R.001'), -1);
    curlThumb(this.arms.getObjectByName('Thumb.R.001'), -1);
    curlThumb(this.arms.getObjectByName('ThumbTip.R.001'), -1);
    refreshSkins(this.arms);

    this.placeMuzzleOnBarrel();
    this.assembled = true;
    return true;
  }

  syncMuzzle(muzzlePoint: THREE.Object3D): void {
    if (!this.assembled) return;
    this.placeMuzzleOnBarrel();
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
    this.barrelBone = null;
    this.assembled = false;
  }

  private placeMuzzleOnBarrel(): void {
    const barrel = this.barrelBone;
    if (!barrel) {
      this.muzzleAnchor.position.set(0, 0.01, -0.055);
      return;
    }
    barrel.getWorldPosition(tmpPos);
    this.weaponSocket.worldToLocal(tmpPos);
    this.muzzleAnchor.position.copy(tmpPos);
    this.muzzleAnchor.rotation.set(0, 0, 0);
  }
}

const tmpPos = new THREE.Vector3();
const tmpLeft = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpOff = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpParentQuat = new THREE.Quaternion();
const tmpAlign = new THREE.Quaternion();
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

function flattenViewMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material;
    const list = Array.isArray(src) ? src : [src];
    const next = list.map((mat) => {
      const color = new THREE.Color(0x2a2d32);
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhongMaterial) {
        color.copy(mat.color);
      }
      return new THREE.MeshBasicMaterial({ color, name: mat.name });
    });
    mesh.material = Array.isArray(src) ? next : next[0]!;
  });
}

function refreshSkins(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) mesh.skeleton.update();
  });
}

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

function centerOnNamed(root: THREE.Object3D, name: string): void {
  const target = root.getObjectByName(name);
  if (!target || !root.parent) {
    centerByMesh(root);
    return;
  }
  root.updateMatrixWorld(true);
  target.getWorldPosition(tmpPos);
  root.parent.worldToLocal(tmpPos);
  root.position.sub(tmpPos);
}

/** Barrel − slide is muzzle direction; twist so magazine hangs down. */
function alignBarrelToLook(root: THREE.Object3D): void {
  const barrel = root.getObjectByName('Barrel');
  const slide = root.getObjectByName('Slide');
  const mag = root.getObjectByName('Magazine');
  root.updateMatrixWorld(true);
  if (!barrel || !slide) {
    root.rotation.y = Math.PI;
    return;
  }
  barrel.getWorldPosition(tmpA);
  slide.getWorldPosition(tmpB);
  const forward = tmpA.sub(tmpB);
  if (forward.lengthSq() < 1e-8) {
    root.rotation.y = Math.PI;
    return;
  }
  forward.normalize();
  root.quaternion.premultiply(tmpAlign.setFromUnitVectors(forward, LOOK));
  root.updateMatrixWorld(true);
  if (!mag) return;
  mag.getWorldPosition(tmpA);
  slide.getWorldPosition(tmpB);
  const gunUp = tmpB.sub(tmpA);
  gunUp.projectOnPlane(LOOK);
  if (gunUp.lengthSq() < 1e-8) return;
  gunUp.normalize();
  const desired = UP.clone().projectOnPlane(LOOK);
  if (desired.lengthSq() < 1e-8) return;
  desired.normalize();
  root.quaternion.premultiply(tmpAlign.setFromUnitVectors(gunUp, desired));
}

function pullHandTo(hand: THREE.Object3D, target: THREE.Vector3): void {
  let bone: THREE.Object3D | null = hand.parent;
  for (let iter = 0; iter < 5 && bone; iter += 1) {
    const lower = bone;
    const upper = lower.parent;
    for (const joint of [lower, upper]) {
      if (!joint || joint.name === 'Armature' || joint.name === 'RootNode') continue;
      joint.updateWorldMatrix(true, false);
      hand.updateWorldMatrix(true, false);
      joint.getWorldPosition(tmpA);
      hand.getWorldPosition(tmpB);
      const toHand = tmpB.sub(tmpA);
      const toTarget = tmpPos.copy(target).sub(tmpA);
      if (toHand.lengthSq() < 1e-8 || toTarget.lengthSq() < 1e-8) continue;
      tmpAxis.crossVectors(toHand, toTarget);
      if (tmpAxis.lengthSq() < 1e-10) continue;
      tmpAxis.normalize();
      const angle = Math.min(0.55, toHand.angleTo(toTarget));
      joint.rotateOnWorldAxis(tmpAxis, angle);
      joint.updateMatrixWorld(true);
    }
    bone = upper && upper.name !== 'Armature' ? upper.parent : null;
  }
}

function curlFingers(root: THREE.Object3D, chain: Array<[string, number]>, sign: number): void {
  for (const [name, amount] of chain) {
    const bone = root.getObjectByName(name);
    if (bone) bone.rotateX(amount * sign);
  }
}

function curlThumb(bone: THREE.Object3D | undefined, sign: number): void {
  if (!bone) return;
  bone.rotateY(-0.55 * sign);
  bone.rotateX(0.7 * sign);
  bone.rotateZ(0.25 * sign);
}

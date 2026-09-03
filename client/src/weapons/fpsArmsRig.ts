import * as THREE from 'three';
import { GLOCK_17_URL, FPS_ARMS_URL, cloneFpsAsset, preloadFpsView } from './fpsAssets';

const FINGER_BONES = [
  'DoubleFingersBeginning',
  'DoubleFingers.L',
  'DoubleFingersTip.L',
  'IndexBeginning.L',
  'Index.L',
  'IndexTip.L',
  'DoubleFingersBeginning.001',
  'DoubleFingers.R.001',
  'DoubleFingersTip.R.001',
  'IndexBeginning.R.001',
  'Index.R.001',
  'IndexTip.R.001',
];

/**
 * FPS Glock kit. The mesh already faces −Z (camera look). Bone-based "barrel
 * align" flipped it toward the face — we do not do that. The gun sits in the
 * palms; fingers curl on the same local axis on both hands.
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
    flattenViewMaterials(armsScene);
    flattenViewMaterials(glockScene);

    const armsFit = new THREE.Group();
    armsFit.name = 'fpsArmsFit';
    armsFit.add(armsScene);
    armsFit.rotation.y = Math.PI / 2;
    this.arms.add(armsFit);
    refreshSkins(armsFit);
    fitByMesh(armsFit, 0.3);
    centerByMesh(armsFit);
    this.arms.position.set(0.02, -0.14, -0.24);

    const left = this.arms.getObjectByName('Hand.L');
    const right = this.arms.getObjectByName('Hand.R.001');
    if (left) left.rotateOnWorldAxis(WORLD_Y, 0.55);
    if (right) right.rotateOnWorldAxis(WORLD_Y, -0.55);
    const leftLower = this.arms.getObjectByName('LowerArm.L');
    const rightLower = this.arms.getObjectByName('LowerArm.R.001');
    if (leftLower) leftLower.rotateOnWorldAxis(WORLD_Y, 0.35);
    if (rightLower) rightLower.rotateOnWorldAxis(WORLD_Y, -0.35);
    for (const name of FINGER_BONES) {
      const bone = this.arms.getObjectByName(name);
      if (bone) bone.rotateX(0.9);
    }
    curlThumb(this.arms.getObjectByName('ThumbBeginning.L'));
    curlThumb(this.arms.getObjectByName('Thumb.L'));
    curlThumb(this.arms.getObjectByName('ThumbTip.L'));
    curlThumb(this.arms.getObjectByName('ThumbBeginning.R.001'));
    curlThumb(this.arms.getObjectByName('Thumb.R.001'));
    curlThumb(this.arms.getObjectByName('ThumbTip.R.001'));
    refreshSkins(this.arms);

    const glockFit = new THREE.Group();
    glockFit.name = 'glockFit';
    glockFit.add(glockScene);
    this.glock.add(glockFit);
    refreshSkins(glockFit);
    // Authored mesh −90° X already puts the muzzle on −Z. Do not yaw 180.
    fitByMesh(glockFit, 0.08);
    centerOnNamed(glockFit, 'Magazine');

    this.root.updateMatrixWorld(true);
    this.placeGunInPalms(left, right);
    this.placeMuzzleAtFront();
    this.assembled = true;
    return true;
  }

  syncMuzzle(muzzlePoint: THREE.Object3D): void {
    if (!this.assembled || !muzzlePoint.parent) return;
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

  private placeGunInPalms(left: THREE.Object3D | undefined, right: THREE.Object3D | undefined): void {
    if (!left || !right) {
      this.weaponSocket.position.set(0.06, -0.12, -0.26);
      this.weaponSocket.rotation.set(0.08, 0.05, 0.03);
      return;
    }
    left.getWorldPosition(tmpLeft);
    right.getWorldPosition(tmpRight);
    tmpGrip.lerpVectors(tmpLeft, tmpRight, 0.7);
    this.root.worldToLocal(tmpGrip);
    tmpGrip.y += 0.018;
    tmpGrip.z += 0.012;
    this.weaponSocket.position.copy(tmpGrip);
    this.weaponSocket.rotation.set(0.1, 0.06, 0.04);
  }

  private placeMuzzleAtFront(): void {
    if (!expandMeshBox(this.glock, tmpBox)) {
      this.muzzleAnchor.position.set(0, 0.012, -0.05);
      return;
    }
    tmpPos.set((tmpBox.min.x + tmpBox.max.x) * 0.5, tmpBox.max.y * 0.55 + tmpBox.min.y * 0.45, tmpBox.min.z);
    this.weaponSocket.worldToLocal(tmpPos);
    this.muzzleAnchor.position.copy(tmpPos);
    this.muzzleAnchor.rotation.set(0, 0, 0);
  }
}

const WORLD_Y = new THREE.Vector3(0, 1, 0);
const tmpPos = new THREE.Vector3();
const tmpGrip = new THREE.Vector3();
const tmpLeft = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
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

function curlThumb(bone: THREE.Object3D | undefined): void {
  if (!bone) return;
  bone.rotateX(0.85);
  bone.rotateY(-0.45);
}

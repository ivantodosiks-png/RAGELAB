import * as THREE from 'three';
import { GLOCK_17_URL, FPS_ARMS_URL, cloneFpsAsset, preloadFpsView } from './fpsAssets';

/**
 * Local first-person Glock kit.
 *
 * Authored rest pose reaches +X with the hands split on Z; barrel bones point
 * +Z. We yaw the arms +90° so they reach camera-forward (−Z), yaw the Glock
 * 180° so the muzzle joins them, then snap the socket to the palms.
 *
 * Neither GLB has image textures — only FBX solid colors. View-model lights
 * blow those out to white if they stay MeshStandard, so they become Basic.
 */
export class FpsPistolRig {
  readonly root = new THREE.Group();
  readonly weaponSocket = new THREE.Group();
  readonly muzzleAnchor = new THREE.Object3D();

  private readonly arms = new THREE.Group();
  private readonly glock = new THREE.Group();
  private readonly leftHand = { current: null as THREE.Object3D | null };
  private readonly rightHand = { current: null as THREE.Object3D | null };
  private readonly barrelBone = { current: null as THREE.Object3D | null };
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
    // Reach +X, hands split on Z → reach −Z, right hand on +X.
    armsFit.rotation.y = Math.PI / 2;
    this.arms.add(armsFit);
    refreshSkins(armsFit);
    fitByMesh(armsFit, 0.36);
    centerByMesh(armsFit);
    this.arms.position.set(0.03, -0.2, -0.3);

    const glockFit = new THREE.Group();
    glockFit.name = 'glockFit';
    glockFit.add(glockScene);
    // Barrel bone +Z → camera forward −Z.
    glockFit.rotation.y = Math.PI;
    this.glock.add(glockFit);
    refreshSkins(glockFit);
    fitByMesh(glockFit, 0.15);
    centerByMesh(glockFit);

    this.leftHand.current = this.arms.getObjectByName('Hand.L') ?? null;
    this.rightHand.current = this.arms.getObjectByName('Hand.R.001') ?? null;
    this.barrelBone.current = this.glock.getObjectByName('Barrel') ?? null;

    this.root.updateMatrixWorld(true);
    this.placeInHands();
    this.placeMuzzleOnBarrel();

    this.assembled = true;
    return true;
  }

  syncMuzzle(muzzlePoint: THREE.Object3D): void {
    if (!this.assembled) return;
    this.placeInHands();
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
    this.leftHand.current = null;
    this.rightHand.current = null;
    this.barrelBone.current = null;
    this.assembled = false;
  }

  private placeInHands(): void {
    const left = this.leftHand.current;
    const right = this.rightHand.current;
    if (!left || !right) return;
    left.getWorldPosition(tmpLeft);
    right.getWorldPosition(tmpRight);
    // Two-handed pistol: right palm owns the grip, left supports.
    tmpGrip.lerpVectors(tmpLeft, tmpRight, 0.72);
    this.root.worldToLocal(tmpGrip);
    this.weaponSocket.position.copy(tmpGrip);
    this.weaponSocket.position.y -= 0.012;
    this.weaponSocket.position.z += 0.018;
    this.weaponSocket.rotation.set(0.06, 0.1, 0.04);
  }

  private placeMuzzleOnBarrel(): void {
    const barrel = this.barrelBone.current;
    if (!barrel) {
      this.muzzleAnchor.position.set(0, 0.012, -0.075);
      return;
    }
    barrel.getWorldPosition(tmpPos);
    this.weaponSocket.worldToLocal(tmpPos);
    this.muzzleAnchor.position.copy(tmpPos);
    this.muzzleAnchor.rotation.set(0, 0, 0);
  }
}

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
      const basic = new THREE.MeshBasicMaterial({ color, name: mat.name });
      return basic;
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

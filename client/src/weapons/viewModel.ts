import * as THREE from 'three';
import { clamp, lerp, type Vec3, type WeaponDefinition } from '@ragelab/shared';

/**
 * First-person weapon model.
 *
 * Built procedurally from the weapon definition so a new weapon needs no art:
 * body, barrel, grip, magazine, stock and sight are proportioned from
 * `visual.size` and coloured from `visual.color`/`accentColor`. Rendered in the
 * dedicated view-model scene, so it never clips into geometry.
 */
export class WeaponViewModel {
  readonly root = new THREE.Group();

  private readonly holder = new THREE.Group();
  private readonly recoilPivot = new THREE.Group();
  private readonly model = new THREE.Group();
  private readonly muzzlePoint = new THREE.Object3D();
  private readonly ejectPoint = new THREE.Object3D();

  private def: WeaponDefinition | null = null;
  private readonly disposables: Array<{ dispose(): void }> = [];

  /** 0 = hip, 1 = fully aimed. */
  private aimBlend = 0;
  private aimTarget = 0;

  private recoilOffset = 0;
  private recoilPitch = 0;
  private readonly swayOffset = new THREE.Vector2();
  private readonly swayTarget = new THREE.Vector2();
  private bobPhase = 0;

  private reloadProgress = 0;
  private reloadDurationSec = 0;
  private equipProgress = 1;
  private equipDurationSec = 0.3;

  private readonly hipPosition = new THREE.Vector3();
  private readonly aimPosition = new THREE.Vector3();
  private readonly worldPosition = new THREE.Vector3();
  private readonly worldDirection = new THREE.Vector3();
  private readonly worldRight = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3();

  constructor() {
    this.root.name = 'viewModel';
    this.root.add(this.holder);
    this.holder.add(this.recoilPivot);
    this.recoilPivot.add(this.model);
    this.model.add(this.muzzlePoint);
    this.model.add(this.ejectPoint);
  }

  /** Rebuild the mesh for a new weapon and play the raise animation. */
  equip(def: WeaponDefinition): void {
    this.def = def;
    this.disposeModel();

    const [width, height, length] = def.visual.size;
    const body = new THREE.Group();

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: def.visual.color,
      roughness: 0.48,
      metalness: 0.62,
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: def.visual.accentColor,
      roughness: 0.4,
      metalness: 0.5,
    });
    this.disposables.push(bodyMaterial, accentMaterial);

    const receiverGeo = new THREE.BoxGeometry(width, height * 0.62, length * 0.62);
    const receiver = new THREE.Mesh(receiverGeo, bodyMaterial);
    receiver.position.set(0, 0, -length * 0.1);
    body.add(receiver);

    const barrelGeo = new THREE.CylinderGeometry(width * 0.28, width * 0.3, length * 0.72, 10);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, accentMaterial);
    barrel.position.set(0, height * 0.1, -length * 0.62);
    body.add(barrel);

    const gripGeo = new THREE.BoxGeometry(width * 0.85, height * 0.9, length * 0.18);
    const grip = new THREE.Mesh(gripGeo, bodyMaterial);
    grip.position.set(0, -height * 0.62, length * 0.06);
    grip.rotation.x = -0.24;
    body.add(grip);

    const magGeo = new THREE.BoxGeometry(width * 0.72, height * 0.85, length * 0.16);
    const magazine = new THREE.Mesh(magGeo, accentMaterial);
    magazine.name = 'magazine';
    magazine.position.set(0, -height * 0.6, -length * 0.16);
    body.add(magazine);

    if (length > 0.5) {
      const stockGeo = new THREE.BoxGeometry(width * 0.8, height * 0.55, length * 0.3);
      const stock = new THREE.Mesh(stockGeo, bodyMaterial);
      stock.position.set(0, -height * 0.05, length * 0.3);
      body.add(stock);
      this.disposables.push(stockGeo);
    }

    const sightGeo = new THREE.BoxGeometry(width * 0.5, height * 0.28, length * 0.1);
    const sight = new THREE.Mesh(sightGeo, accentMaterial);
    sight.position.set(0, height * 0.45, -length * 0.05);
    body.add(sight);

    // Glowing front post: gives the ADS view something to line up.
    const postGeo = new THREE.BoxGeometry(width * 0.12, height * 0.2, width * 0.12);
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0x9fe8ff,
      emissive: new THREE.Color(0x49c7ee),
      emissiveIntensity: 2.2,
      roughness: 0.3,
    });
    const post = new THREE.Mesh(postGeo, postMaterial);
    post.position.set(0, height * 0.42, -length * 0.82);
    body.add(post);

    this.disposables.push(receiverGeo, barrelGeo, gripGeo, magGeo, sightGeo, postGeo, postMaterial);

    this.model.add(body);
    this.muzzlePoint.position.set(0, height * 0.1, -length * 0.98);
    this.ejectPoint.position.set(width * 0.6, height * 0.15, -length * 0.1);

    this.hipPosition.set(...def.visual.hipPosition);
    this.aimPosition.set(...def.visual.aimPosition);
    this.holder.position.copy(this.hipPosition);

    this.equipDurationSec = def.equipMs / 1000;
    this.equipProgress = 0;
    this.reloadProgress = 0;
  }

  setAiming(aiming: boolean): void {
    this.aimTarget = aiming ? 1 : 0;
  }

  get aimAmount(): number {
    return this.aimBlend;
  }

  startReload(durationMs: number): void {
    this.reloadDurationSec = durationMs / 1000;
    this.reloadProgress = 0.0001;
  }

  get isReloading(): boolean {
    return this.reloadProgress > 0 && this.reloadProgress < 1;
  }

  /** Kick the model backwards; `strength` comes from the weapon recoil profile. */
  kick(strength: number): void {
    this.recoilOffset = Math.min(this.recoilOffset + strength, 0.22);
    this.recoilPitch = Math.min(this.recoilPitch + strength * 3.2, 0.6);
  }

  /** Mouse movement drives a lagging sway; called with the frame's aim delta. */
  addAimDelta(yawDelta: number, pitchDelta: number): void {
    this.swayTarget.x = clamp(this.swayTarget.x + yawDelta * 0.6, -0.06, 0.06);
    this.swayTarget.y = clamp(this.swayTarget.y + pitchDelta * 0.6, -0.05, 0.05);
  }

  update(dt: number, speedRatio: number, grounded: boolean, crouching: boolean): void {
    if (!this.def) return;

    this.aimBlend = lerp(
      this.aimBlend,
      this.aimTarget,
      1 - Math.exp(-(1000 / Math.max(60, this.def.aimTimeMs)) * dt * 3.2),
    );

    // Sway decays toward zero; the target itself decays so flicks feel snappy.
    this.swayTarget.multiplyScalar(Math.exp(-7 * dt));
    this.swayOffset.x = lerp(this.swayOffset.x, this.swayTarget.x, 1 - Math.exp(-12 * dt));
    this.swayOffset.y = lerp(this.swayOffset.y, this.swayTarget.y, 1 - Math.exp(-12 * dt));

    this.recoilOffset = lerp(this.recoilOffset, 0, 1 - Math.exp(-14 * dt));
    this.recoilPitch = lerp(this.recoilPitch, 0, 1 - Math.exp(-12 * dt));

    this.equipProgress = Math.min(1, this.equipProgress + dt / Math.max(0.05, this.equipDurationSec));

    if (this.reloadProgress > 0 && this.reloadProgress < 1) {
      this.reloadProgress = Math.min(
        1,
        this.reloadProgress + dt / Math.max(0.1, this.reloadDurationSec),
      );
    }

    // Weapon bob, damped hard while aiming so sights stay usable.
    const bobScale = (1 - this.aimBlend * 0.85) * (grounded ? 1 : 0.25);
    this.bobPhase += dt * (7 + speedRatio * 5);
    const bobX = Math.sin(this.bobPhase) * 0.012 * speedRatio * bobScale;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.01 * speedRatio * bobScale;

    // Position: blend hip -> aim, then layer bob, sway, recoil and animations.
    const target = this.holder.position;
    target.x = lerp(this.hipPosition.x, this.aimPosition.x, this.aimBlend) + bobX + this.swayOffset.x;
    target.y =
      lerp(this.hipPosition.y, this.aimPosition.y, this.aimBlend) -
      bobY +
      this.swayOffset.y -
      (crouching ? 0.015 : 0);
    target.z = lerp(this.hipPosition.z, this.aimPosition.z, this.aimBlend) + this.recoilOffset;

    // Raise animation on equip.
    const equipEase = 1 - (1 - this.equipProgress) ** 3;
    target.y -= (1 - equipEase) * 0.32;
    this.holder.rotation.x = (1 - equipEase) * -0.5;
    this.holder.rotation.z = (1 - equipEase) * 0.35;

    // Reload animation: dip the weapon, swap the mag at the halfway point.
    if (this.reloadProgress > 0 && this.reloadProgress < 1) {
      const p = this.reloadProgress;
      const dip = Math.sin(p * Math.PI);
      target.y -= dip * 0.16;
      target.z += dip * 0.05;
      this.holder.rotation.x += dip * 0.55;
      this.holder.rotation.z += dip * 0.22;

      const magazine = this.model.getObjectByName('magazine');
      if (magazine) {
        // Magazine drops out in the first half, new one slides in during the second.
        const magPhase = p < 0.45 ? p / 0.45 : p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
        magazine.position.y = -this.def.visual.size[1] * 0.6 - magPhase * 0.14;
        magazine.visible = !(p > 0.45 && p < 0.6);
      }
    } else {
      const magazine = this.model.getObjectByName('magazine');
      if (magazine) {
        magazine.position.y = -this.def.visual.size[1] * 0.6;
        magazine.visible = true;
      }
    }

    this.recoilPivot.rotation.x = this.recoilPitch;
    this.model.rotation.y = this.swayOffset.x * 2.2;
  }

  /** World-space muzzle transform, used to place flashes and shell ejection. */
  muzzleTransform(out: { position: Vec3; direction: Vec3 }): void {
    this.muzzlePoint.getWorldPosition(this.worldPosition);
    this.muzzlePoint.getWorldDirection(this.worldDirection);
    out.position.x = this.worldPosition.x;
    out.position.y = this.worldPosition.y;
    out.position.z = this.worldPosition.z;
    out.direction.x = -this.worldDirection.x;
    out.direction.y = -this.worldDirection.y;
    out.direction.z = -this.worldDirection.z;
  }

  ejectTransform(out: { position: Vec3; right: Vec3; up: Vec3 }): void {
    this.ejectPoint.getWorldPosition(this.worldPosition);
    this.ejectPoint.matrixWorld.extractBasis(this.worldRight, this.worldUp, this.worldDirection);
    out.position.x = this.worldPosition.x;
    out.position.y = this.worldPosition.y;
    out.position.z = this.worldPosition.z;
    out.right.x = this.worldRight.x;
    out.right.y = this.worldRight.y;
    out.right.z = this.worldRight.z;
    out.up.x = this.worldUp.x;
    out.up.y = this.worldUp.y;
    out.up.z = this.worldUp.z;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  private disposeModel(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.model.clear();
    this.model.add(this.muzzlePoint);
    this.model.add(this.ejectPoint);
  }

  dispose(): void {
    this.disposeModel();
    this.root.clear();
  }
}

import * as THREE from 'three';
import { clamp, lerp } from '@ragelab/shared';
import { buildToolGunMesh } from './toolGunMesh';

/**
 * First-person Tool Gun overlay. Lives in the view-model scene so it never
 * clips the world. Hidden whenever a real weapon is equipped.
 */
export class ToolGunView {
  readonly root = new THREE.Group();

  private readonly holder = new THREE.Group();
  private readonly recoilPivot = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly hip = new THREE.Vector3(0.2, -0.18, -0.38);
  private readonly swayOffset = new THREE.Vector2();
  private readonly swayTarget = new THREE.Vector2();
  private readonly muzzleLight: THREE.PointLight;
  private readonly glowMat: THREE.MeshStandardMaterial | null;
  private readonly lcdMat: THREE.MeshStandardMaterial | null;
  private bobPhase = 0;
  private idlePhase = 0;
  private recoil = 0;
  private equip = 1;
  private flash = 0;

  constructor() {
    this.root.name = 'toolGunView';
    this.root.visible = false;
    this.root.add(this.holder);
    this.holder.add(this.recoilPivot);
    this.recoilPivot.add(buildToolGunMesh(this.disposables));
    this.holder.position.copy(this.hip);

    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 1.35, 2);
    this.muzzleLight.position.set(0, 0.02, -0.2);
    this.recoilPivot.add(this.muzzleLight);

    const glow = this.recoilPivot.getObjectByName('muzzleGlow') as THREE.Mesh | undefined;
    this.glowMat = glow?.material instanceof THREE.MeshStandardMaterial ? glow.material : null;
    const lcd = this.recoilPivot.getObjectByName('toolGunLcd') as THREE.Mesh | undefined;
    this.lcdMat = lcd?.material instanceof THREE.MeshStandardMaterial ? lcd.material : null;
  }

  setVisible(visible: boolean): void {
    if (visible && !this.root.visible) this.equip = 0;
    this.root.visible = visible;
    if (!visible) {
      this.flash = 0;
      this.muzzleLight.intensity = 0;
    }
  }

  get visible(): boolean {
    return this.root.visible;
  }

  kick(): void {
    this.recoil = Math.min(this.recoil + 0.05, 0.13);
    this.flash = 1;
  }

  addAimDelta(yawDelta: number, pitchDelta: number): void {
    this.swayTarget.x = clamp(this.swayTarget.x + yawDelta * 0.6, -0.06, 0.06);
    this.swayTarget.y = clamp(this.swayTarget.y + pitchDelta * 0.6, -0.05, 0.05);
  }

  update(dt: number, speedRatio: number, grounded: boolean, crouching: boolean): void {
    if (!this.root.visible) return;
    this.equip = lerp(this.equip, 1, 1 - Math.exp(-11 * dt));
    this.swayTarget.multiplyScalar(Math.exp(-7 * dt));
    this.swayOffset.x = lerp(this.swayOffset.x, this.swayTarget.x, 1 - Math.exp(-12 * dt));
    this.swayOffset.y = lerp(this.swayOffset.y, this.swayTarget.y, 1 - Math.exp(-12 * dt));
    this.recoil = lerp(this.recoil, 0, 1 - Math.exp(-9 * dt));
    this.flash = lerp(this.flash, 0, 1 - Math.exp(-13 * dt));
    this.idlePhase += dt * 1.35;
    if (grounded && speedRatio > 0.12) this.bobPhase += dt * (6 + speedRatio * 8);
    const walk = Math.sin(this.bobPhase) * 0.012 * Math.min(1, speedRatio);
    const idleY = Math.sin(this.idlePhase) * 0.007;
    const idleX = Math.sin(this.idlePhase * 0.62) * 0.004;
    const raise = (1 - this.equip) * 0.24;
    this.holder.position.set(
      this.hip.x + this.swayOffset.x + idleX + (crouching ? 0.01 : 0),
      this.hip.y + this.swayOffset.y + walk + idleY - raise - (crouching ? 0.015 : 0),
      this.hip.z + this.recoil,
    );
    this.holder.rotation.set(
      -this.swayOffset.y * 0.4 + this.recoil * 0.85 + (1 - this.equip) * 0.35,
      this.swayOffset.x * 0.5,
      idleX * 2.2,
    );
    this.muzzleLight.intensity = this.flash * 2.6;
    if (this.glowMat) this.glowMat.emissiveIntensity = 1.05 + this.flash * 3.4;
    if (this.lcdMat) this.lcdMat.emissiveIntensity = 0.75 + 0.22 * Math.sin(this.idlePhase * 2.1) + this.flash * 0.8;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.muzzleLight.dispose();
    this.root.clear();
  }
}

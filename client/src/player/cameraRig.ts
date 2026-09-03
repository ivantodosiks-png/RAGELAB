import * as THREE from 'three';
import { EYE_HEIGHT_CROUCH, EYE_HEIGHT_STAND, clamp, lerp } from '@ragelab/shared';

export interface CameraShake {
  /** Remaining intensity 0..1. */
  amount: number;
  frequency: number;
}

/**
 * Everything that makes the camera feel good: eye height easing, head bob,
 * landing dip, recoil punch, ADS field of view and screen shake. Kept apart
 * from the simulation so none of it can affect gameplay.
 */
export class CameraRig {
  private eyeHeight = EYE_HEIGHT_STAND;
  private bobPhase = 0;
  private bobAmount = 0;
  private landingDip = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private punch = 0;
  private shake: CameraShake = { amount: 0, frequency: 22 };
  private currentFovMultiplier = 1;
  private targetFovMultiplier = 1;
  private rollAngle = 0;

  private baseFov: number;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly viewModelCamera: THREE.PerspectiveCamera,
    baseFov: number,
  ) {
    this.baseFov = baseFov;
  }

  setBaseFov(fov: number): void {
    this.baseFov = fov;
  }

  /** Weapon recoil kick; the aim itself is corrected by the input controller. */
  addRecoil(pitch: number, yaw: number, punch: number): void {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
    this.punch = Math.min(this.punch + punch, 3.5);
  }

  addShake(amount: number, frequency = 22): void {
    this.shake.amount = Math.min(1.4, this.shake.amount + amount);
    this.shake.frequency = frequency;
  }

  onLanded(speed: number): void {
    this.landingDip = Math.min(0.22, speed * 0.012);
  }

  setAimFov(multiplier: number): void {
    this.targetFovMultiplier = multiplier;
  }

  /**
   * @param position feet position of the local player
   * @param speedRatio horizontal speed / walk speed, drives head bob
   */
  update(
    dt: number,
    position: THREE.Vector3,
    yaw: number,
    pitch: number,
    crouching: boolean,
    grounded: boolean,
    speedRatio: number,
    strafeRatio: number,
  ): void {
    const targetEye = crouching ? EYE_HEIGHT_CROUCH : EYE_HEIGHT_STAND;
    this.eyeHeight = lerp(this.eyeHeight, targetEye, 1 - Math.exp(-14 * dt));

    // Head bob: phase advances with distance travelled, amplitude with speed.
    const targetBob = grounded ? clamp(speedRatio, 0, 1.5) : 0;
    this.bobAmount = lerp(this.bobAmount, targetBob, 1 - Math.exp(-9 * dt));
    this.bobPhase += dt * (7.2 + speedRatio * 4.2);
    const bobVertical = Math.sin(this.bobPhase * 2) * 0.022 * this.bobAmount;
    const bobHorizontal = Math.sin(this.bobPhase) * 0.026 * this.bobAmount;

    this.landingDip = lerp(this.landingDip, 0, 1 - Math.exp(-11 * dt));
    this.punch = lerp(this.punch, 0, 1 - Math.exp(-13 * dt));
    this.recoilPitch = lerp(this.recoilPitch, 0, 1 - Math.exp(-9 * dt));
    this.recoilYaw = lerp(this.recoilYaw, 0, 1 - Math.exp(-9 * dt));
    this.shake.amount = Math.max(0, this.shake.amount - dt * 2.4);

    // Slight camera roll when strafing sells the movement.
    this.rollAngle = lerp(this.rollAngle, -strafeRatio * 0.028, 1 - Math.exp(-8 * dt));

    const shakeX =
      this.shake.amount > 0
        ? Math.sin(this.bobPhase * this.shake.frequency) * this.shake.amount * 0.03
        : 0;
    const shakeY =
      this.shake.amount > 0
        ? Math.cos(this.bobPhase * this.shake.frequency * 1.3) * this.shake.amount * 0.03
        : 0;

    this.camera.position.set(
      position.x + bobHorizontal + shakeX,
      position.y + this.eyeHeight + bobVertical - this.landingDip - this.punch * 0.02,
      position.z + shakeY,
    );

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = yaw + this.recoilYaw;
    this.camera.rotation.x = pitch + this.recoilPitch - this.punch * 0.012;
    this.camera.rotation.z = this.rollAngle;

    this.currentFovMultiplier = lerp(
      this.currentFovMultiplier,
      this.targetFovMultiplier,
      1 - Math.exp(-12 * dt),
    );
    const fov = this.baseFov * this.currentFovMultiplier;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // Overlay camera stays identity at the origin so hip/aim offsets are in
    // camera space. World-space muzzle points are derived from the gameplay
    // camera's matrix, not this one.
    this.viewModelCamera.position.set(0, 0, 0);
    this.viewModelCamera.rotation.set(0, 0, 0);
  }

  get bob(): number {
    return this.bobPhase;
  }

  get fovMultiplier(): number {
    return this.currentFovMultiplier;
  }

  reset(): void {
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.punch = 0;
    this.landingDip = 0;
    this.shake.amount = 0;
    this.bobAmount = 0;
    this.currentFovMultiplier = 1;
    this.targetFovMultiplier = 1;
  }
}

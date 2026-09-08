import * as THREE from 'three';
import {
  DEFAULT_BODYCAM,
  EYE_HEIGHT_CROUCH,
  EYE_HEIGHT_STAND,
  SPEED_WALK,
  clamp,
  lerp,
  type BodycamSettings,
} from '@ragelab/shared';

export interface CameraShake {
  /** Remaining intensity 0..1. */
  amount: number;
  frequency: number;
}

/**
 * Gameplay camera: classic eye-level FPS, or chest-mounted bodycam when enabled.
 * Motion layers (bob / lag / landing / impact) stack; nothing here affects sim.
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

  private bodycam: BodycamSettings = { ...DEFAULT_BODYCAM, enabled: false };
  private laggedYaw = 0;
  private laggedPitch = 0;
  private lagSeeded = false;
  private settleNoise = 0;
  private lastYaw = 0;
  private lastPitch = 0;

  /** Angular velocity (rad/s) for motion blur post. */
  yawVelocity = 0;
  pitchVelocity = 0;

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

  setBodycam(settings: BodycamSettings): void {
    this.bodycam = { ...DEFAULT_BODYCAM, ...settings };
  }

  /** Weapon recoil kick; the aim itself is corrected by the input controller. */
  addRecoil(pitch: number, yaw: number, punch: number): void {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
    this.punch = Math.min(this.punch + punch, 3.5);
  }

  addShake(amount: number, frequency = 22): void {
    const scale = this.bodycam.enabled ? this.bodycam.shakeIntensity : 1;
    this.shake.amount = Math.min(1.4, this.shake.amount + amount * scale);
    this.shake.frequency = frequency;
  }

  onLanded(speed: number): void {
    const landBoost = this.bodycam.enabled ? 1.35 * this.bodycam.shakeIntensity : 1;
    this.landingDip = Math.min(0.28, speed * 0.012 * landBoost);
    if (this.bodycam.enabled && speed > 4) {
      this.addShake(0.22 + Math.min(0.35, speed * 0.02), 18);
    }
  }

  setAimFov(multiplier: number): void {
    this.targetFovMultiplier = multiplier;
  }

  /**
   * @param position feet position of the local player
   * @param speedRatio horizontal speed / walk speed
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
    const bc = this.bodycam;
    const bodyOn = bc.enabled;

    if (!this.lagSeeded) {
      this.laggedYaw = yaw;
      this.laggedPitch = pitch;
      this.lastYaw = yaw;
      this.lastPitch = pitch;
      this.lagSeeded = true;
    }

    const invDt = dt > 1e-4 ? 1 / dt : 0;
    this.yawVelocity = (yaw - this.lastYaw) * invDt;
    this.pitchVelocity = (pitch - this.lastPitch) * invDt;
    this.lastYaw = yaw;
    this.lastPitch = pitch;

    // Rotational lag (bodycam vest inertia) — not classic FPS snap.
    if (bodyOn) {
      const lag = clamp(bc.cameraLag, 0, 1);
      const follow = 1 - Math.exp(-(4.5 + (1 - lag) * 14) * dt);
      this.laggedYaw = lerpAngle(this.laggedYaw, yaw, follow);
      this.laggedPitch = lerp(this.laggedPitch, pitch, follow);
    } else {
      this.laggedYaw = yaw;
      this.laggedPitch = pitch;
    }

    const standH = bodyOn ? EYE_HEIGHT_STAND * bc.chestHeight : EYE_HEIGHT_STAND;
    const crouchH = bodyOn ? EYE_HEIGHT_CROUCH * 0.92 : EYE_HEIGHT_CROUCH;
    const targetEye = crouching ? crouchH : standH;
    this.eyeHeight = lerp(this.eyeHeight, targetEye, 1 - Math.exp(-12 * dt));

    // Body-mounted bob: lower frequency, dual-axis vest sway (not head-bob FPS).
    const runGate = clamp((speedRatio - 1.05) / 0.55, 0, 1);
    const walkGate = clamp(speedRatio, 0, 1) * (1 - runGate * 0.35);
    const bobStrength = bodyOn
      ? walkGate * bc.walkBob + runGate * bc.runBob
      : clamp(speedRatio, 0, 1.5);
    const targetBob = grounded ? bobStrength : 0;
    this.bobAmount = lerp(this.bobAmount, targetBob, 1 - Math.exp(-(bodyOn ? 6 : 9) * dt));
    const bobRate = bodyOn ? 5.1 + speedRatio * 3.4 : 7.2 + speedRatio * 4.2;
    this.bobPhase += dt * bobRate;

    let bobVertical: number;
    let bobHorizontal: number;
    let bobRoll: number;
    if (bodyOn) {
      // Step-driven vertical + lateral sway; residual settle when almost still.
      this.settleNoise = lerp(
        this.settleNoise,
        grounded && speedRatio < 0.12 ? 0.35 : 0,
        1 - Math.exp(-3 * dt),
      );
      const amp = 0.018 + runGate * 0.022;
      bobVertical =
        Math.sin(this.bobPhase * 2) * amp * this.bobAmount +
        Math.sin(this.bobPhase * 0.37) * 0.004 * this.settleNoise;
      bobHorizontal =
        Math.sin(this.bobPhase) * (0.02 + runGate * 0.018) * this.bobAmount +
        Math.sin(this.bobPhase * 0.23) * 0.003 * this.settleNoise;
      bobRoll = Math.sin(this.bobPhase * 0.5) * 0.012 * this.bobAmount;
    } else {
      bobVertical = Math.sin(this.bobPhase * 2) * 0.022 * this.bobAmount;
      bobHorizontal = Math.sin(this.bobPhase) * 0.026 * this.bobAmount;
      bobRoll = 0;
    }

    this.landingDip = lerp(this.landingDip, 0, 1 - Math.exp(-11 * dt));
    this.punch = lerp(this.punch, 0, 1 - Math.exp(-13 * dt));
    this.recoilPitch = lerp(this.recoilPitch, 0, 1 - Math.exp(-9 * dt));
    this.recoilYaw = lerp(this.recoilYaw, 0, 1 - Math.exp(-9 * dt));
    this.shake.amount = Math.max(0, this.shake.amount - dt * 2.4);

    const strafeRoll = bodyOn ? -strafeRatio * 0.04 : -strafeRatio * 0.028;
    this.rollAngle = lerp(this.rollAngle, strafeRoll + bobRoll, 1 - Math.exp(-7 * dt));

    const shakeX =
      this.shake.amount > 0
        ? Math.sin(this.bobPhase * this.shake.frequency) * this.shake.amount * (bodyOn ? 0.038 : 0.03)
        : 0;
    const shakeY =
      this.shake.amount > 0
        ? Math.cos(this.bobPhase * this.shake.frequency * 1.3) * this.shake.amount * (bodyOn ? 0.038 : 0.03)
        : 0;

    const lookYaw = bodyOn ? this.laggedYaw : yaw;
    const lookPitch = bodyOn ? this.laggedPitch + bc.pitchBias : pitch;

    // Chest mount: offset forward along look, slight right bias (typical chest cam).
    let ox = bobHorizontal + shakeX;
    let oy = this.eyeHeight + bobVertical - this.landingDip - this.punch * 0.02;
    let oz = shakeY;
    if (bodyOn) {
      const cy = Math.cos(lookYaw);
      const sy = Math.sin(lookYaw);
      const forward = bc.forwardOffset;
      const side = 0.04;
      ox += sy * forward + cy * side;
      oz += cy * forward - sy * side;
    }

    this.camera.position.set(position.x + ox, position.y + oy, position.z + oz);

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = lookYaw + this.recoilYaw;
    this.camera.rotation.x = lookPitch + this.recoilPitch - this.punch * 0.012;
    this.camera.rotation.z = this.rollAngle;

    this.currentFovMultiplier = lerp(
      this.currentFovMultiplier,
      this.targetFovMultiplier,
      1 - Math.exp(-12 * dt),
    );
    const fovBoost = bodyOn ? bc.fovBoost : 0;
    // ADS still narrows FOV; bodycam wide angle is the baseline.
    const fov = (this.baseFov + fovBoost) * this.currentFovMultiplier;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.viewModelCamera.position.set(0, 0, 0);
    this.viewModelCamera.rotation.set(0, 0, 0);
  }

  get bob(): number {
    return this.bobPhase;
  }

  get fovMultiplier(): number {
    return this.currentFovMultiplier;
  }

  /** Horizontal speed ratio helper for callers. */
  static speedRatio(speed: number): number {
    return speed / SPEED_WALK;
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
    this.lagSeeded = false;
    this.settleNoise = 0;
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

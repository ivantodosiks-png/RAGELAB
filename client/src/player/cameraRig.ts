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
 * Mouse look is always instant (yaw/pitch applied directly — no lag/smoothing).
 * Bodycam adds vest inertia, step kick, and turn sway on position/roll only.
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
  private settleNoise = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private aimSeeded = false;

  /** Smoothed vest offsets — lag slightly behind step impulses. */
  private vestX = 0;
  private vestY = 0;
  private vestZ = 0;
  private turnRoll = 0;
  private pitchBob = 0;
  private stepKick = 0;
  private prevStep = 0;
  private idlePhase = 0;

  private bodycam: BodycamSettings = { ...DEFAULT_BODYCAM, enabled: false };

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
    this.shake.amount = Math.min(1.2, this.shake.amount + amount * scale);
    this.shake.frequency = frequency;
  }

  onLanded(speed: number): void {
    const landBoost = this.bodycam.enabled ? 1.2 * this.bodycam.shakeIntensity : 1;
    this.landingDip = Math.min(0.22, speed * 0.01 * landBoost);
    if (this.bodycam.enabled && speed > 5) {
      this.addShake(0.14 + Math.min(0.24, speed * 0.015), 15);
      this.stepKick = Math.min(0.04, this.stepKick + 0.018);
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

    if (!this.aimSeeded) {
      this.lastYaw = yaw;
      this.lastPitch = pitch;
      this.aimSeeded = true;
    }

    const invDt = dt > 1e-4 ? 1 / dt : 0;
    let dyaw = yaw - this.lastYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.yawVelocity = dyaw * invDt;
    this.pitchVelocity = (pitch - this.lastPitch) * invDt;
    this.lastYaw = yaw;
    this.lastPitch = pitch;

    // Instant look: mouse → camera rotation with no lag / interpolation.
    const lookYaw = yaw;
    const lookPitch = bodyOn ? pitch + bc.pitchBias : pitch;

    const standH = bodyOn ? EYE_HEIGHT_STAND * bc.chestHeight : EYE_HEIGHT_STAND;
    const crouchH = bodyOn ? EYE_HEIGHT_CROUCH * 0.94 : EYE_HEIGHT_CROUCH;
    const targetEye = crouching ? crouchH : standH;
    this.eyeHeight = lerp(this.eyeHeight, targetEye, 1 - Math.exp(-14 * dt));

    const runGate = clamp((speedRatio - 1.05) / 0.55, 0, 1);
    const walkGate = clamp(speedRatio, 0, 1) * (1 - runGate * 0.35);
    const bobStrength = bodyOn
      ? walkGate * bc.walkBob + runGate * bc.runBob
      : clamp(speedRatio, 0, 1.5);
    const targetBob = grounded ? bobStrength : 0;
    this.bobAmount = lerp(this.bobAmount, targetBob, 1 - Math.exp(-(bodyOn ? 6.5 : 9) * dt));
    const bobRate = bodyOn ? 4.2 + speedRatio * 2.6 : 7.2 + speedRatio * 4.2;
    this.bobPhase += dt * bobRate;
    this.idlePhase += dt;

    let bobVertical: number;
    let bobHorizontal: number;
    let bobForward: number;
    let bobRoll: number;
    if (bodyOn) {
      this.settleNoise = lerp(
        this.settleNoise,
        grounded && speedRatio < 0.12 ? 0.55 : 0,
        1 - Math.exp(-2.2 * dt),
      );
      const amp = 0.014 + runGate * 0.022;
      // Primary step + secondary harmonics (vest flex).
      bobVertical =
        Math.sin(this.bobPhase * 2) * amp * this.bobAmount +
        Math.sin(this.bobPhase * 4.1) * 0.0045 * runGate * this.bobAmount +
        Math.sin(this.idlePhase * 1.7) * 0.0028 * this.settleNoise +
        Math.sin(this.idlePhase * 0.63) * 0.0016 * this.settleNoise;
      bobHorizontal =
        Math.sin(this.bobPhase) * (0.016 + runGate * 0.016) * this.bobAmount +
        Math.sin(this.bobPhase * 0.5) * 0.004 * this.bobAmount +
        Math.sin(this.idlePhase * 0.9) * 0.002 * this.settleNoise;
      bobForward =
        Math.cos(this.bobPhase * 2) * (0.006 + runGate * 0.01) * this.bobAmount +
        Math.sin(this.idlePhase * 1.1) * 0.0012 * this.settleNoise;
      bobRoll =
        Math.sin(this.bobPhase * 0.5) * 0.014 * this.bobAmount +
        runGate * 0.006 * this.bobAmount;

      // Footfall micro-kick when the vertical bob crosses.
      const step = Math.sin(this.bobPhase * 2);
      if (
        grounded &&
        this.bobAmount > 0.25 &&
        this.prevStep < 0 &&
        step >= 0
      ) {
        this.stepKick = Math.min(
          0.035,
          this.stepKick + 0.01 + runGate * 0.012 * bc.shakeIntensity,
        );
      }
      this.prevStep = step;
    } else {
      bobVertical = Math.sin(this.bobPhase * 2) * 0.022 * this.bobAmount;
      bobHorizontal = Math.sin(this.bobPhase) * 0.026 * this.bobAmount;
      bobForward = 0;
      bobRoll = 0;
      this.prevStep = 0;
    }

    this.landingDip = lerp(this.landingDip, 0, 1 - Math.exp(-11 * dt));
    this.punch = lerp(this.punch, 0, 1 - Math.exp(-13 * dt));
    this.recoilPitch = lerp(this.recoilPitch, 0, 1 - Math.exp(-9 * dt));
    this.recoilYaw = lerp(this.recoilYaw, 0, 1 - Math.exp(-9 * dt));
    this.shake.amount = Math.max(0, this.shake.amount - dt * 2.6);
    this.stepKick = lerp(this.stepKick, 0, 1 - Math.exp(-9 * dt));

    // Vest inertia: position follows step targets with a soft lag (not look lag).
    const vestFollow = bodyOn ? 7.2 : 20;
    this.vestX = lerp(this.vestX, bobHorizontal, 1 - Math.exp(-vestFollow * dt));
    this.vestY = lerp(
      this.vestY,
      bobVertical - this.stepKick,
      1 - Math.exp(-(vestFollow * 0.95) * dt),
    );
    this.vestZ = lerp(this.vestZ, bobForward, 1 - Math.exp(-(vestFollow * 0.85) * dt));

    // Turn sway — chest twists slightly against yaw velocity.
    const wantTurnRoll = bodyOn
      ? clamp(-this.yawVelocity * 0.02, -0.055, 0.055) +
        clamp(-strafeRatio * 0.032, -0.04, 0.04)
      : -strafeRatio * 0.028;
    this.turnRoll = lerp(this.turnRoll, wantTurnRoll, 1 - Math.exp(-(bodyOn ? 5.5 : 8) * dt));
    this.rollAngle = lerp(
      this.rollAngle,
      this.turnRoll + bobRoll * (bodyOn ? 0.85 : 0),
      1 - Math.exp(-8 * dt),
    );

    // Pitch responds to vertical vest travel (camera bolted to torso).
    const wantPitchBob = bodyOn ? -this.vestY * 0.55 - this.stepKick * 0.8 : 0;
    this.pitchBob = lerp(this.pitchBob, wantPitchBob, 1 - Math.exp(-7 * dt));

    const shakeScale = bodyOn ? 0.03 : 0.03;
    const shakeX =
      this.shake.amount > 0
        ? Math.sin(this.bobPhase * this.shake.frequency) * this.shake.amount * shakeScale
        : 0;
    const shakeY =
      this.shake.amount > 0
        ? Math.cos(this.bobPhase * this.shake.frequency * 1.3) * this.shake.amount * shakeScale
        : 0;

    let ox: number;
    let oz: number;
    const oy =
      this.eyeHeight +
      (bodyOn ? this.vestY : bobVertical) -
      this.landingDip -
      this.punch * 0.02;

    if (bodyOn) {
      const cy = Math.cos(lookYaw);
      const sy = Math.sin(lookYaw);
      const forward = bc.forwardOffset + this.vestZ;
      const side = 0.028 + this.vestX;
      ox = sy * forward + cy * side + shakeX;
      oz = cy * forward - sy * side + shakeY;
    } else {
      ox = bobHorizontal + shakeX;
      oz = shakeY;
    }

    this.camera.position.set(position.x + ox, position.y + oy, position.z + oz);

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = lookYaw + this.recoilYaw;
    this.camera.rotation.x =
      lookPitch + this.recoilPitch - this.punch * 0.012 + this.pitchBob;
    this.camera.rotation.z = this.rollAngle;

    this.currentFovMultiplier = lerp(
      this.currentFovMultiplier,
      this.targetFovMultiplier,
      1 - Math.exp(-12 * dt),
    );
    const fovBoost = bodyOn ? bc.fovBoost : 0;
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
    this.aimSeeded = false;
    this.settleNoise = 0;
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
    this.rollAngle = 0;
    this.vestX = 0;
    this.vestY = 0;
    this.vestZ = 0;
    this.turnRoll = 0;
    this.pitchBob = 0;
    this.stepKick = 0;
    this.prevStep = 0;
    this.idlePhase = 0;
  }
}

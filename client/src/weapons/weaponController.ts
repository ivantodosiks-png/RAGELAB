import * as THREE from 'three';
import {
  Button,
  FireDenyReason,
  buttonDown,
  buttonPressed,
  canReload,
  clamp,
  completeReload,
  createWeaponState,
  decaySpread,
  effectiveSpread,
  getWeapon,
  reloadDurationMs,
  bloomSpread,
  type Vec3,
  type WeaponDefinition,
  type WeaponId,
  type WeaponRuntimeState,
} from '@ragelab/shared';
import { WeaponViewModel } from './viewModel';
import type { EffectsManager } from '../effects/effectsManager';
import type { AudioEngine } from '../audio/audioEngine';
import type { CameraRig } from '../player/cameraRig';
import type { InputController } from '../player/inputController';
import type { SoundKey } from '../audio/synth';

const muzzle = { position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 } };
const eject = {
  position: { x: 0, y: 0, z: 0 },
  right: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 0, z: 0 },
};

export interface WeaponFrameContext {
  buttons: number;
  previousButtons: number;
  nowMs: number;
  speedRatio: number;
  grounded: boolean;
  crouching: boolean;
  alive: boolean;
  carrying: boolean;
  cameraPosition: THREE.Vector3;
}

/**
 * Client-side weapon prediction.
 *
 * The server remains the only authority on whether a shot happened and what it
 * hit. This class exists so the *feel* is instant: the flash, sound, recoil and
 * ammo counter respond on the same frame the trigger is pulled, and are then
 * corrected by the authoritative ammo values in each snapshot.
 */
export class WeaponController {
  readonly viewModel = new WeaponViewModel();

  private def: WeaponDefinition;
  private state: WeaponRuntimeState;
  private currentId: WeaponId;

  /** Server ammo from the last snapshot, used to reconcile the prediction. */
  private serverMag = 0;
  private serverReserve = 0;

  private lastFireAt = -1e9;
  private lastDryFireAt = -1e9;

  /** Set for the frame a predicted shot actually fired. */
  didFire = false;
  /** Sandbox tools steal the trigger so we do not shoot while placing NPCs. */
  blockFire = false;
  /** Tool Gun uses RMB for the spawn menu instead of ADS. */
  blockAim = false;
  /** Hide the firearm view-model while the Tool Gun is equipped. */
  hideViewModel = false;

  private readonly worldPos = new THREE.Vector3();
  private readonly worldDir = new THREE.Vector3();

  constructor(
    weaponId: WeaponId,
    private readonly effects: EffectsManager,
    private readonly audio: AudioEngine,
    private readonly camera: CameraRig,
    private readonly input: InputController,
    private readonly worldCamera: THREE.Camera,
  ) {
    this.currentId = weaponId;
    this.def = getWeapon(weaponId);
    this.state = createWeaponState(this.def, 0);
    this.viewModel.equip(this.def);
  }

  get weaponId(): WeaponId {
    return this.currentId;
  }

  get definition(): WeaponDefinition {
    return this.def;
  }

  get ammoInMag(): number {
    return this.state.ammoInMag;
  }

  get ammoReserve(): number {
    return this.state.ammoReserve;
  }

  get reloading(): boolean {
    return this.viewModel.isReloading;
  }

  get aiming(): boolean {
    return this.viewModel.aimAmount > 0.5;
  }

  get aimBlend(): number {
    return this.viewModel.aimAmount;
  }

  /** Current cone half-angle, used to size the dynamic crosshair. */
  spreadRadians(ctx: { moving: boolean; speedRatio: number; airborne: boolean; crouching: boolean }): number {
    return effectiveSpread(this.state, this.def, {
      moving: ctx.moving,
      speedRatio: ctx.speedRatio,
      airborne: ctx.airborne,
      aiming: this.aiming,
      crouching: ctx.crouching,
    });
  }

  equip(weaponId: WeaponId, nowMs: number): void {
    if (weaponId === this.currentId) return;
    this.currentId = weaponId;
    this.def = getWeapon(weaponId);
    // Preserve nothing but the ammo the server tells us about; the snapshot
    // will correct these within one round trip anyway.
    this.state = createWeaponState(this.def, nowMs);
    this.state.ammoInMag = this.serverMag || this.def.magazineSize;
    this.state.ammoReserve = this.serverReserve || this.def.reserveAmmo;
    this.viewModel.equip(this.def);
    this.audio.play('equip', { volume: 0.5 });
  }

  /** Fold authoritative ammo back into the prediction. */
  syncFromServer(mag: number, reserve: number, nowMs: number): void {
    this.serverMag = mag;
    this.serverReserve = reserve;
    // Only accept the server value when we are not mid-reload and have not
    // fired since the snapshot was generated; otherwise the counter flickers.
    if (this.viewModel.isReloading) return;
    if (nowMs - this.lastFireAt < 220) return;
    this.state.ammoInMag = mag;
    this.state.ammoReserve = reserve;
  }

  /** Server told us a reload started (authoritative timing). */
  onServerReload(durationMs: number, nowMs: number): void {
    this.state.reloadEndsAt = nowMs + durationMs;
    this.viewModel.startReload(durationMs);
    this.audio.play(this.def.audio.reload as SoundKey, { volume: 0.55 });
  }

  update(dt: number, ctx: WeaponFrameContext): void {
    this.didFire = false;
    const nowMs = ctx.nowMs;
    decaySpread(this.state, this.def, dt);

    if (this.state.reloadEndsAt > 0 && nowMs >= this.state.reloadEndsAt) {
      completeReload(this.state, this.def);
      this.state.reloadEndsAt = 0;
    }

    const aiming = !this.blockAim && buttonDown(ctx.buttons, Button.Aim) && ctx.alive && !ctx.carrying;
    this.viewModel.setAiming(aiming);
    this.camera.setAimFov(aiming ? this.def.aimFovMultiplier : 1);

    if (ctx.alive && !ctx.carrying && !this.blockFire) {
      this.handleReloadInput(ctx, nowMs);
      this.handleFireInput(ctx, nowMs);
    }

    this.viewModel.setVisible(ctx.alive && !ctx.carrying && !this.hideViewModel);
    this.viewModel.update(dt, ctx.speedRatio, ctx.grounded, ctx.crouching);
  }

  private handleReloadInput(ctx: WeaponFrameContext, nowMs: number): void {
    const pressed = buttonPressed(ctx.buttons, ctx.previousButtons, Button.Reload);
    if (!pressed) return;
    if (!canReload(this.state, this.def, nowMs)) return;
    const ms = reloadDurationMs(this.def, this.state.ammoInMag);
    this.state.reloadEndsAt = nowMs + ms;
    this.viewModel.startReload(ms);
    this.audio.play(this.def.audio.reload as SoundKey, { volume: 0.55 });
  }

  private handleFireInput(ctx: WeaponFrameContext, nowMs: number): void {
    const pressed = buttonPressed(ctx.buttons, ctx.previousButtons, Button.Fire);
    const held = buttonDown(ctx.buttons, Button.Fire);
    if (!pressed && !held) return;

    const verdict = evaluateLocalFire(this.state, this.def, nowMs, pressed, held);
    if (verdict !== FireDenyReason.Ok) {
      if (verdict === FireDenyReason.NoAmmo && pressed && nowMs - this.lastDryFireAt > 220) {
        this.lastDryFireAt = nowMs;
        this.audio.play('dryfire', { volume: 0.5 });
        // Mirror the server's auto-reload so the animation starts immediately.
        if (canReload(this.state, this.def, nowMs)) {
          const ms = reloadDurationMs(this.def, this.state.ammoInMag);
          this.state.reloadEndsAt = nowMs + ms;
          this.viewModel.startReload(ms);
          this.audio.play(this.def.audio.reload as SoundKey, { volume: 0.55 });
        }
      }
      return;
    }

    this.fire(ctx, nowMs);
  }

  private fire(ctx: WeaponFrameContext, nowMs: number): void {
    const def = this.def;
    this.state.lastShotAt = nowMs;
    this.state.ammoInMag = Math.max(0, this.state.ammoInMag - 1);
    this.state.shotCounter = (this.state.shotCounter + 1) >>> 0;
    bloomSpread(this.state, def);
    this.lastFireAt = nowMs;

    // Recoil is applied to the *aim*, not just the camera, so what the player
    // sees and what the server receives stay identical.
    const horizontal = (Math.random() * 2 - 1) * def.recoil.horizontal;
    this.input.setAim(
      this.input.yaw + horizontal,
      clamp(this.input.pitch + def.recoil.vertical, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01),
    );
    this.camera.addRecoil(def.recoil.vertical * 0.35, horizontal * 0.4, def.recoil.cameraPunch);
    this.viewModel.kick(def.recoil.viewKick);
    this.didFire = true;
    this.viewModel.triggerFlash(def.visual.muzzleFlashScale);
    this.viewModel.root.updateMatrixWorld(true);

    this.viewModel.muzzleTransform(muzzle);
    this.toWorld(muzzle.position, muzzle.position);
    this.toWorldDir(muzzle.direction, muzzle.direction);
    this.effects.muzzleFlash(muzzle.position, muzzle.direction, def);

    const recorded = def.id === 'rifle';
    this.audio.play(def.audio.fire as SoundKey, {
      volume: recorded ? 1.05 : 0.9,
      rate: def.audio.pitch,
      variation: recorded ? 0.014 : 0.035,
    });

    if (def.visual.shellEjection) {
      this.viewModel.ejectTransform(eject);
      this.toWorld(eject.position, eject.position);
      this.toWorldDir(eject.right, eject.right);
      this.toWorldDir(eject.up, eject.up);
      this.effects.shellEject(eject.position, eject.right, eject.up);
    }

    void ctx;
  }

  /** Muzzle position in world space, for the local player's tracer origin. */
  muzzleWorld(out: Vec3): void {
    this.viewModel.muzzleTransform(muzzle);
    this.toWorld(muzzle.position, out);
  }

  muzzleDirection(out: Vec3): void {
    this.viewModel.muzzleTransform(muzzle);
    this.toWorldDir(muzzle.direction, out);
  }

  private toWorld(local: Vec3, out: Vec3): void {
    this.worldCamera.updateMatrixWorld();
    this.worldPos.set(local.x, local.y, local.z);
    this.worldCamera.localToWorld(this.worldPos);
    out.x = this.worldPos.x;
    out.y = this.worldPos.y;
    out.z = this.worldPos.z;
  }

  private toWorldDir(local: Vec3, out: Vec3): void {
    this.worldCamera.updateMatrixWorld();
    this.worldDir.set(local.x, local.y, local.z);
    this.worldDir.transformDirection(this.worldCamera.matrixWorld);
    this.worldDir.normalize();
    out.x = this.worldDir.x;
    out.y = this.worldDir.y;
    out.z = this.worldDir.z;
  }

  dispose(): void {
    this.viewModel.dispose();
  }
}

/**
 * Same rules as the server, minus the anti-cheat grace window (the client has
 * no reason to be lenient with itself).
 */
function evaluateLocalFire(
  state: WeaponRuntimeState,
  def: WeaponDefinition,
  nowMs: number,
  pressed: boolean,
  held: boolean,
): number {
  if (state.reloadEndsAt > nowMs) return FireDenyReason.Reloading;
  if (state.equipEndsAt > nowMs) return FireDenyReason.Equipping;
  if (state.ammoInMag <= 0) return FireDenyReason.NoAmmo;
  const interval = 60_000 / def.rpm;
  if (nowMs - state.lastShotAt < interval) return FireDenyReason.Cooldown;
  if (def.fireMode === 'auto') return held ? FireDenyReason.Ok : FireDenyReason.TriggerHeld;
  return pressed ? FireDenyReason.Ok : FireDenyReason.TriggerHeld;
}

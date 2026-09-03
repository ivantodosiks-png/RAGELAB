import {
  ANTICHEAT_MAX_DT_MS,
  ANTICHEAT_MIN_DT_MS,
  MAX_PENDING_INPUTS,
  PlayerFlag,
  TICK_DT_MS,
  clamp,
  createMovementState,
  dqPos,
  dqVel,
  distance,
  getWeapon,
  stepMovement,
  weaponFromIndex,
  type InputCommand,
  type MovementState,
  type QuantPlayer,
  type StepEvents,
  type Vec3,
  type WeaponId,
} from '@ragelab/shared';
import type { ClientPhysicsWorld } from '../physics/clientWorld';

/** Beyond this positional error we hard-snap instead of easing. */
const HARD_SNAP_DISTANCE = 2.0;
/** Below this we accept the prediction as correct and skip the replay. */
const RECONCILE_TOLERANCE = 0.035;

interface PendingCommand {
  command: InputCommand;
  /** Predicted state *after* this command ran, used to measure server error. */
  x: number;
  y: number;
  z: number;
}

export interface LocalPlayerFrame {
  position: Vec3;
  velocity: Vec3;
  grounded: boolean;
  crouching: boolean;
  speed: number;
  /** Signed strafe contribution, drives camera roll. */
  strafe: number;
}

/**
 * The locally predicted player.
 *
 * Every frame we build one input command per fixed tick, run the *shared*
 * movement simulation immediately so the camera responds with zero latency,
 * and keep the command until the server acknowledges its sequence number.
 * When a snapshot arrives we rewind to the authoritative state and replay
 * every unacknowledged command through the same code the server ran.
 */
export class LocalPlayer {
  readonly movement: MovementState;
  readonly pending: PendingCommand[] = [];

  /** Visual position, eased toward the predicted position after a correction. */
  readonly renderPosition: Vec3 = { x: 0, y: 0, z: 0 };

  private nextSeq = 1;
  private accumulatorMs = 0;
  private readonly stepEvents: StepEvents = {
    jumped: false,
    landed: false,
    landingSpeed: 0,
    footstep: false,
  };

  /** Residual error being smoothed away after a reconciliation. */
  private readonly errorOffset: Vec3 = { x: 0, y: 0, z: 0 };

  /** Mirrors the authoritative values from the last snapshot. */
  health = 100;
  alive = true;
  weaponId: WeaponId = 'pistol';
  ammoInMag = 0;
  ammoReserve = 0;
  serverFlags = 0;
  carrying = false;

  /** Set by the frame loop for consumers that want simulation side effects. */
  jumpedThisFrame = false;
  landedThisFrame = false;
  landingSpeed = 0;
  footstepThisFrame = false;

  private lastAckSeq = 0;
  private corrections = 0;
  private lastErrorDistance = 0;

  constructor(
    private readonly physics: ClientPhysicsWorld,
    spawn: Vec3,
  ) {
    this.movement = createMovementState(spawn);
    this.renderPosition.x = spawn.x;
    this.renderPosition.y = spawn.y;
    this.renderPosition.z = spawn.z;
  }

  get correctionCount(): number {
    return this.corrections;
  }

  get lastError(): number {
    return this.lastErrorDistance;
  }

  /** Weapon speed multiplier must match the server's, so read the same table. */
  private speedMultiplier(): number {
    return getWeapon(this.weaponId).moveSpeedMultiplier;
  }

  /**
   * Advance prediction. Returns the commands produced this frame so the caller
   * can hand them to the network layer in one packet.
   */
  update(
    dtMs: number,
    sample: () => { moveX: number; moveZ: number; buttons: number; weaponSlot: number },
    yaw: number,
    pitch: number,
    out: InputCommand[],
  ): LocalPlayerFrame {
    out.length = 0;
    this.jumpedThisFrame = false;
    this.landedThisFrame = false;
    this.footstepThisFrame = false;
    this.landingSpeed = 0;

    this.accumulatorMs += dtMs;
    // Cap the catch-up so a background tab does not fire a hundred commands.
    if (this.accumulatorMs > 250) this.accumulatorMs = 250;

    const multiplier = this.speedMultiplier();

    while (this.accumulatorMs >= TICK_DT_MS) {
      this.accumulatorMs -= TICK_DT_MS;
      const axes = sample();
      const command: InputCommand = {
        seq: this.nextSeq++,
        dtMs: clamp(Math.round(TICK_DT_MS), ANTICHEAT_MIN_DT_MS, ANTICHEAT_MAX_DT_MS),
        moveX: axes.moveX,
        moveZ: axes.moveZ,
        yaw,
        pitch,
        buttons: axes.buttons,
        weaponSlot: axes.weaponSlot,
      };

      // Dead players still send input (so look direction stays live) but the
      // server ignores their movement, so predicting it would guarantee a
      // correction every snapshot.
      if (this.alive) {
        this.physics.refresh();
        stepMovement(this.movement, command, this.physics.character, multiplier, this.stepEvents);
        if (this.stepEvents.jumped) this.jumpedThisFrame = true;
        if (this.stepEvents.landed) {
          this.landedThisFrame = true;
          this.landingSpeed = Math.max(this.landingSpeed, this.stepEvents.landingSpeed);
        }
        if (this.stepEvents.footstep) this.footstepThisFrame = true;
      }

      this.pending.push({
        command,
        x: this.movement.position.x,
        y: this.movement.position.y,
        z: this.movement.position.z,
      });
      if (this.pending.length > MAX_PENDING_INPUTS) this.pending.shift();
      out.push(command);
    }

    this.decayError(dtMs / 1000);

    const velocity = this.movement.velocity;
    const speed = Math.hypot(velocity.x, velocity.z);
    // Project velocity onto the right vector for the camera roll.
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const strafe = speed > 0.01 ? (velocity.x * rightX + velocity.z * rightZ) / Math.max(speed, 1) : 0;

    return {
      position: this.renderPosition,
      velocity,
      grounded: this.movement.grounded,
      crouching: this.movement.crouching,
      speed,
      strafe: clamp(strafe, -1, 1),
    };
  }

  /**
   * Fold the authoritative state into the prediction.
   *
   * `ackSeq` is the last input the server consumed; anything newer is replayed
   * on top of the server position.
   */
  reconcile(state: QuantPlayer, ackSeq: number): void {
    this.health = state.health;
    this.alive = (state.flags & PlayerFlag.Dead) === 0;
    this.ammoInMag = state.mag;
    this.ammoReserve = state.reserve;
    this.serverFlags = state.flags;
    this.carrying = (state.flags & PlayerFlag.Carrying) !== 0;
    this.weaponId = weaponFromIndex(state.weapon);

    if (ackSeq === 0 || ackSeq < this.lastAckSeq) return;
    this.lastAckSeq = ackSeq;

    // Drop acknowledged commands, remembering what we had predicted for the
    // last one so we can measure the error.
    let predicted: PendingCommand | null = null;
    while (this.pending.length > 0 && this.pending[0]!.command.seq <= ackSeq) {
      predicted = this.pending.shift()!;
    }

    const serverX = dqPos(state.px);
    const serverY = dqPos(state.py);
    const serverZ = dqPos(state.pz);

    if (!this.alive) {
      // No prediction while dead: accept the server position outright.
      this.movement.position.x = serverX;
      this.movement.position.y = serverY;
      this.movement.position.z = serverZ;
      this.movement.velocity.x = 0;
      this.movement.velocity.y = 0;
      this.movement.velocity.z = 0;
      this.errorOffset.x = 0;
      this.errorOffset.y = 0;
      this.errorOffset.z = 0;
      this.renderPosition.x = serverX;
      this.renderPosition.y = serverY;
      this.renderPosition.z = serverZ;
      this.physics.character.teleport(this.movement.position);
      return;
    }

    if (!predicted) return;

    const error = Math.hypot(predicted.x - serverX, predicted.y - serverY, predicted.z - serverZ);
    this.lastErrorDistance = error;
    // Quantization alone is worth ~1.5 cm, so anything under the tolerance is
    // indistinguishable from a perfect prediction.
    if (error <= RECONCILE_TOLERANCE) return;

    this.corrections += 1;

    // Where we currently believe we are, so the visual can be eased from here.
    const beforeX = this.movement.position.x;
    const beforeY = this.movement.position.y;
    const beforeZ = this.movement.position.z;

    this.movement.position.x = serverX;
    this.movement.position.y = serverY;
    this.movement.position.z = serverZ;
    this.movement.velocity.x = dqVel(state.vx);
    this.movement.velocity.y = dqVel(state.vy);
    this.movement.velocity.z = dqVel(state.vz);
    this.movement.grounded = (state.flags & PlayerFlag.Grounded) !== 0;
    this.movement.crouching = (state.flags & PlayerFlag.Crouching) !== 0;
    this.physics.character.teleport(this.movement.position);

    // Replay everything the server has not seen yet.
    const multiplier = this.speedMultiplier();
    this.physics.refresh();
    for (const entry of this.pending) {
      stepMovement(
        this.movement,
        entry.command,
        this.physics.character,
        multiplier,
        this.stepEvents,
      );
      entry.x = this.movement.position.x;
      entry.y = this.movement.position.y;
      entry.z = this.movement.position.z;
    }

    if (error > HARD_SNAP_DISTANCE) {
      // Teleport, knockback or an anti-cheat clamp: showing the smooth path
      // would be a lie, so snap.
      this.errorOffset.x = 0;
      this.errorOffset.y = 0;
      this.errorOffset.z = 0;
    } else {
      // Keep the camera where it was and bleed the difference off over a few
      // frames; the player never sees a jolt for a small correction.
      this.errorOffset.x += beforeX - this.movement.position.x;
      this.errorOffset.y += beforeY - this.movement.position.y;
      this.errorOffset.z += beforeZ - this.movement.position.z;
      const magnitude = Math.hypot(this.errorOffset.x, this.errorOffset.y, this.errorOffset.z);
      if (magnitude > HARD_SNAP_DISTANCE) {
        const scale = HARD_SNAP_DISTANCE / magnitude;
        this.errorOffset.x *= scale;
        this.errorOffset.y *= scale;
        this.errorOffset.z *= scale;
      }
    }
  }

  private decayError(dtSec: number): void {
    const decay = Math.exp(-11 * dtSec);
    this.errorOffset.x *= decay;
    this.errorOffset.y *= decay;
    this.errorOffset.z *= decay;
    if (Math.abs(this.errorOffset.x) < 1e-4) this.errorOffset.x = 0;
    if (Math.abs(this.errorOffset.y) < 1e-4) this.errorOffset.y = 0;
    if (Math.abs(this.errorOffset.z) < 1e-4) this.errorOffset.z = 0;

    this.renderPosition.x = this.movement.position.x + this.errorOffset.x;
    this.renderPosition.y = this.movement.position.y + this.errorOffset.y;
    this.renderPosition.z = this.movement.position.z + this.errorOffset.z;
  }

  /** Called on a respawn event for the local player. */
  teleport(position: Vec3): void {
    this.movement.position.x = position.x;
    this.movement.position.y = position.y;
    this.movement.position.z = position.z;
    this.movement.velocity.x = 0;
    this.movement.velocity.y = 0;
    this.movement.velocity.z = 0;
    this.movement.grounded = false;
    this.movement.crouching = false;
    this.errorOffset.x = 0;
    this.errorOffset.y = 0;
    this.errorOffset.z = 0;
    this.renderPosition.x = position.x;
    this.renderPosition.y = position.y;
    this.renderPosition.z = position.z;
    this.pending.length = 0;
    this.physics.character.teleport(position);
    this.alive = true;
  }

  /** Distance from the predicted position to a world point. */
  distanceTo(point: Vec3): number {
    return distance(this.movement.position, point);
  }
}

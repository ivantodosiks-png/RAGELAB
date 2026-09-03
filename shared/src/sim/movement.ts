import {
  ACCEL_AIR,
  ACCEL_GROUND,
  ANTICHEAT_MAX_DT_MS,
  ANTICHEAT_MIN_DT_MS,
  COYOTE_TIME_MS,
  FRICTION_GROUND,
  GRAVITY,
  JUMP_COOLDOWN_MS,
  JUMP_VELOCITY,
  MAX_FALL_SPEED,
  SPEED_AIR_CONTROL,
  SPEED_CROUCH,
  SPEED_SPRINT,
  SPEED_WALK,
} from '../constants';
import { clamp, type Vec3 } from '../math';
import { Button, buttonDown, type InputCommand } from '../types/input';

export interface MoveResult {
  /** Resolved position after collision. */
  x: number;
  y: number;
  z: number;
  grounded: boolean;
  /** True if the capsule was blocked horizontally (used to kill velocity). */
  blockedX: boolean;
  blockedZ: boolean;
  blockedY: boolean;
}

/**
 * Physics backend contract. Implemented once on the client and once on the
 * server, both on top of Rapier's kinematic character controller, so that the
 * movement code above stays byte-for-byte identical.
 */
export interface CharacterCollisionAdapter {
  /** Sweep the capsule from `position` by `delta`, writing the result to `out`. */
  move(position: Vec3, delta: Vec3, crouching: boolean, out: MoveResult): void;
  /** Can the capsule grow back to standing height at `position`? */
  canStand(position: Vec3): boolean;
}

export interface MovementState {
  position: Vec3;
  velocity: Vec3;
  grounded: boolean;
  crouching: boolean;
  /** Deterministic per-player simulation clock in ms, advanced by the stepper. */
  timeMs: number;
  lastGroundedAtMs: number;
  lastJumpAtMs: number;
  /** Distance walked, drives footstep cadence on both sides. */
  stepDistance: number;
}

export interface StepEvents {
  jumped: boolean;
  landed: boolean;
  /** Downward speed at the moment of landing (positive number). */
  landingSpeed: number;
  /** Set when stepDistance crosses a footstep threshold. */
  footstep: boolean;
}

export function createMovementState(position: Vec3): MovementState {
  return {
    position: { x: position.x, y: position.y, z: position.z },
    velocity: { x: 0, y: 0, z: 0 },
    grounded: false,
    crouching: false,
    timeMs: 0,
    lastGroundedAtMs: -100000,
    lastJumpAtMs: -100000,
    stepDistance: 0,
  };
}

const FOOTSTEP_DISTANCE = 2.1;
const FOOTSTEP_DISTANCE_SPRINT = 2.6;

const moveResult: MoveResult = {
  x: 0,
  y: 0,
  z: 0,
  grounded: false,
  blockedX: false,
  blockedY: false,
  blockedZ: false,
};

/** Peak horizontal speed a player could reach with this input, for anti-cheat. */
export function maxSpeedFor(input: InputCommand, crouching: boolean, multiplier: number): number {
  const sprinting = buttonDown(input.buttons, Button.Sprint) && !crouching;
  const base = crouching ? SPEED_CROUCH : sprinting ? SPEED_SPRINT : SPEED_WALK;
  return base * multiplier;
}

/**
 * Advance one player by exactly one input command. Deterministic given the same
 * state, command and collision adapter - this is what makes client prediction
 * and server reconciliation agree.
 */
export function stepMovement(
  state: MovementState,
  input: InputCommand,
  adapter: CharacterCollisionAdapter,
  speedMultiplier: number,
  events: StepEvents,
): void {
  events.jumped = false;
  events.landed = false;
  events.landingSpeed = 0;
  events.footstep = false;

  const dtMs = clamp(input.dtMs, ANTICHEAT_MIN_DT_MS, ANTICHEAT_MAX_DT_MS);
  const dt = dtMs / 1000;
  state.timeMs += dtMs;

  const wantsCrouch = buttonDown(input.buttons, Button.Crouch);
  if (wantsCrouch) {
    state.crouching = true;
  } else if (state.crouching && adapter.canStand(state.position)) {
    state.crouching = false;
  }

  const sprinting =
    buttonDown(input.buttons, Button.Sprint) &&
    !state.crouching &&
    input.moveZ > 0.1 &&
    !buttonDown(input.buttons, Button.Aim);

  const targetSpeed =
    (state.crouching ? SPEED_CROUCH : sprinting ? SPEED_SPRINT : SPEED_WALK) * speedMultiplier;

  // Input direction in world space (yaw only; -Z is forward).
  const sinY = Math.sin(input.yaw);
  const cosY = Math.cos(input.yaw);
  let wishX = input.moveX * cosY - input.moveZ * sinY;
  let wishZ = -input.moveX * sinY - input.moveZ * cosY;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 1e-5) {
    const inv = 1 / wishLen;
    wishX *= inv;
    wishZ *= inv;
  } else {
    wishX = 0;
    wishZ = 0;
  }
  const wishSpeed = Math.min(wishLen, 1) * targetSpeed;

  const vel = state.velocity;

  if (state.grounded) {
    // Friction first, then acceleration toward the wish direction.
    const speed = Math.hypot(vel.x, vel.z);
    if (speed > 1e-4) {
      const drop = speed * FRICTION_GROUND * dt;
      const newSpeed = Math.max(speed - drop, 0);
      const scale = newSpeed / speed;
      vel.x *= scale;
      vel.z *= scale;
    } else {
      vel.x = 0;
      vel.z = 0;
    }
    accelerate(vel, wishX, wishZ, wishSpeed, ACCEL_GROUND, dt);
  } else {
    accelerate(vel, wishX, wishZ, wishSpeed * SPEED_AIR_CONTROL, ACCEL_AIR, dt);
  }

  // Jump (with a small coyote window so edge jumps feel right).
  const coyoteOk = state.grounded || state.timeMs - state.lastGroundedAtMs <= COYOTE_TIME_MS;
  const cooldownOk = state.timeMs - state.lastJumpAtMs >= JUMP_COOLDOWN_MS;
  if (buttonDown(input.buttons, Button.Jump) && coyoteOk && cooldownOk && !state.crouching) {
    vel.y = JUMP_VELOCITY;
    state.lastJumpAtMs = state.timeMs;
    state.grounded = false;
    events.jumped = true;
  }

  vel.y += GRAVITY * dt;
  if (vel.y < MAX_FALL_SPEED) vel.y = MAX_FALL_SPEED;

  const wasGrounded = state.grounded;
  const fallSpeed = -vel.y;

  const delta = { x: vel.x * dt, y: vel.y * dt, z: vel.z * dt };
  adapter.move(state.position, delta, state.crouching, moveResult);

  const actualDx = moveResult.x - state.position.x;
  const actualDz = moveResult.z - state.position.z;

  state.position.x = moveResult.x;
  state.position.y = moveResult.y;
  state.position.z = moveResult.z;

  // If the sweep ate our horizontal motion, drop the corresponding velocity so
  // we do not keep pushing into walls and accumulating speed.
  if (Math.abs(delta.x) > 1e-6 && Math.abs(actualDx) < Math.abs(delta.x) * 0.4) vel.x *= 0.2;
  if (Math.abs(delta.z) > 1e-6 && Math.abs(actualDz) < Math.abs(delta.z) * 0.4) vel.z *= 0.2;

  if (moveResult.grounded) {
    if (vel.y < 0) vel.y = 0;
    state.lastGroundedAtMs = state.timeMs;
    if (!wasGrounded && fallSpeed > 0.5) {
      events.landed = true;
      events.landingSpeed = fallSpeed;
    }
  } else if (moveResult.blockedY && vel.y > 0) {
    vel.y = 0;
  }
  state.grounded = moveResult.grounded;

  if (state.grounded) {
    state.stepDistance += Math.hypot(actualDx, actualDz);
    const threshold = sprinting ? FOOTSTEP_DISTANCE_SPRINT : FOOTSTEP_DISTANCE;
    if (state.stepDistance >= threshold) {
      state.stepDistance -= threshold;
      events.footstep = true;
    }
  } else {
    state.stepDistance = Math.min(state.stepDistance, FOOTSTEP_DISTANCE * 0.75);
  }
}

function accelerate(
  vel: Vec3,
  wishX: number,
  wishZ: number,
  wishSpeed: number,
  accel: number,
  dt: number,
): void {
  if (wishSpeed <= 1e-5) return;
  const currentSpeed = vel.x * wishX + vel.z * wishZ;
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) return;
  let accelSpeed = accel * dt * wishSpeed;
  if (accelSpeed > addSpeed) accelSpeed = addSpeed;
  vel.x += wishX * accelSpeed;
  vel.z += wishZ * accelSpeed;
}

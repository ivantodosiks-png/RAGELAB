import type RAPIER from '@dimforge/rapier3d-compat';
import {
  MAX_SLOPE_CLIMB_DEG,
  PLAYER_HALF_HEIGHT_CROUCH,
  PLAYER_HALF_HEIGHT_STAND,
  PLAYER_HEIGHT_STAND,
  PLAYER_RADIUS,
  STEP_HEIGHT,
} from '../constants';
import type { Vec3 } from '../math';
import type { CharacterCollisionAdapter, MoveResult } from '../sim/movement';
import { PLAYER_GROUPS } from './collisionGroups';

/**
 * Rapier-backed capsule character. Instantiated by the server for every player
 * and by the client for the locally predicted player, so both sides resolve
 * collisions with the exact same code path.
 *
 * `position` is the *feet* position; the capsule centre is offset upward.
 */
export class RapierCharacter implements CharacterCollisionAdapter {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  private readonly rapier: typeof RAPIER;
  private readonly world: RAPIER.World;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly standShape: RAPIER.Capsule;
  private crouched = false;

  constructor(rapier: typeof RAPIER, world: RAPIER.World, spawn: Vec3) {
    this.rapier = rapier;
    this.world = world;

    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
        spawn.x,
        spawn.y + PLAYER_HEIGHT_STAND / 2,
        spawn.z,
      ),
    );
    this.collider = world.createCollider(
      rapier.ColliderDesc.capsule(PLAYER_HALF_HEIGHT_STAND, PLAYER_RADIUS)
        .setCollisionGroups(PLAYER_GROUPS)
        .setFriction(0.2),
      this.body,
    );

    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((MAX_SLOPE_CLIMB_DEG * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((MAX_SLOPE_CLIMB_DEG * Math.PI) / 180);
    this.controller.enableAutostep(STEP_HEIGHT, PLAYER_RADIUS * 0.6, true);
    this.controller.enableSnapToGround(0.35);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(80);

    this.standShape = new rapier.Capsule(PLAYER_HALF_HEIGHT_STAND, PLAYER_RADIUS);
  }

  /** Capsule centre offset above the feet for the current stance. */
  private centreOffset(crouching: boolean): number {
    return (crouching ? PLAYER_HALF_HEIGHT_CROUCH : PLAYER_HALF_HEIGHT_STAND) + PLAYER_RADIUS;
  }

  private applyStance(crouching: boolean): void {
    if (crouching === this.crouched) return;
    this.collider.setHalfHeight(crouching ? PLAYER_HALF_HEIGHT_CROUCH : PLAYER_HALF_HEIGHT_STAND);
    this.crouched = crouching;
  }

  move(position: Vec3, delta: Vec3, crouching: boolean, out: MoveResult): void {
    this.applyStance(crouching);
    const offset = this.centreOffset(crouching);

    // The sweep starts from wherever the collider currently is, so place it at
    // the authoritative feet position before asking for the movement.
    this.body.setTranslation({ x: position.x, y: position.y + offset, z: position.z }, false);

    this.controller.computeColliderMovement(this.collider, delta);
    const corrected = this.controller.computedMovement();

    out.x = position.x + corrected.x;
    out.y = position.y + corrected.y;
    out.z = position.z + corrected.z;
    out.grounded = this.controller.computedGrounded();
    out.blockedX = Math.abs(corrected.x - delta.x) > 1e-4;
    out.blockedY = Math.abs(corrected.y - delta.y) > 1e-4;
    out.blockedZ = Math.abs(corrected.z - delta.z) > 1e-4;

    this.body.setTranslation({ x: out.x, y: out.y + offset, z: out.z }, false);
  }

  canStand(position: Vec3): boolean {
    const centre = {
      x: position.x,
      y: position.y + this.centreOffset(false),
      z: position.z,
    };
    const hit = this.world.intersectionWithShape(
      centre,
      { x: 0, y: 0, z: 0, w: 1 },
      this.standShape,
      undefined,
      PLAYER_GROUPS,
      this.collider,
      this.body,
    );
    return hit === null;
  }

  /** Teleport (respawn); clears the stance so the next move starts clean. */
  teleport(position: Vec3): void {
    this.applyStance(false);
    this.body.setTranslation(
      { x: position.x, y: position.y + this.centreOffset(false), z: position.z },
      false,
    );
  }

  dispose(): void {
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
  }

  /** Exposed so callers can build shapes without re-importing the wasm module. */
  get rapierModule(): typeof RAPIER {
    return this.rapier;
  }
}

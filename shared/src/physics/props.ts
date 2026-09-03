import type RAPIER from '@dimforge/rapier3d-compat';
import { getArchetype } from '../maps/archetypes';
import type { PropDef, PropKind } from '../types/map';
import { PROP_GROUPS } from './collisionGroups';
import { eulerToQuat } from './mapColliders';

export interface PropBodyHandles {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export function colliderDescForProp(
  rapier: typeof RAPIER,
  kind: PropKind,
  scale: number,
): RAPIER.ColliderDesc {
  const a = getArchetype(kind);
  switch (a.shape.type) {
    case 'box': {
      const [hx, hy, hz] = a.shape.halfExtents;
      return rapier.ColliderDesc.cuboid(hx * scale, hy * scale, hz * scale);
    }
    case 'sphere':
      return rapier.ColliderDesc.ball(a.shape.radius * scale);
    case 'cylinder':
      return rapier.ColliderDesc.cylinder(a.shape.halfHeight * scale, a.shape.radius * scale);
    default:
      return rapier.ColliderDesc.cuboid(0.4 * scale, 0.4 * scale, 0.4 * scale);
  }
}

/** Dynamic sandbox prop, used by the authoritative server. */
export function createDynamicProp(
  rapier: typeof RAPIER,
  world: RAPIER.World,
  def: PropDef,
): PropBodyHandles {
  const archetype = getArchetype(def.kind);
  const scale = def.scale ?? 1;
  const rot = def.rotation ?? [0, 0, 0];

  const body = world.createRigidBody(
    rapier.RigidBodyDesc.dynamic()
      .setTranslation(def.position[0], def.position[1], def.position[2])
      .setRotation(eulerToQuat(rot[0], rot[1], rot[2]))
      .setLinearDamping(archetype.linearDamping)
      .setAngularDamping(archetype.angularDamping)
      .setCcdEnabled(true)
      .setCanSleep(true),
  );

  const collider = world.createCollider(
    colliderDescForProp(rapier, def.kind, scale)
      .setMass((def.mass ?? archetype.mass) * scale * scale * scale)
      .setRestitution(archetype.restitution)
      .setFriction(archetype.friction)
      .setCollisionGroups(PROP_GROUPS),
    body,
  );

  return { body, collider };
}

/**
 * Kinematic stand-in used on the client. Prop motion is authoritative on the
 * server, so the client only needs a collider it can walk into; its transform
 * is written from the interpolated snapshot every frame.
 */
export function createReplicatedProp(
  rapier: typeof RAPIER,
  world: RAPIER.World,
  def: PropDef,
): PropBodyHandles {
  const archetype = getArchetype(def.kind);
  const scale = def.scale ?? 1;
  const rot = def.rotation ?? [0, 0, 0];

  const body = world.createRigidBody(
    rapier.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(def.position[0], def.position[1], def.position[2])
      .setRotation(eulerToQuat(rot[0], rot[1], rot[2])),
  );

  const collider = world.createCollider(
    colliderDescForProp(rapier, def.kind, scale)
      .setRestitution(archetype.restitution)
      .setFriction(archetype.friction)
      .setCollisionGroups(PROP_GROUPS),
    body,
  );

  return { body, collider };
}

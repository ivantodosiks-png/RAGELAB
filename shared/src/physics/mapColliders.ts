import type RAPIER from '@dimforge/rapier3d-compat';
import type { Brush, MapDefinition, SurfaceId } from '../types/map';
import { DOOR_GROUPS, WORLD_GROUPS } from './collisionGroups';

export interface ColliderMeta {
  kind: 'world' | 'prop' | 'door';
  surface: SurfaceId;
  /** Prop entity id, when kind === 'prop'. */
  propId?: number;
  /** Door id, when kind === 'door'. */
  doorId?: string;
}

/** Euler YXZ -> quaternion, matching the convention used by the client meshes. */
export function eulerToQuat(x: number, y: number, z: number): RAPIER.Rotation {
  const c1 = Math.cos(y / 2);
  const s1 = Math.sin(y / 2);
  const c2 = Math.cos(x / 2);
  const s2 = Math.sin(x / 2);
  const c3 = Math.cos(z / 2);
  const s3 = Math.sin(z / 2);
  // YXZ order
  return {
    x: c1 * s2 * c3 + s1 * c2 * s3,
    y: s1 * c2 * c3 - c1 * s2 * s3,
    z: c1 * c2 * s3 - s1 * s2 * c3,
    w: c1 * c2 * c3 + s1 * s2 * s3,
  };
}

/**
 * Build the static collision geometry of a map. Called identically on the
 * client (for local prediction) and on the server (authoritative), so the two
 * worlds agree on every wall.
 */
export function buildMapColliders(
  rapier: typeof RAPIER,
  world: RAPIER.World,
  map: MapDefinition,
  register?: (handle: number, meta: ColliderMeta) => void,
): void {
  const groundBody = world.createRigidBody(rapier.RigidBodyDesc.fixed());

  for (const brush of map.brushes) {
    if ('noCollide' in brush && brush.noCollide) continue;
    const surface = map.materials[brush.material]?.surface ?? 'concrete';
    const desc = colliderDescFor(rapier, brush);
    if (!desc) continue;
    desc.setCollisionGroups(WORLD_GROUPS);
    const collider = world.createCollider(desc, groundBody);
    register?.(collider.handle, { kind: 'world', surface });
  }

  // Invisible ceiling + floor plane so nothing can escape the simulation.
  const bounds = map.bounds + 4;
  const floor = world.createCollider(
    rapier.ColliderDesc.cuboid(bounds, 1, bounds)
      .setTranslation(0, map.killPlaneY - 2, 0)
      .setCollisionGroups(WORLD_GROUPS),
    groundBody,
  );
  register?.(floor.handle, { kind: 'world', surface: 'concrete' });
}

function colliderDescFor(rapier: typeof RAPIER, brush: Brush): RAPIER.ColliderDesc | null {
  switch (brush.kind) {
    case 'box': {
      const [sx, sy, sz] = brush.size;
      const desc = rapier.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(
        brush.position[0],
        brush.position[1],
        brush.position[2],
      );
      if (brush.rotation) {
        const [rx, ry, rz] = brush.rotation;
        desc.setRotation(eulerToQuat(rx, ry, rz));
      }
      return desc;
    }
    case 'cylinder': {
      const desc = rapier.ColliderDesc.cylinder(brush.height / 2, brush.radius).setTranslation(
        brush.position[0],
        brush.position[1],
        brush.position[2],
      );
      if (brush.rotation) {
        const [rx, ry, rz] = brush.rotation;
        desc.setRotation(eulerToQuat(rx, ry, rz));
      }
      return desc;
    }
    case 'ramp': {
      // A ramp is a thin box pitched about its local X axis, then yawed.
      const [sx, sy, sz] = brush.size;
      const pitch = -(brush.angle * Math.PI) / 180;
      const desc = rapier.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
        .setTranslation(brush.position[0], brush.position[1], brush.position[2])
        .setRotation(eulerToQuat(pitch, brush.yaw ?? 0, 0));
      return desc;
    }
    default:
      return null;
  }
}

/** Door bodies are kinematic; their transform is driven by the open progress. */
export function createDoorBody(
  rapier: typeof RAPIER,
  world: RAPIER.World,
  position: [number, number, number],
  size: [number, number, number],
  yaw: number,
): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position[0], position[1], position[2])
      .setRotation(eulerToQuat(0, yaw, 0)),
  );
  const collider = world.createCollider(
    rapier.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setCollisionGroups(
      DOOR_GROUPS,
    ),
    body,
  );
  return { body, collider };
}

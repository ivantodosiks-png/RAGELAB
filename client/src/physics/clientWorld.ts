import type RAPIER from '@dimforge/rapier3d-compat';
import {
  BULLET_FILTER_GROUPS,
  RapierCharacter,
  buildMapColliders,
  createDoorBody,
  createReplicatedProp,
  eulerToQuat,
  getArchetype,
  type DoorDef,
  type MapDefinition,
  type PropDef,
  type Quat,
  type SurfaceId,
  type Vec3,
} from '@ragelab/shared';

interface ReplicatedProp {
  id: number;
  def: PropDef;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  visible: boolean;
}

interface ClientDoor {
  def: DoorDef;
  body: RAPIER.RigidBody;
  widthAxis: 'x' | 'z';
  width: number;
  progress: number;
}

/**
 * Local physics mirror.
 *
 * The client never simulates gameplay physics - props and doors are
 * server-authoritative. It does need their colliders so the *locally predicted*
 * player can bump into them, so both exist here as kinematic bodies whose
 * transforms are written from the latest snapshot every frame.
 *
 * Prop ids follow map definition order starting at 1, exactly as the server
 * assigns them, and stay stable across prop destruction/respawn.
 */
export class ClientPhysicsWorld {
  readonly world: RAPIER.World;
  readonly character: RapierCharacter;

  private readonly props = new Map<number, ReplicatedProp>();
  private readonly doors: ClientDoor[] = [];
  private readonly surfaces = new Map<number, SurfaceId>();

  constructor(
    private readonly rapier: typeof RAPIER,
    readonly map: MapDefinition,
    spawn: Vec3,
  ) {
    // Gravity is irrelevant: nothing dynamic lives in this world. Stepping
    // still matters because it refreshes the query pipeline that the character
    // controller sweeps against.
    this.world = new rapier.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = 1 / 60;
    buildMapColliders(rapier, this.world, map, (handle, meta) => {
      this.surfaces.set(handle, meta.surface);
    });

    let id = 1;
    for (const def of map.props) {
      const { body, collider } = createReplicatedProp(rapier, this.world, def);
      this.props.set(id, { id, def, body, collider, visible: true });
      this.surfaces.set(collider.handle, getArchetype(def.kind).material.surface);
      id += 1;
    }

    for (const def of map.doors) {
      const { body, collider } = createDoorBody(rapier, this.world, def.position, def.size, def.yaw ?? 0);
      const widthAxis: 'x' | 'z' = def.size[0] >= def.size[2] ? 'x' : 'z';
      this.doors.push({
        def,
        body,
        widthAxis,
        width: widthAxis === 'x' ? def.size[0] : def.size[2],
        progress: 0,
      });
      this.surfaces.set(collider.handle, 'metal');
    }

    this.character = new RapierCharacter(rapier, this.world, spawn);
  }

  propIds(): Iterable<number> {
    return this.props.keys();
  }

  propDef(id: number): PropDef | undefined {
    return this.props.get(id)?.def;
  }

  setPropTransform(id: number, position: Vec3, rotation: Quat): void {
    const prop = this.props.get(id);
    if (!prop) return;
    prop.body.setTranslation(position, false);
    prop.body.setRotation(rotation, false);
  }

  /** Destroyed or out-of-interest props lose their collider until they return. */
  setPropActive(id: number, active: boolean): void {
    const prop = this.props.get(id);
    if (!prop || prop.visible === active) return;
    prop.visible = active;
    prop.collider.setEnabled(active);
  }

  doorCount(): number {
    return this.doors.length;
  }

  doorDef(index: number): DoorDef | undefined {
    return this.doors[index]?.def;
  }

  doorProgress(index: number): number {
    return this.doors[index]?.progress ?? 0;
  }

  /**
   * Mirror the authoritative door progress (0..1). The transform maths is a
   * copy of the server's so the collider and the rendered mesh line up.
   */
  setDoorProgress(index: number, progress: number): void {
    const door = this.doors[index];
    if (!door) return;
    door.progress = progress;
    const t = doorTransform(door.def, door.widthAxis, door.width, progress);
    door.body.setTranslation(t.position, false);
    door.body.setRotation(eulerToQuat(0, t.yaw, 0), false);
  }

  /** Refresh the query pipeline so the character sweep sees moved colliders. */
  refresh(): void {
    this.world.step();
  }

  /** Distance to the first solid surface along a ray, or null. */
  castRay(origin: Vec3, dir: Vec3, maxDistance: number, filterGroups: number): number | null {
    const ray = new this.rapier.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxDistance, true, undefined, filterGroups);
    return hit ? hit.timeOfImpact : null;
  }

  /** Material under the feet, used for footstep audio. */
  querySurfaceBelow(position: Vec3): SurfaceId {
    const ray = new this.rapier.Ray(
      { x: position.x, y: position.y + 0.45, z: position.z },
      { x: 0, y: -1, z: 0 },
    );
    const hit = this.world.castRay(ray, 2.6, true, undefined, BULLET_FILTER_GROUPS);
    if (!hit) return 'concrete';
    return this.surfaces.get(hit.collider.handle) ?? 'concrete';
  }

  dispose(): void {
    this.character.dispose();
    this.props.clear();
    this.doors.length = 0;
    this.world.free();
  }
}

/** Shared by the collider mirror and the renderer so both agree on door pose. */
export function doorTransform(
  def: DoorDef,
  widthAxis: 'x' | 'z',
  width: number,
  progress: number,
): { position: Vec3; yaw: number } {
  const baseYaw = def.yaw ?? 0;

  if (def.mode === 'slide') {
    const dist = def.travel * progress;
    const dirX = widthAxis === 'x' ? Math.cos(baseYaw) : -Math.sin(baseYaw);
    const dirZ = widthAxis === 'x' ? -Math.sin(baseYaw) : -Math.cos(baseYaw);
    return {
      position: {
        x: def.position[0] + dirX * dist,
        y: def.position[1],
        z: def.position[2] + dirZ * dist,
      },
      yaw: baseYaw,
    };
  }

  const angle = def.travel * progress;
  const half = width / 2;
  const localX = widthAxis === 'x' ? -half : 0;
  const localZ = widthAxis === 'z' ? -half : 0;
  const hingeX = def.position[0] + localX * Math.cos(baseYaw) - localZ * Math.sin(baseYaw);
  const hingeZ = def.position[2] + localX * Math.sin(baseYaw) + localZ * Math.cos(baseYaw);
  const offX = def.position[0] - hingeX;
  const offZ = def.position[2] - hingeZ;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  return {
    position: {
      x: hingeX + offX * ca - offZ * sa,
      y: def.position[1],
      z: hingeZ + offX * sa + offZ * ca,
    },
    yaw: baseYaw + angle,
  };
}

export function doorWidthAxis(def: DoorDef): { axis: 'x' | 'z'; width: number } {
  const axis: 'x' | 'z' = def.size[0] >= def.size[2] ? 'x' : 'z';
  return { axis, width: axis === 'x' ? def.size[0] : def.size[2] };
}

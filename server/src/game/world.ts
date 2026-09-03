import type RAPIER from '@dimforge/rapier3d-compat';
import {
  BULLET_FILTER_GROUPS,
  PROP_SLEEP_LINEAR_THRESHOLD,
  buildMapColliders,
  createDoorBody,
  createDynamicProp,
  eulerToQuat,
  getArchetype,
  qPos,
  qQuat,
  type ColliderMeta,
  type DoorDef,
  type MapDefinition,
  type PickupDef,
  type PropArchetype,
  type PropDef,
  type PropKind,
  type QuantProp,
  type SurfaceId,
  type Vec3,
} from '@ragelab/shared';

export interface PropEntity {
  id: number;
  kind: PropKind;
  archetype: PropArchetype;
  def: PropDef;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  health: number;
  destroyed: boolean;
  /** Network player id currently holding this prop, if any. */
  carriedBy: number | null;
  /** Server time at which a destroyed prop respawns. */
  respawnAt: number;
  /** Cached quantized transform, refreshed once per snapshot. */
  quant: QuantProp;
  /** True when the body moved since the last snapshot (skip sleeping props). */
  dirty: boolean;
}

export interface DoorEntity {
  index: number;
  def: DoorDef;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** 0 = closed, 1 = fully open. */
  progress: number;
  target: number;
  /** Axis the door width runs along in its local frame. */
  widthAxis: 'x' | 'z';
  width: number;
}

export interface PickupState {
  def: PickupDef;
  available: boolean;
  respawnAt: number;
}

export interface WorldRayHit {
  t: number;
  point: Vec3;
  normal: Vec3;
  surface: SurfaceId;
  kind: 'world' | 'prop' | 'door';
  propId?: number;
  doorId?: string;
}

export interface PendingExplosion {
  position: Vec3;
  radius: number;
  damage: number;
  impulse: number;
  /** Player credited with the kill, if the chain started from a player. */
  sourcePlayer: number | null;
  /** Prop that exploded, to avoid re-triggering it. */
  sourceProp: number | null;
}

export interface PropBreakRecord {
  id: number;
  kind: PropKind;
  position: Vec3;
}

const TMP_RAY_ORIGIN = { x: 0, y: 0, z: 0 };
const TMP_RAY_DIR = { x: 0, y: 0, z: 0 };

/**
 * Owns all non-player simulation for one room: static geometry, sandbox props,
 * doors, switches and pickups. Players live in the Room and are simulated with
 * the shared kinematic character controller.
 */
export class GameWorld {
  readonly map: MapDefinition;
  readonly world: RAPIER.World;
  readonly props = new Map<number, PropEntity>();
  readonly doors: DoorEntity[] = [];
  readonly switches = new Map<string, { on: boolean; autoResetAt: number; targets: string[] }>();
  readonly pickups = new Map<string, PickupState>();

  /** Explosions produced this tick, drained by the room. */
  readonly pendingExplosions: PendingExplosion[] = [];
  readonly brokenThisTick: PropBreakRecord[] = [];

  private readonly rapier: typeof RAPIER;
  private readonly colliderMeta = new Map<number, ColliderMeta>();
  private readonly doorsById = new Map<string, DoorEntity>();
  private readonly ray: RAPIER.Ray;
  private nextPropId = 1;

  constructor(rapier: typeof RAPIER, map: MapDefinition) {
    this.rapier = rapier;
    this.map = map;
    this.world = new rapier.World({ x: 0, y: -22, z: 0 });
    this.world.integrationParameters.numSolverIterations = 4;
    this.ray = new rapier.Ray(TMP_RAY_ORIGIN, TMP_RAY_DIR);

    buildMapColliders(rapier, this.world, map, (handle, meta) => {
      this.colliderMeta.set(handle, meta);
    });

    for (const def of map.props) this.spawnProp(def);
    for (const def of map.doors) this.createDoor(def);

    for (const sw of map.switches) {
      this.switches.set(sw.id, {
        on: sw.startsOn ?? false,
        autoResetAt: 0,
        targets: sw.targets,
      });
    }
    for (const pk of map.pickups) {
      this.pickups.set(pk.id, { def: pk, available: true, respawnAt: 0 });
    }

    // Apply the initial switch state so gated doors start in the right place.
    for (const [id, state] of this.switches) {
      if (state.on) this.applySwitch(id, true, 0);
    }
    for (const door of this.doors) {
      if (door.def.startsOpen) {
        door.progress = 1;
        door.target = 1;
      }
      this.applyDoorTransform(door);
    }
  }

  // ── props ─────────────────────────────────────────────────────────────────

  /**
   * Prop ids are stable for the lifetime of the room: the client derives the
   * same id from the map definition order, so a respawn must reuse the old id
   * rather than allocating a new one.
   */
  private spawnProp(def: PropDef, reuseId?: number): PropEntity {
    const id = reuseId ?? this.nextPropId++;
    const archetype = getArchetype(def.kind);
    const { body, collider } = createDynamicProp(this.rapier, this.world, def);
    const entity: PropEntity = {
      id,
      kind: def.kind,
      archetype,
      def,
      body,
      collider,
      health: archetype.health,
      destroyed: false,
      carriedBy: null,
      respawnAt: 0,
      quant: { id, px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 32767 },
      dirty: true,
    };
    this.props.set(id, entity);
    this.colliderMeta.set(collider.handle, {
      kind: 'prop',
      surface: archetype.material.surface,
      propId: id,
    });
    this.refreshPropQuant(entity);
    return entity;
  }

  private refreshPropQuant(prop: PropEntity): void {
    const t = prop.body.translation();
    const r = prop.body.rotation();
    const q = prop.quant;
    const px = qPos(t.x);
    const py = qPos(t.y);
    const pz = qPos(t.z);
    const qx = qQuat(r.x);
    const qy = qQuat(r.y);
    const qz = qQuat(r.z);
    const qw = qQuat(r.w);
    prop.dirty =
      px !== q.px || py !== q.py || pz !== q.pz || qx !== q.qx || qy !== q.qy || qz !== q.qz || qw !== q.qw;
    q.px = px;
    q.py = py;
    q.pz = pz;
    q.qx = qx;
    q.qy = qy;
    q.qz = qz;
    q.qw = qw;
  }

  /** Refresh every prop's quantized transform; called once per snapshot. */
  refreshPropTransforms(): void {
    for (const prop of this.props.values()) {
      if (prop.destroyed) continue;
      this.refreshPropQuant(prop);
    }
  }

  damageProp(id: number, amount: number, nowMs: number, attacker: number | null): boolean {
    const prop = this.props.get(id);
    if (!prop || prop.destroyed) return false;
    if (prop.archetype.health <= 0) return false;

    prop.health -= amount;
    if (prop.health > 0) return false;

    this.destroyProp(prop, nowMs, attacker);
    return true;
  }

  destroyProp(prop: PropEntity, nowMs: number, attacker: number | null): void {
    if (prop.destroyed) return;
    const t = prop.body.translation();
    prop.destroyed = true;
    prop.carriedBy = null;
    prop.respawnAt = nowMs + 25_000;

    this.brokenThisTick.push({
      id: prop.id,
      kind: prop.kind,
      position: { x: t.x, y: t.y, z: t.z },
    });

    if (prop.archetype.explosive) {
      this.pendingExplosions.push({
        position: { x: t.x, y: t.y, z: t.z },
        radius: prop.archetype.explosionRadius,
        damage: prop.archetype.explosionDamage,
        impulse: prop.archetype.explosionImpulse,
        sourcePlayer: attacker,
        sourceProp: prop.id,
      });
    }

    this.colliderMeta.delete(prop.collider.handle);
    this.world.removeRigidBody(prop.body);
  }

  /** Recreate destroyed props whose respawn timer elapsed. */
  private respawnProps(nowMs: number): void {
    for (const [id, prop] of this.props) {
      if (!prop.destroyed || nowMs < prop.respawnAt) continue;
      this.props.delete(id);
      this.spawnProp(prop.def, id);
    }
  }

  applyRadialImpulse(centre: Vec3, radius: number, impulse: number, nowMs: number): void {
    const r2 = radius * radius;
    for (const prop of this.props.values()) {
      if (prop.destroyed) continue;
      const t = prop.body.translation();
      const dx = t.x - centre.x;
      const dy = t.y - centre.y;
      const dz = t.z - centre.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 0.001;
      const falloff = 1 - d / radius;
      const mag = impulse * falloff * prop.body.mass();
      prop.body.applyImpulse(
        { x: (dx / d) * mag, y: (dy / d) * mag + mag * 0.35, z: (dz / d) * mag },
        true,
      );
      prop.carriedBy = null;

      // Chain reaction: explosives nearby take the blast damage too.
      if (prop.archetype.explosive) {
        this.damageProp(prop.id, prop.archetype.health + 1, nowMs, null);
      }
    }
  }

  pushProp(id: number, direction: Vec3, magnitude: number, at: Vec3): void {
    const prop = this.props.get(id);
    if (!prop || prop.destroyed) return;
    prop.body.applyImpulseAtPoint(
      { x: direction.x * magnitude, y: direction.y * magnitude, z: direction.z * magnitude },
      at,
      true,
    );
  }

  // ── doors & switches ──────────────────────────────────────────────────────

  private createDoor(def: DoorDef): DoorEntity {
    const widthAxis: 'x' | 'z' = def.size[0] >= def.size[2] ? 'x' : 'z';
    const width = widthAxis === 'x' ? def.size[0] : def.size[2];
    const { body, collider } = createDoorBody(
      this.rapier,
      this.world,
      def.position,
      def.size,
      def.yaw ?? 0,
    );
    const door: DoorEntity = {
      index: this.doors.length,
      def,
      body,
      collider,
      progress: 0,
      target: 0,
      widthAxis,
      width,
    };
    this.doors.push(door);
    this.doorsById.set(def.id, door);
    this.colliderMeta.set(collider.handle, {
      kind: 'door',
      surface: this.map.materials[def.material]?.surface ?? 'metal',
      doorId: def.id,
    });
    return door;
  }

  private applyDoorTransform(door: DoorEntity): void {
    const { def, progress } = door;
    const baseYaw = def.yaw ?? 0;

    if (def.mode === 'slide') {
      const dist = def.travel * progress;
      // Slide along the door's local width axis.
      const dirX = door.widthAxis === 'x' ? Math.cos(baseYaw) : -Math.sin(baseYaw);
      const dirZ = door.widthAxis === 'x' ? -Math.sin(baseYaw) : -Math.cos(baseYaw);
      door.body.setTranslation(
        {
          x: def.position[0] + dirX * dist,
          y: def.position[1],
          z: def.position[2] + dirZ * dist,
        },
        false,
      );
      door.body.setRotation(eulerToQuat(0, baseYaw, 0), false);
      return;
    }

    // Swing: rotate about the hinge edge.
    const angle = def.travel * progress;
    const half = door.width / 2;
    const localX = door.widthAxis === 'x' ? -half : 0;
    const localZ = door.widthAxis === 'z' ? -half : 0;

    const hingeX = def.position[0] + localX * Math.cos(baseYaw) - localZ * Math.sin(baseYaw);
    const hingeZ = def.position[2] + localX * Math.sin(baseYaw) + localZ * Math.cos(baseYaw);

    const offX = def.position[0] - hingeX;
    const offZ = def.position[2] - hingeZ;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);

    door.body.setTranslation(
      {
        x: hingeX + offX * ca - offZ * sa,
        y: def.position[1],
        z: hingeZ + offX * sa + offZ * ca,
      },
      false,
    );
    door.body.setRotation(eulerToQuat(0, baseYaw + angle, 0), false);
  }

  /** Returns the ids of doors whose open state flipped. */
  private updateDoors(dtSec: number): string[] {
    const changed: string[] = [];
    for (const door of this.doors) {
      if (door.progress === door.target) continue;
      const speed = 1000 / Math.max(door.def.openMs, 50);
      const step = speed * dtSec;
      const before = door.progress;
      if (door.target > door.progress) door.progress = Math.min(door.target, door.progress + step);
      else door.progress = Math.max(door.target, door.progress - step);
      this.applyDoorTransform(door);
      if ((before === 0 && door.progress > 0) || (before === 1 && door.progress < 1)) {
        changed.push(door.def.id);
      }
    }
    return changed;
  }

  toggleDoor(id: string): boolean | null {
    const door = this.doorsById.get(id);
    if (!door) return null;
    // Gated doors only respond to their switch.
    if (door.def.requiresSwitch) return null;
    door.target = door.target > 0.5 ? 0 : 1;
    return door.target > 0.5;
  }

  setDoorTarget(id: string, open: boolean): void {
    const door = this.doorsById.get(id);
    if (!door) return;
    door.target = open ? 1 : 0;
  }

  getDoor(id: string): DoorEntity | undefined {
    return this.doorsById.get(id);
  }

  toggleSwitch(id: string, nowMs: number): boolean | null {
    const state = this.switches.get(id);
    if (!state) return null;
    const next = !state.on;
    this.applySwitch(id, next, nowMs);
    return next;
  }

  private applySwitch(id: string, on: boolean, nowMs: number): void {
    const state = this.switches.get(id);
    if (!state) return;
    state.on = on;
    const def = this.map.switches.find((s) => s.id === id);
    state.autoResetAt = on && def?.autoResetMs ? nowMs + def.autoResetMs : 0;
    for (const target of state.targets) {
      const door = this.doorsById.get(target);
      if (door) door.target = on ? 1 : 0;
    }
  }

  private updateSwitches(nowMs: number): string[] {
    const reset: string[] = [];
    for (const [id, state] of this.switches) {
      if (state.autoResetAt && nowMs >= state.autoResetAt) {
        this.applySwitch(id, false, nowMs);
        reset.push(id);
      }
    }
    return reset;
  }

  // ── pickups ───────────────────────────────────────────────────────────────

  consumePickup(id: string, nowMs: number): PickupDef | null {
    const state = this.pickups.get(id);
    if (!state || !state.available) return null;
    state.available = false;
    state.respawnAt = nowMs + state.def.respawnMs;
    return state.def;
  }

  private updatePickups(nowMs: number): string[] {
    const respawned: string[] = [];
    for (const [id, state] of this.pickups) {
      if (!state.available && state.respawnAt && nowMs >= state.respawnAt) {
        state.available = true;
        state.respawnAt = 0;
        respawned.push(id);
      }
    }
    return respawned;
  }

  // ── queries ───────────────────────────────────────────────────────────────

  raycast(origin: Vec3, dir: Vec3, maxDistance: number): WorldRayHit | null {
    this.ray.origin = origin;
    this.ray.dir = dir;
    const hit = this.world.castRayAndGetNormal(
      this.ray,
      maxDistance,
      true,
      undefined,
      BULLET_FILTER_GROUPS,
    );
    if (!hit) return null;
    const meta = this.colliderMeta.get(hit.collider.handle);
    const t = hit.timeOfImpact;
    return {
      t,
      point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      surface: meta?.surface ?? 'concrete',
      kind: meta?.kind ?? 'world',
      propId: meta?.propId,
      doorId: meta?.doorId,
    };
  }

  /** True when nothing solid blocks the segment between two points. */
  hasLineOfSight(from: Vec3, to: Vec3): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-4) return true;
    const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
    const hit = this.raycast(from, dir, dist - 0.05);
    return hit === null;
  }

  propAt(colliderHandle: number): PropEntity | null {
    const meta = this.colliderMeta.get(colliderHandle);
    if (!meta || meta.propId === undefined) return null;
    return this.props.get(meta.propId) ?? null;
  }

  // ── tick ──────────────────────────────────────────────────────────────────

  step(dtSec: number, nowMs: number): {
    doorsChanged: string[];
    switchesReset: string[];
    pickupsRespawned: string[];
  } {
    const switchesReset = this.updateSwitches(nowMs);
    const doorsChanged = this.updateDoors(dtSec);
    this.respawnProps(nowMs);
    const pickupsRespawned = this.updatePickups(nowMs);

    this.world.timestep = dtSec;
    this.world.step();

    // Keep props inside the map: anything below the kill plane respawns.
    for (const prop of this.props.values()) {
      if (prop.destroyed) continue;
      const t = prop.body.translation();
      if (t.y < this.map.killPlaneY) {
        this.destroyProp(prop, nowMs, null);
        prop.respawnAt = nowMs + 4000;
      }
    }

    return { doorsChanged, switchesReset, pickupsRespawned };
  }

  /** Door progress bytes for the snapshot. */
  doorProgressBytes(out: number[]): number[] {
    out.length = this.doors.length;
    for (let i = 0; i < this.doors.length; i++) {
      out[i] = Math.round(this.doors[i]!.progress * 255);
    }
    return out;
  }

  isPropSettled(prop: PropEntity): boolean {
    const v = prop.body.linvel();
    return Math.hypot(v.x, v.y, v.z) < PROP_SLEEP_LINEAR_THRESHOLD;
  }

  dispose(): void {
    this.world.free();
    this.props.clear();
    this.colliderMeta.clear();
  }
}

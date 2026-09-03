import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import {
  GRAVITY,
  Group,
  PLAYER_HEIGHT_CROUCH,
  PLAYER_HEIGHT_STAND,
  PLAYER_RADIUS,
  SANDBOX_GROUPS,
  TICK_DT,
  buildMapColliders,
  createDoorBody,
  createReplicatedProp,
  groups,
  type MapDefinition,
  type Vec3,
} from '@ragelab/shared';
import { doorTransform, doorWidthAxis } from '../physics/clientWorld';
import type { SnapshotInterpolator } from '../networking/snapshotInterpolator';
import { SandboxNpc, type NpcUserData } from './sandboxNpc';
import { SharedNpcAssets } from './npcModel';
import {
  EFFECTS_MAX_BY_QUALITY,
  NPC_MAX_BY_QUALITY,
  RAGDOLL,
  defaultSandboxSettings,
  type NpcPartId,
  type SandboxSettings,
  type SandboxTool,
} from './types';

export interface SandboxInspect {
  id: number;
  state: string;
  mass: number;
  speed: number;
}

export interface SandboxFrameContext {
  dt: number;
  camera: THREE.Camera;
  playerPos: Vec3;
  crouching: boolean;
  interp: SnapshotInterpolator;
  locked: boolean;
  cursorMode: boolean;
  aimDir: Vec3;
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pickOrigin = new THREE.Vector3();
const pickDir = new THREE.Vector3();

const SPAWN_FILTER = groups(
  Group.World | Group.Prop | Group.Door,
  Group.World | Group.Prop | Group.Door,
);

export class SandboxController {
  readonly root = new THREE.Group();
  readonly settings: SandboxSettings = defaultSandboxSettings();

  tool: SandboxTool = 'none';
  cursorMode = false;

  private readonly rapier: typeof RAPIER;
  private readonly world: RAPIER.World;
  private readonly map: MapDefinition;
  private readonly assets = new SharedNpcAssets();
  private readonly pool: SandboxNpc[] = [];
  private readonly live: SandboxNpc[] = [];
  private readonly propBodies: RAPIER.RigidBody[] = [];
  private readonly doorBodies: RAPIER.RigidBody[] = [];
  private playerProxy: RAPIER.RigidBody;
  private playerCollider: RAPIER.Collider;
  private readonly marker: THREE.Mesh;
  private readonly inspectRing: THREE.Mesh;
  private readonly hoverBox: THREE.Box3Helper;
  private readonly hoverBounds = new THREE.Box3();

  private selected: SandboxNpc | null = null;
  private hovered: SandboxNpc | null = null;
  private accum = 0;
  private lastPointer = { x: 0, y: 0 };
  private listeners: Array<() => void> = [];

  constructor(rapier: typeof RAPIER, map: MapDefinition) {
    this.rapier = rapier;
    this.map = map;
    this.root.name = 'sandbox';

    this.world = new rapier.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = TICK_DT;
    buildMapColliders(rapier, this.world, map);

    for (const def of map.props) {
      const { body } = createReplicatedProp(rapier, this.world, def);
      this.propBodies.push(body);
    }
    for (const def of map.doors) {
      const { body } = createDoorBody(rapier, this.world, def.position, def.size, def.yaw ?? 0);
      this.doorBodies.push(body);
    }

    this.playerProxy = this.world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased());
    this.playerCollider = this.world.createCollider(
      rapier.ColliderDesc.capsule(PLAYER_HEIGHT_STAND / 2 - PLAYER_RADIUS, PLAYER_RADIUS).setCollisionGroups(
        SANDBOX_GROUPS,
      ),
      this.playerProxy,
    );

    const markGeo = new THREE.RingGeometry(0.18, 0.28, 28);
    const markMat = new THREE.MeshBasicMaterial({
      color: 0xd6ff3d,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.marker = new THREE.Mesh(markGeo, markMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.marker.renderOrder = 8;
    this.root.add(this.marker);

    const ringGeo = new THREE.RingGeometry(0.32, 0.4, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xd6ff3d,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.inspectRing = new THREE.Mesh(ringGeo, ringMat);
    this.inspectRing.rotation.x = -Math.PI / 2;
    this.inspectRing.visible = false;
    this.root.add(this.inspectRing);

    this.hoverBox = new THREE.Box3Helper(this.hoverBounds, 0xffffff);
    (this.hoverBox.material as THREE.LineBasicMaterial).transparent = true;
    (this.hoverBox.material as THREE.LineBasicMaterial).opacity = 0.9;
    this.hoverBox.visible = false;
    this.root.add(this.hoverBox);

    this.warmPool(Math.min(8, this.settings.maxNpcs));
  }

  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get liveCount(): number {
    return this.live.length;
  }

  get selectedNpc(): SandboxInspect | null {
    if (!this.selected?.active) return null;
    return {
      id: this.selected.id,
      state: this.selected.npcState,
      mass: this.selected.massKg,
      speed: this.selected.speed,
    };
  }

  get interceptsFire(): boolean {
    return this.tool !== 'none';
  }

  setTool(tool: SandboxTool): void {
    this.tool = tool;
    this.marker.visible = tool === 'spawn';
    this.emit();
  }

  setCursorMode(on: boolean): void {
    this.cursorMode = on;
    this.emit();
  }

  toggleCursorMode(): boolean {
    this.setCursorMode(!this.cursorMode);
    if (this.cursorMode && this.tool === 'none') this.setTool('spawn');
    return this.cursorMode;
  }

  patchSettings(patch: Partial<SandboxSettings>): void {
    Object.assign(this.settings, patch);
    if (patch.quality) {
      this.settings.maxNpcs = NPC_MAX_BY_QUALITY[patch.quality];
      this.settings.maxEffects = EFFECTS_MAX_BY_QUALITY[patch.quality];
    }
    this.settings.npcCount = clampInt(this.settings.npcCount, 1, this.settings.maxNpcs);
    this.settings.maxNpcs = clampInt(this.settings.maxNpcs, 1, 64);
    this.settings.maxEffects = clampInt(this.settings.maxEffects, 20, 800);
    if (this.settings.autoCleanup) this.enforceCap();
    this.emit();
  }

  setPointerNdc(clientX: number, clientY: number, width: number, height: number): void {
    this.lastPointer.x = (clientX / width) * 2 - 1;
    this.lastPointer.y = -(clientY / height) * 2 + 1;
  }

  spawnAtLookOrFront(aimOrigin: Vec3, aimDir: Vec3): number {
    const point = this.groundPoint(aimOrigin, aimDir) ?? {
      x: aimOrigin.x + aimDir.x * 3,
      y: aimOrigin.y,
      z: aimOrigin.z + aimDir.z * 3,
    };
    return this.spawnBurst(point, Math.atan2(-aimDir.x, -aimDir.z));
  }

  worldAim(camera: THREE.Camera, fallbackOrigin: Vec3, fallbackDir: Vec3): { origin: Vec3; dir: Vec3 } {
    if (!this.cursorMode) return { origin: fallbackOrigin, dir: fallbackDir };
    return {
      origin: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      dir: this.dirFromNdc(camera),
    };
  }

  handlePrimary(aimOrigin: Vec3, aimDir: Vec3, camera: THREE.Camera): boolean {
    const aim = this.worldAim(camera, aimOrigin, aimDir);
    if (this.tool === 'none') return false;
    if (this.tool === 'spawn') {
      const point = this.groundPoint(aim.origin, aim.dir);
      if (!point) return true;
      this.spawnBurst(point, Math.atan2(-aim.dir.x, -aim.dir.z));
      return true;
    }
    const npc = this.pickNpc(camera, aim.origin, aim.dir);
    if (this.tool === 'delete') {
      if (npc) this.removeNpc(npc);
      else this.removeNearest(aim.origin);
      return true;
    }
    if (this.tool === 'ragdoll') {
      npc?.enterRagdoll({ x: aim.dir.x * 4, y: 3, z: aim.dir.z * 4 });
      this.emit();
      return true;
    }
    if (this.tool === 'select') {
      this.select(npc);
      return true;
    }
    return true;
  }

  tryShot(origin: Vec3, dir: Vec3, range: number): boolean {
    const ray = new this.rapier.Ray(origin, dir);
    const hit = this.world.castRay(ray, range, true);
    if (!hit) return false;
    const body = hit.collider.parent();
    const data = body?.userData as NpcUserData | undefined;
    if (!data || data.kind !== 'sandboxNpc') return false;
    const npc = this.live.find((n) => n.id === data.npcId);
    if (!npc) return false;
    const part = data.part === 'locator' ? 'torso' : data.part;
    npc.applyShot(dir, part as NpcPartId, RAGDOLL.shotImpulse);
    this.emit();
    return true;
  }

  spawnBurst(point: { x: number; y: number; z: number }, yaw: number): number {
    const n = this.settings.npcCount;
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      if (this.live.length >= this.settings.maxNpcs) {
        if (this.settings.autoCleanup) this.removeOldest();
        else break;
      }
      const ox = (Math.random() - 0.5) * 2 * this.settings.spawnRandomOffset;
      const oz = (Math.random() - 0.5) * 2 * this.settings.spawnRandomOffset;
      this.acquire().spawn(
        point.x + ox,
        point.y + this.settings.spawnHeight,
        point.z + oz,
        yaw + (Math.random() - 0.5) * 0.4,
        this.settings.ragdollOnSpawn,
      );
      spawned += 1;
    }
    this.emit();
    return spawned;
  }

  removeNpc(npc: SandboxNpc): void {
    npc.despawn();
    const index = this.live.indexOf(npc);
    if (index >= 0) this.live.splice(index, 1);
    if (this.selected === npc) this.selected = null;
    if (this.hovered === npc) this.hovered = null;
    this.emit();
  }

  removeNearest(origin: Vec3): void {
    let best: SandboxNpc | null = null;
    let bestD = 4;
    for (const npc of this.live) {
      const p = npc.position;
      const d = Math.hypot(p.x - origin.x, p.y - origin.y, p.z - origin.z);
      if (d < bestD) {
        best = npc;
        bestD = d;
      }
    }
    if (best) this.removeNpc(best);
  }

  removeAllNpcs(): void {
    for (const npc of [...this.live]) this.removeNpc(npc);
  }

  ragdollSelected(): void {
    this.selected?.enterRagdoll({ x: 0, y: 4, z: 0 });
    this.emit();
  }

  ragdollAll(): void {
    for (const npc of this.live) npc.enterRagdoll({ x: 0, y: 3.5, z: 0 });
    this.emit();
  }

  resetSelected(): void {
    this.selected?.resetToSpawnPose();
    this.emit();
  }

  resetNearest(origin: Vec3): void {
    let best: SandboxNpc | null = this.selected?.active ? this.selected : null;
    if (!best) {
      let bestD = 6;
      for (const npc of this.live) {
        const p = npc.position;
        const d = Math.hypot(p.x - origin.x, p.y - origin.y, p.z - origin.z);
        if (d < bestD) {
          best = npc;
          bestD = d;
        }
      }
    }
    best?.resetToSpawnPose();
    if (best) this.select(best);
    this.emit();
  }

  deleteSelected(): void {
    if (this.selected) this.removeNpc(this.selected);
  }

  update(ctx: SandboxFrameContext): void {
    this.syncPlayer(ctx.playerPos, ctx.crouching);
    this.syncProps(ctx.interp);

    this.accum += ctx.dt;
    let steps = 0;
    while (this.accum >= TICK_DT && steps < 3) {
      this.world.step();
      this.accum -= TICK_DT;
      steps += 1;
    }

    for (const npc of this.live) npc.update(ctx.dt);

    const lookOrigin = {
      x: ctx.camera.position.x,
      y: ctx.camera.position.y,
      z: ctx.camera.position.z,
    };
    const dir = ctx.cursorMode ? this.dirFromNdc(ctx.camera) : ctx.aimDir;
    const origin = lookOrigin;

    if (this.tool === 'spawn') {
      const point = this.groundPoint(origin, dir);
      if (point) {
        this.marker.visible = true;
        this.marker.position.set(point.x, point.y + 0.02, point.z);
      } else {
        this.marker.visible = false;
      }
    }

    const hover = this.pickNpc(ctx.camera, origin, dir);
    if (this.hovered !== hover) {
      this.hovered?.setHovered(false);
      hover?.setHovered(true);
      this.hovered = hover ?? null;
    }

    const outlined = this.selected?.active ? this.selected : this.hovered;
    if (outlined?.active) {
      this.hoverBox.visible = true;
      this.hoverBounds.setFromObject(outlined.root);
      this.hoverBox.updateMatrixWorld(true);
    } else {
      this.hoverBox.visible = false;
    }

    if (this.selected?.active) {
      const p = this.selected.position;
      this.inspectRing.visible = true;
      this.inspectRing.position.set(p.x, p.y + 0.03, p.z);
    } else {
      this.inspectRing.visible = false;
      if (this.selected && !this.selected.active) this.selected = null;
    }
  }

  dispose(): void {
    this.removeAllNpcs();
    for (const npc of this.pool) npc.dispose();
    this.pool.length = 0;
    this.assets.dispose();
    (this.marker.material as THREE.Material).dispose();
    this.marker.geometry.dispose();
    (this.inspectRing.material as THREE.Material).dispose();
    this.inspectRing.geometry.dispose();
    (this.hoverBox.material as THREE.Material).dispose();
    this.hoverBox.geometry.dispose();
    this.world.free();
    this.root.removeFromParent();
  }

  private select(npc: SandboxNpc | null): void {
    this.selected?.setSelected(false);
    this.selected = npc;
    npc?.setSelected(true);
    this.emit();
  }

  private acquire(): SandboxNpc {
    let npc = this.pool.find((n) => !n.active);
    if (!npc) {
      npc = new SandboxNpc(this.rapier, this.world, this.assets, Math.random);
      this.pool.push(npc);
      this.root.add(npc.root);
    }
    this.live.push(npc);
    return npc;
  }

  private warmPool(count: number): void {
    for (let i = 0; i < count; i++) {
      const npc = new SandboxNpc(this.rapier, this.world, this.assets, Math.random);
      this.pool.push(npc);
      this.root.add(npc.root);
    }
  }

  private enforceCap(): void {
    while (this.live.length > this.settings.maxNpcs) this.removeOldest();
  }

  private removeOldest(): void {
    let oldest = this.live[0];
    if (!oldest) return;
    for (const npc of this.live) {
      if (npc.spawnedAt < oldest.spawnedAt) oldest = npc;
    }
    this.removeNpc(oldest);
  }

  private syncPlayer(pos: Vec3, crouching: boolean): void {
    const height = crouching ? PLAYER_HEIGHT_CROUCH : PLAYER_HEIGHT_STAND;
    const half = height / 2 - PLAYER_RADIUS;
    this.playerCollider.setHalfHeight(half);
    this.playerProxy.setNextKinematicTranslation({
      x: pos.x,
      y: pos.y + height / 2,
      z: pos.z,
    });
  }

  private syncProps(interp: SnapshotInterpolator): void {
    for (let i = 0; i < this.propBodies.length; i++) {
      const state = interp.props.get(i + 1);
      const body = this.propBodies[i]!;
      if (!state) {
        body.setEnabled(false);
        continue;
      }
      body.setEnabled(true);
      body.setNextKinematicTranslation(state.position);
      body.setNextKinematicRotation(state.rotation);
    }
    for (let i = 0; i < this.doorBodies.length; i++) {
      const def = this.map.doors[i];
      const body = this.doorBodies[i];
      if (!def || !body) continue;
      const { axis, width } = doorWidthAxis(def);
      const t = doorTransform(def, axis, width, interp.doors[i] ?? 0);
      body.setNextKinematicTranslation(t.position);
      const q = yawQuat(t.yaw);
      body.setNextKinematicRotation(q);
    }
  }

  private groundPoint(origin: Vec3, dir: Vec3): { x: number; y: number; z: number } | null {
    const ray = new this.rapier.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      80,
      true,
      undefined,
      SPAWN_FILTER,
      this.playerCollider,
    );
    if (!hit) return null;
    const toi = hit.timeOfImpact;
    const n = hit.normal;
    return {
      x: origin.x + dir.x * toi + n.x * 0.02,
      y: origin.y + dir.y * toi + n.y * 0.02,
      z: origin.z + dir.z * toi + n.z * 0.02,
    };
  }

  private pickNpc(camera: THREE.Camera, origin: Vec3, dir: Vec3): SandboxNpc | null {
    if (this.cursorMode) {
      raycaster.setFromCamera(ndc.set(this.lastPointer.x, this.lastPointer.y), camera);
    } else {
      raycaster.set(pickOrigin.set(origin.x, origin.y, origin.z), pickDir.set(dir.x, dir.y, dir.z));
    }
    const hits = raycaster.intersectObjects(this.live.map((n) => n.root), true);
    if (hits.length === 0) return null;
    const obj = hits[0]!.object;
    return this.live.find((n) => n.matchesObject(obj)) ?? null;
  }

  private dirFromNdc(camera: THREE.Camera): Vec3 {
    raycaster.setFromCamera(ndc.set(this.lastPointer.x, this.lastPointer.y), camera);
    const d = raycaster.ray.direction;
    return { x: d.x, y: d.y, z: d.z };
  }
}

function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

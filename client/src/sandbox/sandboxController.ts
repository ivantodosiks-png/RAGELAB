import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import {
  GRAVITY,
  Group,
  PLAYER_HEIGHT_CROUCH,
  PLAYER_HEIGHT_STAND,
  PLAYER_RADIUS,
  SANDBOX_GROUPS,
  SANDBOX_SHOT_FILTER,
  TICK_DT,
  buildMapColliders,
  createDoorBody,
  createReplicatedProp,
  groups,
  npcHitDamage,
  npcZoneForPart,
  type MapDefinition,
  type Vec3,
  type WeaponDefinition,
} from '@ragelab/shared';
import { doorTransform, doorWidthAxis } from '../physics/clientWorld';
import type { SnapshotInterpolator } from '../networking/snapshotInterpolator';
import { SandboxNpc, type NpcUserData } from './sandboxNpc';
import { SandboxWeapon, type WeaponUserData } from './sandboxWeapon';
import { SandboxProp, type PropInteractResult, type PropUserData } from './sandboxProp';
import { SharedNpcAssets } from './npcModel';
import { preloadNpcHumanoid } from './npcGltf';
import { SANDBOX_WEAPON_KINDS, type SandboxWeaponKind } from '../weapons/weaponAssets';
import { SpawnPreview } from './spawnPreview';
import { NavGrid } from '../ai/navGrid';
import type { BrainWorld } from '../ai/npcBrain';
import {
  DEFAULT_SPAWN_ENTRY,
  NPC_MENU_ENABLED,
  interactPromptFor,
  isPropCategory,
  npcRagdollOnSpawn,
  propKindFromEntry,
  toolFromEntry,
  weaponKindFromEntry,
  type SpawnEntry,
} from './spawnCatalog';
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
  private readonly weaponPool: SandboxWeapon[] = [];
  private readonly liveWeapons: SandboxWeapon[] = [];
  private readonly propPool: SandboxProp[] = [];
  private readonly liveProps: SandboxProp[] = [];
  private heldWeapon: SandboxWeapon | null = null;
  private heldProp: SandboxProp | null = null;
  private readonly preview = new SpawnPreview();
  menuOpen = false;
  selection: SpawnEntry = DEFAULT_SPAWN_ENTRY;
  onCannotSpawnWeapon: (() => void) | null = null;
  private readonly propBodies: RAPIER.RigidBody[] = [];
  private readonly doorBodies: RAPIER.RigidBody[] = [];
  private playerProxy: RAPIER.RigidBody;
  private playerCollider: RAPIER.Collider;
  private readonly marker: THREE.Mesh;
  onImpact: ((x: number, y: number, z: number, nx: number, ny: number, nz: number, speed: number) => void) | null =
    null;
  onNpcHit:
    | ((
        x: number,
        y: number,
        z: number,
        nx: number,
        ny: number,
        nz: number,
        zone: string,
        killed: boolean,
        attach: THREE.Object3D | null,
      ) => void)
    | null = null;
  onBloodContact:
    | ((x: number, y: number, z: number, nx: number, ny: number, nz: number) => void)
    | null = null;
  onPropBump: ((kind: string, x: number, y: number, z: number, speed: number) => void) | null = null;

  private selected: SandboxNpc | null = null;
  private hovered: SandboxNpc | null = null;
  private lookProp: SandboxProp | null = null;
  private lookWeapon: SandboxWeapon | null = null;
  lookHint: 'none' | 'npc' | 'prop' | 'weapon' | 'spawn' = 'none';
  private accum = 0;
  private lastPointer = { x: 0, y: 0 };
  private listeners: Array<() => void> = [];
  private readonly nav: NavGrid;
  private readonly noises: Array<{ x: number; z: number; at: number }> = [];
  private thinkFrame = 0;

  constructor(rapier: typeof RAPIER, map: MapDefinition) {
    this.rapier = rapier;
    this.map = map;
    this.nav = new NavGrid(map);
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
    this.root.add(this.preview.root);

    this.warmPool(Math.min(8, this.settings.maxNpcs));
    void this.bootHumanoids();
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

  get weaponCount(): number {
    return this.liveWeapons.length;
  }

  get propCount(): number {
    return this.liveProps.length;
  }

  get toolGunActive(): boolean {
    return this.tool === 'toolGun';
  }

  get selectedNpc(): SandboxInspect | null {
    if (!this.selected?.active) return null;
    return {
      id: this.selected.id,
      state: `${this.selected.npcState}/${this.selected.behavior}`,
      mass: this.selected.massKg,
      speed: this.selected.speed,
    };
  }

  get interceptsFire(): boolean {
    return this.tool !== 'none';
  }

  notifyNoise(x: number, z: number): void {
    const at = performance.now() / 1000;
    this.noises.push({ x, z, at });
    if (this.noises.length > 12) this.noises.shift();
  }

  setTool(tool: SandboxTool): void {
    this.tool = tool;
    this.syncMarkerVisibility();
    if (tool === 'toolGun') this.preview.setEntry(this.selection);
    this.emit();
  }

  setMenuOpen(open: boolean): void {
    this.menuOpen = open;
    if (open) this.preview.update(null, 0, false);
    this.emit();
  }

  setSelection(entry: SpawnEntry): void {
    if (entry.category === 'npc' && !NPC_MENU_ENABLED) return;
    this.selection = entry;
    this.preview.setEntry(entry);
    this.syncMarkerVisibility();
    this.emit();
  }

  setCursorMode(on: boolean): void {
    this.cursorMode = on;
    this.emit();
  }

  toggleCursorMode(): boolean {
    this.setCursorMode(!this.cursorMode);
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
    this.settings.maxWeapons = clampInt(this.settings.maxWeapons ?? 32, 1, 64);
    this.settings.maxProps = clampInt(this.settings.maxProps ?? 80, 1, 160);
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
    if (this.menuOpen) return true;
    const aim = this.worldAim(camera, aimOrigin, aimDir);
    if (this.tool === 'none') return false;
    if (this.tool === 'toolGun') return this.handleToolGun(aim, camera);
    return this.applyWorldTool(this.tool, aim, camera);
  }

  private handleToolGun(aim: { origin: Vec3; dir: Vec3 }, camera: THREE.Camera): boolean {
    const entry = this.selection;
    if (entry.category === 'weapons') {
      const kind = weaponKindFromEntry(entry.id);
      const point = this.groundPoint(aim.origin, aim.dir);
      if (!point || !kind) return true;
      this.spawnWeaponAt(point, Math.atan2(-aim.dir.x, -aim.dir.z), kind);
      return true;
    }
    if (entry.category === 'tools') {
      const tool = toolFromEntry(entry.id);
      if (!tool) return true;
      return this.applyWorldTool(tool, aim, camera);
    }
    const yaw = Math.atan2(-aim.dir.x, -aim.dir.z);
    const point = this.groundPoint(aim.origin, aim.dir);
    if (!point) return true;
    if (entry.category === 'npc') {
      if (NPC_MENU_ENABLED) {
        this.spawnBurst(point, yaw, { count: 1, ragdoll: npcRagdollOnSpawn(entry.id) });
      }
      return true;
    }
    if (isPropCategory(entry.category)) {
      const kind = propKindFromEntry(entry.id);
      if (kind) this.spawnPropAt(point, yaw, kind);
    }
    return true;
  }

  private applyWorldTool(
    tool: SandboxTool,
    aim: { origin: Vec3; dir: Vec3 },
    camera: THREE.Camera,
  ): boolean {
    if (tool === 'spawn') {
      if (!NPC_MENU_ENABLED) return true;
      const point = this.groundPoint(aim.origin, aim.dir);
      if (!point) return true;
      this.spawnBurst(point, Math.atan2(-aim.dir.x, -aim.dir.z));
      return true;
    }
    if (tool === 'spawnWeapon') {
      const point = this.groundPoint(aim.origin, aim.dir);
      if (!point) return true;
      this.spawnWeaponAt(point, Math.atan2(-aim.dir.x, -aim.dir.z));
      return true;
    }
    if (tool === 'grab') {
      if (this.heldWeapon?.active || this.heldProp?.active) {
        this.throwHeld(aim.dir);
        return true;
      }
      const weapon = this.pickWeapon(camera, aim.origin, aim.dir);
      if (weapon) {
        this.holdWeapon(weapon);
        return true;
      }
      const prop = this.pickProp(camera, aim.origin, aim.dir);
      if (prop) this.holdProp(prop);
      return true;
    }
    const npc = this.pickNpc(camera, aim.origin, aim.dir);
    const weapon = this.pickWeapon(camera, aim.origin, aim.dir);
    const prop = this.pickProp(camera, aim.origin, aim.dir);
    if (tool === 'delete') {
      if (weapon) this.removeWeapon(weapon);
      else if (prop) this.removeProp(prop);
      else if (npc) this.removeNpc(npc);
      else this.removeNearest(aim.origin);
      return true;
    }
    if (tool === 'ragdoll') {
      npc?.enterRagdoll({ x: aim.dir.x * 4, y: 3, z: aim.dir.z * 4 });
      this.emit();
      return true;
    }
    if (tool === 'select') {
      this.select(npc);
      return true;
    }
    return true;
  }

  tryShot(origin: Vec3, dir: Vec3, range: number, weapon?: WeaponDefinition): boolean {
    const ray = new this.rapier.Ray(origin, dir);
    const hit = this.world.castRay(ray, range, true, undefined, SANDBOX_SHOT_FILTER);
    if (!hit) return false;
    const body = hit.collider.parent();
    const data = body?.userData as NpcUserData | WeaponUserData | PropUserData | undefined;
    if (!data) return false;
    if (data.kind === 'sandboxWeapon') {
      const spawned = this.liveWeapons.find((w) => w.id === data.weaponId);
      spawned?.applyImpulse(dir, (weapon?.impactImpulse ?? RAGDOLL.shotImpulse * 0.25) * 4);
      this.emit();
      return true;
    }
    if (data.kind === 'sandboxProp') {
      const prop = this.liveProps.find((p) => p.id === data.propId);
      prop?.applyImpulse(dir, (weapon?.impactImpulse ?? RAGDOLL.shotImpulse * 0.3) * 5);
      this.emit();
      return true;
    }
    if (data.kind !== 'sandboxNpc') return false;
    const npc = this.live.find((n) => n.id === data.npcId);
    if (!npc) return false;
    const part = (data.part === 'locator' ? 'torso' : data.part) as NpcPartId;
    const zone = npcZoneForPart(part);
    const distance = hit.timeOfImpact;
    const hitPoint = {
      x: origin.x + dir.x * distance,
      y: origin.y + dir.y * distance,
      z: origin.z + dir.z * distance,
    };
    const damage = weapon ? npcHitDamage(weapon, zone, distance) : 34;
    const impulse = weapon?.impactImpulse ?? 3.5;
    npc.applyHit(dir, part, damage, impulse, hitPoint);
    for (const splat of this.collectBloodSurfaces(hitPoint, dir)) {
      this.onBloodContact?.(splat.x, splat.y, splat.z, splat.nx, splat.ny, splat.nz);
    }
    this.notifyNoise(hitPoint.x, hitPoint.z);
    this.trimRagdolls();
    this.emit();
    return true;
  }

  spawnBurst(
    point: { x: number; y: number; z: number },
    yaw: number,
    opts?: { count?: number; ragdoll?: boolean },
  ): number {
    if (!NPC_MENU_ENABLED) return 0;
    const n = opts?.count ?? this.settings.npcCount;
    const ragdoll = opts?.ragdoll ?? this.settings.ragdollOnSpawn;
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
        ragdoll,
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

  spawnWeaponAtLook(aimOrigin: Vec3, aimDir: Vec3): boolean {
    const point = this.groundPoint(aimOrigin, aimDir) ?? {
      x: aimOrigin.x + aimDir.x * 3,
      y: aimOrigin.y,
      z: aimOrigin.z + aimDir.z * 3,
    };
    return this.spawnWeaponAt(point, Math.atan2(-aimDir.x, -aimDir.z));
  }

  spawnWeaponAt(point: { x: number; y: number; z: number }, yaw: number, kind?: SandboxWeaponKind): boolean {
    if (this.liveWeapons.length >= this.settings.maxWeapons) {
      if (this.settings.autoCleanup) this.removeOldestWeapon();
      else return false;
    }
    const picked =
      kind ??
      ((SANDBOX_WEAPON_KINDS as readonly string[]).includes(this.settings.weaponKind)
        ? this.settings.weaponKind
        : 'pistol');
    const weapon = this.acquireWeapon();
    weapon.spawn(picked, point.x, point.y + this.settings.spawnHeight, point.z, yaw);
    this.emit();
    return true;
  }

  throwWeapon(kind: string, origin: Vec3, dir: Vec3): boolean {
    const picked = (SANDBOX_WEAPON_KINDS as readonly string[]).includes(kind)
      ? (kind as SandboxWeaponKind)
      : 'pistol';
    if (this.liveWeapons.length >= this.settings.maxWeapons) {
      if (this.settings.autoCleanup) this.removeOldestWeapon();
      else return false;
    }
    const yaw = Math.atan2(-dir.x, -dir.z);
    const weapon = this.acquireWeapon();
    weapon.spawn(picked, origin.x + dir.x * 0.7, origin.y + dir.y * 0.7 - 0.12, origin.z + dir.z * 0.7, yaw);
    weapon.throw(dir);
    this.emit();
    return true;
  }

  spawnPropAt(point: { x: number; y: number; z: number }, yaw: number, kind = propKindFromEntry(this.selection.id)): boolean {
    if (!kind) return false;
    if (this.liveProps.length >= this.settings.maxProps) {
      if (this.settings.autoCleanup) this.removeOldestProp();
      else return false;
    }
    this.acquireProp().spawn(kind, point.x, point.y + this.settings.spawnHeight, point.z, yaw);
    this.emit();
    return true;
  }

  removeWeapon(weapon: SandboxWeapon): void {
    if (this.heldWeapon === weapon) this.heldWeapon = null;
    if (this.lookWeapon === weapon) this.lookWeapon = null;
    weapon.despawn();
    const index = this.liveWeapons.indexOf(weapon);
    if (index >= 0) this.liveWeapons.splice(index, 1);
    this.emit();
  }

  removeAllWeapons(): void {
    this.heldWeapon = null;
    for (const weapon of [...this.liveWeapons]) this.removeWeapon(weapon);
  }

  removeProp(prop: SandboxProp): void {
    if (this.heldProp === prop) this.heldProp = null;
    if (this.lookProp === prop) this.lookProp = null;
    prop.despawn();
    const index = this.liveProps.indexOf(prop);
    if (index >= 0) this.liveProps.splice(index, 1);
    this.emit();
  }

  removeAllProps(): void {
    this.heldProp = null;
    for (const prop of [...this.liveProps]) this.removeProp(prop);
  }

  private holdWeapon(weapon: SandboxWeapon): void {
    if (this.heldProp) this.throwHeld({ x: 0, y: 0.2, z: 1 });
    if (this.heldWeapon && this.heldWeapon !== weapon) this.throwHeld({ x: 0, y: 0.2, z: 1 });
    this.heldWeapon = weapon;
    weapon.hold();
    this.emit();
  }

  private holdProp(prop: SandboxProp): void {
    if (this.heldWeapon) this.throwHeld({ x: 0, y: 0.2, z: 1 });
    if (this.heldProp && this.heldProp !== prop) this.throwHeld({ x: 0, y: 0.2, z: 1 });
    this.heldProp = prop;
    prop.hold();
    this.emit();
  }

  private pulseMagnet(source: SandboxProp): void {
    const t = source.translation;
    for (const other of this.liveProps) {
      if (other === source || !other.active) continue;
      const p = other.translation;
      const dx = t.x - p.x;
      const dy = t.y - p.y;
      const dz = t.z - p.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 0.25 || dist > 5.8) continue;
      const pull = 22 / dist;
      other.applyImpulse({ x: dx / dist, y: dy / dist + 0.15, z: dz / dist }, pull);
    }
  }

  private throwHeld(dir: Vec3): void {
    if (this.heldWeapon) {
      const weapon = this.heldWeapon;
      this.heldWeapon = null;
      weapon.throw(dir);
    }
    if (this.heldProp) {
      const prop = this.heldProp;
      this.heldProp = null;
      prop.throw(dir);
    }
    this.emit();
  }

  private acquireWeapon(): SandboxWeapon {
    let weapon = this.weaponPool.find((w) => !w.active);
    if (!weapon) {
      weapon = new SandboxWeapon(this.rapier, this.world);
      this.weaponPool.push(weapon);
      this.root.add(weapon.root);
      weapon.onImpact = (x, y, z, nx, ny, nz, speed) => this.onImpact?.(x, y, z, nx, ny, nz, speed);
    }
    this.liveWeapons.push(weapon);
    return weapon;
  }

  private acquireProp(): SandboxProp {
    let prop = this.propPool.find((p) => !p.active);
    if (!prop) {
      prop = new SandboxProp(this.rapier, this.world);
      this.propPool.push(prop);
      this.root.add(prop.root);
      prop.onImpact = (x, y, z, nx, ny, nz, speed) => this.onImpact?.(x, y, z, nx, ny, nz, speed);
      prop.onBump = (kind, x, y, z, speed) => this.onPropBump?.(kind, x, y, z, speed);
    }
    this.liveProps.push(prop);
    return prop;
  }

  private removeOldestWeapon(): void {
    let oldest = this.liveWeapons[0];
    if (!oldest) return;
    for (const weapon of this.liveWeapons) {
      if (weapon.spawnedAt < oldest.spawnedAt) oldest = weapon;
    }
    this.removeWeapon(oldest);
  }

  private removeOldestProp(): void {
    let oldest = this.liveProps[0];
    if (!oldest) return;
    for (const prop of this.liveProps) {
      if (prop.spawnedAt < oldest.spawnedAt) oldest = prop;
    }
    this.removeProp(oldest);
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

    const now = performance.now() / 1000;
    this.thinkFrame += 1;
    while (this.noises.length > 0 && now - this.noises[0]!.at > 2.2) this.noises.shift();
    const others = this.live
      .filter((n) => n.active && !n.dead)
      .map((n) => {
        const p = n.position;
        return { x: p.x, z: p.z, id: n.id };
      });
    const world: BrainWorld = {
      player: { x: ctx.playerPos.x, z: ctx.playerPos.z },
      playerAlive: true,
      noises: this.noises,
      others,
      now,
      dt: ctx.dt,
    };

    for (const npc of this.live) {
      const p = npc.position;
      const dist = Math.hypot(p.x - ctx.camera.position.x, p.y - ctx.camera.position.y, p.z - ctx.camera.position.z);
      npc.setCameraDistance(dist);
      const near = dist < 42;
      const stagger = near ? 1 : 3;
      if (near || npc.id % stagger === this.thinkFrame % stagger) {
        npc.think(this.nav, world);
      }
      npc.update(ctx.dt);
    }
    this.cleanupCorpses();
    for (const weapon of this.liveWeapons) {
      weapon.update(ctx.dt, ctx.camera);
      weapon.contactsNpc((npcId, part, impulse) => {
        const npc = this.live.find((n) => n.id === npcId);
        npc?.enterRagdoll(impulse, (part === 'locator' ? 'torso' : part) as NpcPartId);
        const p = weapon.translation;
        this.onImpact?.(p.x, p.y, p.z, 0, 1, 0, Math.hypot(impulse.x, impulse.y, impulse.z));
        this.emit();
      });
    }
    for (const prop of this.liveProps) prop.update();

    if (this.heldWeapon?.active) {
      const hold = {
        x: ctx.camera.position.x + ctx.aimDir.x * 1.15,
        y: ctx.camera.position.y + ctx.aimDir.y * 1.15 - 0.12,
        z: ctx.camera.position.z + ctx.aimDir.z * 1.15,
      };
      this.heldWeapon.follow(hold, Math.atan2(-ctx.aimDir.x, -ctx.aimDir.z));
    } else if (this.heldWeapon && !this.heldWeapon.active) {
      this.heldWeapon = null;
    }

    if (this.heldProp?.active) {
      const hold = {
        x: ctx.camera.position.x + ctx.aimDir.x * 1.35,
        y: ctx.camera.position.y + ctx.aimDir.y * 1.35 - 0.08,
        z: ctx.camera.position.z + ctx.aimDir.z * 1.35,
      };
      this.heldProp.follow(hold, Math.atan2(-ctx.aimDir.x, -ctx.aimDir.z));
    } else if (this.heldProp && !this.heldProp.active) {
      this.heldProp = null;
    }

    const lookOrigin = {
      x: ctx.camera.position.x,
      y: ctx.camera.position.y,
      z: ctx.camera.position.z,
    };
    const dir = ctx.cursorMode ? this.dirFromNdc(ctx.camera) : ctx.aimDir;
    const origin = lookOrigin;

    let spawnPoint: { x: number; y: number; z: number } | null = null;
    if (this.tool === 'spawn' || this.tool === 'spawnWeapon' || this.showsToolGunGhost()) {
      spawnPoint = this.groundPoint(origin, dir);
      if (spawnPoint) {
        this.marker.visible = this.tool !== 'toolGun';
        this.marker.position.set(spawnPoint.x, spawnPoint.y + 0.02, spawnPoint.z);
      } else {
        this.marker.visible = false;
      }
      const yaw = Math.atan2(-dir.x, -dir.z);
      const ghost = this.showsToolGunGhost() && !this.menuOpen;
      this.preview.update(ghost ? spawnPoint : null, yaw, ghost);
    } else {
      this.marker.visible = false;
      this.preview.update(null, 0, false);
    }

    const hover = this.pickNpc(ctx.camera, origin, dir);
    if (this.hovered !== hover) {
      this.hovered?.setHovered(false);
      hover?.setHovered(true);
      this.hovered = hover ?? null;
    }
    this.lookProp = this.pickProp(ctx.camera, origin, dir);
    this.lookWeapon = this.pickWeapon(ctx.camera, origin, dir);
    this.lookHint = this.resolveLookHint(ctx.camera, origin, dir, hover, spawnPoint);

    if (this.selected && !this.selected.active) this.selected = null;
  }

  get hoveredNpc(): SandboxNpc | null {
    return this.hovered;
  }

  get aimedWeapon(): SandboxWeapon | null {
    return this.lookWeapon;
  }

  inspectLookTarget(): boolean {
    if (!this.hovered?.active) return false;
    this.select(this.hovered);
    return true;
  }

  interactLookProp(dir: Vec3): PropInteractResult | null {
    const prop = this.lookProp;
    if (!prop?.active) return null;
    const result = prop.interact(dir);
    if (result.magnet) this.pulseMagnet(prop);
    this.emit();
    return result;
  }

  lookPropPrompt(): string | null {
    if (!this.lookProp?.active) return null;
    return interactPromptFor(this.lookProp.kind);
  }

  lookWeaponPrompt(): string | null {
    if (!this.lookWeapon?.active) return null;
    return 'E  pick up';
  }

  takeLookWeapon(origin: Vec3, maxDistance = 3): SandboxWeaponKind | null {
    const weapon = this.lookWeapon;
    if (!weapon?.active) return null;
    const t = weapon.translation;
    if (Math.hypot(t.x - origin.x, t.y - origin.y, t.z - origin.z) > maxDistance) return null;
    const kind = weapon.kind;
    this.removeWeapon(weapon);
    return kind;
  }

  dispose(): void {
    this.removeAllNpcs();
    this.removeAllWeapons();
    this.removeAllProps();
    for (const npc of this.pool) npc.dispose();
    this.pool.length = 0;
    for (const weapon of this.weaponPool) weapon.dispose();
    this.weaponPool.length = 0;
    for (const prop of this.propPool) prop.dispose();
    this.propPool.length = 0;
    this.assets.dispose();
    this.preview.dispose();
    (this.marker.material as THREE.Material).dispose();
    this.marker.geometry.dispose();
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
      this.bindNpc(npc);
    }
    this.live.push(npc);
    return npc;
  }

  private warmPool(count: number): void {
    for (let i = 0; i < count; i++) {
      const npc = new SandboxNpc(this.rapier, this.world, this.assets, Math.random);
      this.pool.push(npc);
      this.bindNpc(npc);
    }
  }

  private bindNpc(npc: SandboxNpc): void {
    this.root.add(npc.root);
    npc.onImpact = (x, y, z, nx, ny, nz, speed) => {
      this.onImpact?.(x, y, z, nx, ny, nz, speed);
    };
    npc.onHit = (x, y, z, nx, ny, nz, zone, killed, attach) => {
      this.onNpcHit?.(x, y, z, nx, ny, nz, zone, killed, attach);
    };
    npc.onBloodContact = (x, y, z, nx, ny, nz) => {
      this.onBloodContact?.(x, y, z, nx, ny, nz);
    };
  }

  private async bootHumanoids(): Promise<void> {
    await preloadNpcHumanoid();
  }

  private cleanupCorpses(): void {
    if (!this.settings.autoCleanup) return;
    const now = performance.now();
    const expired = this.live.filter((npc) => npc.dead && now - npc.corpseAt > RAGDOLL.corpseSec * 1000);
    for (const npc of expired) this.removeNpc(npc);
    this.trimRagdolls();
  }

  private trimRagdolls(): void {
    const ragdolls = this.live.filter((npc) => npc.npcState === 'Ragdoll' || npc.dead);
    while (ragdolls.length > RAGDOLL.maxLiveRagdolls) {
      let oldest = ragdolls[0]!;
      for (const npc of ragdolls) {
        if (npc.dead && !oldest.dead) oldest = npc;
        else if (npc.dead === oldest.dead && npc.spawnedAt < oldest.spawnedAt) oldest = npc;
      }
      this.removeNpc(oldest);
      const idx = ragdolls.indexOf(oldest);
      if (idx >= 0) ragdolls.splice(idx, 1);
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

  private collectBloodSurfaces(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
  ): Array<{ x: number; y: number; z: number; nx: number; ny: number; nz: number }> {
    const hits: Array<{ x: number; y: number; z: number; nx: number; ny: number; nz: number }> = [];
    const start = {
      x: origin.x + dir.x * 0.1,
      y: origin.y + dir.y * 0.1,
      z: origin.z + dir.z * 0.1,
    };
    const wall = this.world.castRayAndGetNormal(
      new this.rapier.Ray(start, dir),
      2.6,
      true,
      undefined,
      SPAWN_FILTER,
      this.playerCollider,
    );
    if (wall) {
      const toi = wall.timeOfImpact;
      const n = wall.normal;
      hits.push({
        x: start.x + dir.x * toi,
        y: start.y + dir.y * toi,
        z: start.z + dir.z * toi,
        nx: n.x,
        ny: n.y,
        nz: n.z,
      });
    }
    const down = { x: 0, y: -1, z: 0 };
    const gStart = { x: origin.x, y: origin.y + 0.15, z: origin.z };
    const ground = this.world.castRayAndGetNormal(
      new this.rapier.Ray(gStart, down),
      2.5,
      true,
      undefined,
      SPAWN_FILTER,
      this.playerCollider,
    );
    if (ground && ground.timeOfImpact < 2.2) {
      const toi = ground.timeOfImpact;
      const n = ground.normal;
      hits.push({
        x: gStart.x,
        y: gStart.y + down.y * toi,
        z: gStart.z,
        nx: n.x,
        ny: n.y,
        nz: n.z,
      });
    }
    return hits;
  }

  private syncMarkerVisibility(): void {
    this.marker.visible = this.tool === 'spawn' || this.tool === 'spawnWeapon';
  }

  private showsToolGunGhost(): boolean {
    if (this.tool !== 'toolGun' || this.menuOpen) return false;
    const cat = this.selection.category;
    return cat === 'npc' || isPropCategory(cat) || cat === 'weapons';
  }

  private resolveLookHint(
    camera: THREE.Camera,
    origin: Vec3,
    dir: Vec3,
    npc: SandboxNpc | null,
    spawnPoint: { x: number; y: number; z: number } | null,
  ): 'none' | 'npc' | 'prop' | 'weapon' | 'spawn' {
    if (this.menuOpen || this.tool !== 'toolGun') return npc ? 'npc' : 'none';
    if (npc) return 'npc';
    if (this.pickWeapon(camera, origin, dir)) return 'weapon';
    if (this.pickProp(camera, origin, dir)) return 'prop';
    if (this.selection.spawnable && spawnPoint) return 'spawn';
    return 'none';
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

  private pickWeapon(camera: THREE.Camera, origin: Vec3, dir: Vec3): SandboxWeapon | null {
    if (this.cursorMode) {
      raycaster.setFromCamera(ndc.set(this.lastPointer.x, this.lastPointer.y), camera);
    } else {
      raycaster.set(pickOrigin.set(origin.x, origin.y, origin.z), pickDir.set(dir.x, dir.y, dir.z));
    }
    const hits = raycaster.intersectObjects(
      this.liveWeapons.map((w) => w.root),
      true,
    );
    if (hits.length === 0) return null;
    const obj = hits[0]!.object;
    return this.liveWeapons.find((w) => w.matchesObject(obj)) ?? null;
  }

  private pickProp(camera: THREE.Camera, origin: Vec3, dir: Vec3): SandboxProp | null {
    if (this.cursorMode) {
      raycaster.setFromCamera(ndc.set(this.lastPointer.x, this.lastPointer.y), camera);
    } else {
      raycaster.set(pickOrigin.set(origin.x, origin.y, origin.z), pickDir.set(dir.x, dir.y, dir.z));
    }
    const hits = raycaster.intersectObjects(
      this.liveProps.map((p) => p.root),
      true,
    );
    if (hits.length === 0) return null;
    const obj = hits[0]!.object;
    return this.liveProps.find((p) => p.matchesObject(obj)) ?? null;
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

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import {
  NPC_HEAD_CRITICAL_DAMAGE,
  NPC_MAX_HEALTH,
  SANDBOX_GROUPS,
  SANDBOX_HITBOX_GROUPS,
  SANDBOX_PHYSICAL_GROUPS,
  npcZoneForPart,
} from '@ragelab/shared';
import {
  PART_IDS,
  PART_PHYSICS,
  RAGDOLL,
  type NpcPartId,
  type NpcState,
  type PartPhysDef,
  type RagdollStyle,
} from './types';
import {
  idlePose,
  limpPose,
  walkPose,
  type BuiltNpcVisual,
  type LimbPose,
  type SharedNpcAssets,
  buildNpcVisual,
  randomNpcLook,
} from './npcModel';
import {
  driveBonesFromParts,
  instantiateNpcHumanoid,
  pickNpcKind,
  type NpcGltfInstance,
} from './npcGltf';
import type { CharacterKind, LocoClip } from '../characters/skinnedHumanoid';
import { preloadCharacter } from '../characters/skinnedHumanoid';
import { NpcBrain, type BrainWorld, type MoveCommand } from '../ai/npcBrain';
import type { NavGrid } from '../ai/navGrid';

export interface NpcUserData {
  kind: 'sandboxNpc';
  npcId: number;
  part: NpcPartId | 'locator';
}

interface PartBody {
  id: NpcPartId;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
/** Locator capsule sits this far above the visual feet. */
const LOCATOR_Y = 0.9;

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

let nextId = 1;

export class SandboxNpc {
  readonly id: number;
  readonly root: THREE.Group;
  spawnedAt = 0;

  private readonly visual: BuiltNpcVisual;
  private readonly rapier: typeof RAPIER;
  private readonly world: RAPIER.World;

  private locator!: RAPIER.RigidBody;
  private locatorCollider!: RAPIER.Collider;
  private parts = new Map<NpcPartId, PartBody>();
  private joints: RAPIER.ImpulseJoint[] = [];

  private state: NpcState = 'Idle';
  private yaw = 0;
  private phase = Math.random() * Math.PI * 2;
  private recoverTimer = 0;
  private stillTimer = 0;
  private feet = { x: 0, y: 0, z: 0 };
  private readonly pose: LimbPose = idlePose();
  private alive = false;
  private gltf: NpcGltfInstance | null = null;
  private lastSpeed = 0;
  private impactCool = 0;
  private flinch = 0;
  private flinchPart: NpcPartId | null = null;
  private stagger = 0;
  private limpSide: -1 | 0 | 1 = 0;
  private windup = 0;
  private windupImpulse: { x: number; y: number; z: number } | null = null;
  private windupPart: NpcPartId = 'torso';
  private windupStyle: RagdollStyle = 'drop';
  private windupPoint: { x: number; y: number; z: number } | null = null;
  private tenseHold = 0;
  private recoverStillNeed = RAGDOLL.recoverStillSec as number;
  private camDist = 0;
  health = NPC_MAX_HEALTH;
  dead = false;
  corpseAt = 0;
  private kind: CharacterKind;
  onImpact: ((x: number, y: number, z: number, nx: number, ny: number, nz: number, speed: number) => void) | null =
    null;
  onHit:
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
  readonly brain = new NpcBrain(() => Math.random());
  private cmd: MoveCommand = { yaw: 0, speed: 0, clip: 'idle' };

  constructor(
    rapier: typeof RAPIER,
    world: RAPIER.World,
    assets: SharedNpcAssets,
    rng: () => number,
  ) {
    this.id = nextId++;
    this.rapier = rapier;
    this.world = world;
    this.kind = pickNpcKind(rng);
    this.visual = buildNpcVisual(assets, randomNpcLook(rng));
    this.root = this.visual.root;
    this.root.visible = false;
    for (const part of Object.values(this.visual.parts)) {
      part.mesh.visible = false;
      part.group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) mesh.visible = false;
      });
    }
    this.buildPhysics();
    this.setPhysicsEnabled(false);
    void preloadCharacter(this.kind).then(() => {
      if (this.alive) this.attachHumanoid();
    });
  }

  get npcState(): NpcState {
    return this.state;
  }

  get behavior(): string {
    return this.brain.behavior;
  }

  think(nav: NavGrid, world: BrainWorld): void {
    if (!this.alive) return;
    if (
      this.dead ||
      this.windup > 0 ||
      this.state === 'Ragdoll' ||
      this.state === 'Dead' ||
      this.state === 'Recovering'
    ) {
      if (this.dead) this.brain.markDead();
      this.cmd = { yaw: this.yaw, speed: 0, clip: 'idle' };
      return;
    }
    this.cmd = this.brain.tick(nav, this.feet.x, this.feet.z, this.health, world);
    if (this.limpSide !== 0 && this.cmd.clip === 'run') {
      this.cmd = { ...this.cmd, clip: 'walk' };
    }
    let pushX = 0;
    let pushZ = 0;
    for (const o of world.others) {
      if (o.id === this.id) continue;
      const dx = this.feet.x - o.x;
      const dz = this.feet.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.2 && d > 0.05) {
        const w = (1.2 - d) / 1.2;
        pushX += (dx / d) * w;
        pushZ += (dz / d) * w;
      }
    }
    if (pushX !== 0 || pushZ !== 0) {
      const away = Math.atan2(-pushX, -pushZ);
      this.cmd = { ...this.cmd, yaw: dampAngle(this.cmd.yaw, away, 0.38) };
    }
  }

  get active(): boolean {
    return this.alive;
  }

  get position(): THREE.Vector3 {
    tmpPos.set(this.feet.x, this.feet.y, this.feet.z);
    return tmpPos;
  }

  get massKg(): number {
    let sum = 8;
    for (const id of PART_IDS) sum += PART_PHYSICS[id].mass;
    return sum;
  }

  get speed(): number {
    if (this.state === 'Ragdoll' || this.state === 'Dead') {
      const pelvis = this.parts.get('pelvis')?.body;
      if (!pelvis) return 0;
      const v = pelvis.linvel();
      return Math.hypot(v.x, v.y, v.z);
    }
    const v = this.locator.linvel();
    return Math.hypot(v.x, v.z);
  }

  spawn(x: number, y: number, z: number, yaw: number, ragdoll: boolean): void {
    this.spawnedAt = performance.now();
    this.alive = true;
    this.dead = false;
    this.health = NPC_MAX_HEALTH;
    this.corpseAt = 0;
    this.flinch = 0;
    this.flinchPart = null;
    this.stagger = 0;
    this.limpSide = 0;
    this.windup = 0;
    this.windupImpulse = null;
    this.tenseHold = 0;
    this.kind = pickNpcKind(() => Math.random());
    Object.assign(this.visual.look, randomNpcLook(() => Math.random()));
    this.gltf?.character.dispose();
    this.gltf = null;
    this.root.visible = true;
    this.yaw = yaw;
    this.cmd = { yaw, speed: 0, clip: 'idle' };
    this.brain.reset(x, z);
    this.feet = { x, y, z };
    this.phase = Math.random() * Math.PI * 2;
    this.stillTimer = 0;
    this.recoverTimer = 0;

    this.placeLocator(x, y, z, true);
    this.applyFk(idlePose(), 1);
    this.snapRagdollToVisual();
    this.attachHumanoid();
    this.lastSpeed = 0;

    if (ragdoll) {
      this.enterRagdoll({ x: (Math.random() - 0.5) * 2, y: 1.2, z: (Math.random() - 0.5) * 2 });
    } else {
      this.enterLocomotion(y > 0.4 ? 'Falling' : 'Idle');
    }
  }

  despawn(): void {
    if (!this.alive) return;
    this.alive = false;
    this.dead = false;
    this.health = NPC_MAX_HEALTH;
    this.gltf?.character.stop();
    this.root.visible = false;
    this.setPhysicsEnabled(false);
    this.locator.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.locator.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  resetToSpawnPose(): void {
    if (!this.alive) return;
    this.dead = false;
    this.health = NPC_MAX_HEALTH;
    this.corpseAt = 0;
    this.limpSide = 0;
    this.stagger = 0;
    this.flinch = 0;
    this.flinchPart = null;
    this.windup = 0;
    this.windupImpulse = null;
    this.tenseHold = 0;
    if (this.state === 'Ragdoll' || this.state === 'Dead') {
      const pelvis = this.parts.get('pelvis')?.body.translation();
      if (pelvis) this.feet = { x: pelvis.x, y: Math.max(0, pelvis.y - 0.98), z: pelvis.z };
    } else {
      const t = this.locator.translation();
      this.feet = { x: t.x, y: Math.max(0, t.y - LOCATOR_Y), z: t.z };
    }
    this.enterLocomotion('Idle');
    this.applyFk(idlePose(), 1);
    this.snapRagdollToVisual();
    this.driveGltf(0);
  }

  enterRagdoll(
    impulse?: { x: number; y: number; z: number },
    atPart: NpcPartId = 'torso',
    style: RagdollStyle = 'drop',
    hitPoint?: { x: number; y: number; z: number },
    recoverSec?: number,
  ): void {
    if (!this.alive) return;
    this.windup = 0;
    this.windupImpulse = null;
    this.gltf?.character.stop();
    this.snapRagdollToVisual();
    this.setLocatorEnabled(false);
    this.setRagdollEnabled(true);
    this.recoverStillNeed = this.dead ? 999 : (recoverSec ?? RAGDOLL.recoverStillSec);
    this.tenseHold = style === 'tense' ? 0.11 + Math.random() * 0.08 : 0;
    const locVel = this.locator.linvel();
    for (const [id, part] of this.parts) {
      const def = PART_PHYSICS[id];
      const ang = this.tenseHold > 0 ? 3.4 : (def.angularDamping ?? RAGDOLL.angularDamping);
      part.body.setLinearDamping(def.linearDamping ?? RAGDOLL.linearDamping);
      part.body.setAngularDamping(ang);
      part.body.setLinvel({ x: locVel.x, y: locVel.y, z: locVel.z }, true);
      part.body.wakeUp();
    }
    if (impulse) this.applyRagdollForces(impulse, atPart, style, hitPoint);
    this.state = this.dead ? 'Dead' : 'Ragdoll';
    this.stillTimer = 0;
    this.lastSpeed = Math.hypot(locVel.x, locVel.y, locVel.z);
    this.emitImpact(6 + (impulse ? Math.hypot(impulse.x, impulse.y, impulse.z) * 0.2 : 0));
  }

  setSelected(_selected: boolean): void {
    /* Hover/select used to tint Mixamo visor emissive into a bright square. */
  }

  setHovered(_hovered: boolean): void {
    /* Interaction via E / Tool Gun pick still uses controller.hovered. */
  }

  applyShot(dir: { x: number; y: number; z: number }, part: NpcPartId, strength: number): void {
    this.enterRagdoll(
      { x: dir.x * strength, y: dir.y * strength + 2, z: dir.z * strength },
      part,
      pickRagdollStyle('chest', true),
    );
  }

  applyHit(
    dir: { x: number; y: number; z: number },
    part: NpcPartId,
    damage: number,
    impulse: number,
    hitPoint?: { x: number; y: number; z: number },
  ): { killed: boolean; zone: string; health: number; alreadyDead: boolean } {
    const zone = npcZoneForPart(part);
    const origin = hitPoint ?? this.hitWorldPoint(part);
    const attach = this.hitAttach(part);

    if (this.dead) {
      const corpse = impulse * 0.42;
      this.applyRagdollForces(
        { x: dir.x * corpse, y: dir.y * corpse + 1.1, z: dir.z * corpse },
        part,
        pickRagdollStyle(zone, true),
        origin,
      );
      this.onHit?.(origin.x, origin.y, origin.z, -dir.x, -dir.y, -dir.z, zone, false, attach);
      return { killed: false, zone, health: 0, alreadyDead: true };
    }

    if (zone === 'head' && damage >= NPC_HEAD_CRITICAL_DAMAGE) this.health = 0;
    else this.health = Math.max(0, this.health - damage);

    this.flinchPart = part;
    this.brain.noticeShot(origin.x, origin.z, this.feet.x, this.feet.z, performance.now() / 1000);

    const killed = this.health <= 0;
    const scale = killed ? RAGDOLL.deathImpulse / 3.2 : zoneImpulseScale(zone);
    const shot = {
      x: dir.x * impulse * scale,
      y: dir.y * impulse * scale + (killed ? 2.6 : 1.15),
      z: dir.z * impulse * scale,
    };

    if (killed) {
      this.killFromHit(shot, part, zone, origin);
      this.onHit?.(origin.x, origin.y, origin.z, -dir.x, -dir.y, -dir.z, zone, true, attach);
      return { killed: true, zone, health: 0, alreadyDead: false };
    }

    this.reactLiving(dir, part, zone, damage, shot, origin);
    this.onHit?.(origin.x, origin.y, origin.z, -dir.x, -dir.y, -dir.z, zone, false, attach);
    return { killed: false, zone, health: this.health, alreadyDead: false };
  }

  private killFromHit(
    shot: { x: number; y: number; z: number },
    part: NpcPartId,
    zone: string,
    origin: { x: number; y: number; z: number },
  ): void {
    this.dead = true;
    this.corpseAt = performance.now();
    this.brain.markDead();
    const style = pickRagdollStyle(zone, true);
    if (style === 'tense') {
      this.windup = 0.09 + Math.random() * 0.1;
      this.windupImpulse = shot;
      this.windupPart = part;
      this.windupStyle = 'tense';
      this.windupPoint = origin;
      this.gltf?.character.play('idle', 0.04, 0.08);
      return;
    }
    this.enterRagdoll(shot, part, style, origin);
  }

  private reactLiving(
    dir: { x: number; y: number; z: number },
    part: NpcPartId,
    zone: string,
    damage: number,
    shot: { x: number; y: number; z: number },
    origin: { x: number; y: number; z: number },
  ): void {
    const v = this.locator.linvel();
    if (zone === 'leg') {
      this.limpSide = part.includes('L') ? -1 : 1;
      this.flinch = 0.42;
      this.stagger = 0.28;
      const fall = damage >= 26 || Math.random() < 0.38 + damage / 160;
      if (fall && this.state !== 'Ragdoll') {
        this.enterRagdoll(
          { x: shot.x * 0.38, y: 1.4, z: shot.z * 0.38 },
          part,
          Math.random() < 0.5 ? 'crumple' : 'drop',
          origin,
          RAGDOLL.knockdownStillSec,
        );
        return;
      }
      this.locator.setLinvel({ x: v.x + dir.x * 2.4, y: v.y + 0.55, z: v.z + dir.z * 2.4 }, true);
      return;
    }
    if (zone === 'arm') {
      this.flinch = 0.32;
      this.stagger = 0.22;
      this.yaw += (part.includes('L') ? -1 : 1) * (0.18 + Math.random() * 0.12);
      this.locator.setLinvel({ x: v.x + dir.x * 1.35, y: v.y + 0.12, z: v.z + dir.z * 1.35 }, true);
      if (damage >= 36 && Math.random() < 0.22) {
        this.enterRagdoll(
          { x: shot.x * 0.45, y: shot.y * 0.35, z: shot.z * 0.45 },
          part,
          'spin',
          origin,
          RAGDOLL.knockdownStillSec,
        );
      }
      return;
    }
    if (zone === 'chest') {
      this.flinch = 0.36;
      this.stagger = 0.2;
      this.locator.setLinvel({ x: v.x + dir.x * 2.1, y: v.y + 0.35, z: v.z + dir.z * 2.1 }, true);
      if (damage >= 40 && Math.random() < 0.28) {
        this.enterRagdoll(shot, part, pickRagdollStyle(zone, false), origin, RAGDOLL.knockdownStillSec);
      }
      return;
    }
    this.flinch = 0.26;
    this.stagger = 0.16;
    this.locator.setLinvel({ x: v.x + dir.x * 1.7, y: v.y + 0.22, z: v.z + dir.z * 1.7 }, true);
    if (damage >= 44 && Math.random() < 0.2) {
      this.enterRagdoll(
        { x: shot.x * 0.7, y: shot.y * 0.55, z: shot.z * 0.7 },
        part,
        'drop',
        origin,
        RAGDOLL.knockdownStillSec,
      );
    }
  }

  private applyRagdollForces(
    impulse: { x: number; y: number; z: number },
    atPart: NpcPartId,
    style: RagdollStyle,
    hitPoint?: { x: number; y: number; z: number },
  ): void {
    const planar = style === 'crumple' ? 0.58 : 1;
    const linear = {
      x: impulse.x * planar,
      y: style === 'crumple' ? impulse.y * 0.28 - 5.2 : impulse.y,
      z: impulse.z * planar,
    };
    const target = this.parts.get(atPart)?.body ?? this.parts.get('torso')?.body;
    if (!target) return;
    target.applyImpulse(linear, true);
    if (hitPoint) {
      const t = target.translation();
      target.applyTorqueImpulse(
        {
          x: (hitPoint.y - t.y) * linear.z - (hitPoint.z - t.z) * linear.y,
          y: (hitPoint.z - t.z) * linear.x - (hitPoint.x - t.x) * linear.z,
          z: (hitPoint.x - t.x) * linear.y - (hitPoint.y - t.y) * linear.x,
        },
        true,
      );
    }
    if (style === 'spin') {
      this.parts.get('torso')?.body.applyTorqueImpulse(
        {
          x: (Math.random() - 0.5) * 9,
          y: (Math.random() - 0.5) * 14,
          z: (Math.random() - 0.5) * 9,
        },
        true,
      );
    }
    if (style === 'whip') {
      this.parts.get('head')?.body.applyImpulse(
        { x: linear.x * 0.28, y: 3.6, z: linear.z * 0.28 },
        true,
      );
    }
    if (style === 'drop') {
      this.parts.get('pelvis')?.body.applyImpulse({ x: 0, y: -2.4, z: 0 }, true);
    }
  }

  hitAttach(part: NpcPartId): THREE.Object3D | null {
    return this.gltf?.character.bones[part] ?? this.gltf?.character.root ?? this.visual.parts[part]?.group ?? null;
  }

  private hitWorldPoint(part: NpcPartId): { x: number; y: number; z: number } {
    const bone = this.gltf?.character.bones[part];
    if (bone) {
      bone.getWorldPosition(tmpPos);
      return { x: tmpPos.x, y: tmpPos.y, z: tmpPos.z };
    }
    const group = this.visual.parts[part]?.group;
    if (group) return { x: group.position.x, y: group.position.y, z: group.position.z };
    return { x: this.feet.x, y: this.feet.y + 1.1, z: this.feet.z };
  }

  matchesObject(obj: THREE.Object3D): boolean {
    let cursor: THREE.Object3D | null = obj;
    while (cursor) {
      if (cursor === this.root) return true;
      cursor = cursor.parent;
    }
    return false;
  }

  setCameraDistance(dist: number): void {
    this.camDist = dist;
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.flinch = Math.max(0, this.flinch - dt);
    this.stagger = Math.max(0, this.stagger - dt);

    if (this.windup > 0) {
      this.windup -= dt;
      const v = this.locator.linvel();
      this.locator.setLinvel({ x: v.x * 0.2, y: v.y, z: v.z * 0.2 }, true);
      this.applyFk(idlePose(), 1);
      this.snapRagdollToVisual();
      this.driveGltf(dt);
      if (this.windup <= 0 && this.windupImpulse) {
        const impulse = this.windupImpulse;
        const part = this.windupPart;
        const style = this.windupStyle;
        const point = this.windupPoint ?? undefined;
        this.windupImpulse = null;
        this.enterRagdoll(impulse, part, style, point);
      }
      return;
    }

    if (this.state === 'Ragdoll' || this.state === 'Dead') {
      if (this.tenseHold > 0) {
        this.tenseHold -= dt;
        if (this.tenseHold <= 0) {
          for (const [id, part] of this.parts) {
            const def = PART_PHYSICS[id];
            part.body.setAngularDamping(def.angularDamping ?? RAGDOLL.angularDamping);
          }
        }
      }
      this.syncVisualFromRagdoll();
      this.driveGltf(dt);
      this.sampleImpact(dt);
      const pelvis = this.parts.get('pelvis')?.body;
      if (pelvis) {
        const t = pelvis.translation();
        this.feet.x = t.x;
        this.feet.y = Math.max(0, t.y - 0.98);
        this.feet.z = t.z;
        const v = pelvis.linvel();
        const speed = Math.hypot(v.x, v.y, v.z);
        this.stillTimer = speed < 0.55 ? this.stillTimer + dt : 0;
        if (!this.dead && this.stillTimer > this.recoverStillNeed) this.beginRecover();
      }
      return;
    }

    if (this.state === 'Recovering') {
      this.recoverTimer += dt;
      const k = Math.min(1, this.recoverTimer / RAGDOLL.recoverBlendSec);
      const pose = this.limpSide !== 0 ? limpPose(this.phase, 0.2, this.limpSide) : idlePose();
      this.applyFk(pose, k);
      this.driveGltf(dt);
      if (k >= 1) this.enterLocomotion('Idle');
      return;
    }

    this.stepLocomotion(dt);
    const grounded = this.isGrounded();
    const v = this.locator.linvel();
    const planar = Math.hypot(v.x, v.z);

    if (!grounded && v.y < -0.4) this.state = 'Falling';
    else if (grounded && this.state === 'Falling') {
      if (Math.abs(v.y) > RAGDOLL.ragdollImpactSpeed) {
        this.enterRagdoll({ x: v.x * 0.4, y: 0, z: v.z * 0.4 }, 'pelvis', 'crumple');
        return;
      }
      this.state = planar > 0.4 ? 'Walking' : 'Idle';
    } else if (grounded) {
      this.state = planar > 0.35 ? 'Walking' : 'Idle';
    }

    this.phase += dt * (this.state === 'Walking' ? (this.limpSide !== 0 ? 5.4 : 7.2) : 1.6);
    const stride = this.state === 'Walking' ? Math.min(1, planar / RAGDOLL.walkSpeed) : 0.15;
    let target =
      this.state === 'Walking'
        ? this.limpSide !== 0
          ? limpPose(this.phase, stride, this.limpSide)
          : walkPose(this.phase, stride)
        : idlePose();
    if (this.flinch > 0 && this.flinchPart) target = flinchPose(target, this.flinchPart, this.flinch);
    blendPose(this.pose, target, 1 - Math.exp(-14 * dt));
    this.applyFk(this.pose, 1);
    this.snapRagdollToVisual();
    this.driveGltf(dt);
    this.sampleImpact(dt);
  }

  dispose(): void {
    this.despawn();
    for (const joint of this.joints) {
      if (joint.isValid()) this.world.removeImpulseJoint(joint, false);
    }
    this.joints.length = 0;
    for (const part of this.parts.values()) {
      if (part.body.isValid()) this.world.removeRigidBody(part.body);
    }
    this.parts.clear();
    if (this.locator.isValid()) this.world.removeRigidBody(this.locator);
    this.gltf?.character.dispose();
    this.gltf = null;
    for (const mat of this.visual.materials) mat.dispose();
    this.root.removeFromParent();
  }

  private beginRecover(): void {
    if (this.dead) return;
    this.syncVisualFromRagdoll();
    const pelvis = this.parts.get('pelvis')?.body;
    if (pelvis) {
      const t = pelvis.translation();
      this.feet = { x: t.x, y: Math.max(0, t.y - 0.98), z: t.z };
    }
    this.setRagdollEnabled(false);
    this.placeLocator(this.feet.x, this.feet.y, this.feet.z, true);
    this.setLocatorEnabled(true);
    this.state = 'Recovering';
    this.recoverTimer = 0;
  }

  private enterLocomotion(state: NpcState): void {
    this.setRagdollEnabled(false);
    this.placeLocator(this.feet.x, this.feet.y, this.feet.z, true);
    this.setLocatorEnabled(true);
    this.locator.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.state = state;
  }

  private stepLocomotion(dt: number): void {
    const turn = signedAngle(this.yaw, this.cmd.yaw);
    const maxTurn = 4.6 * dt;
    this.yaw += clampNum(turn, -maxTurn, maxTurn);
    if (this.limpSide !== 0 && this.state === 'Walking') {
      this.yaw += Math.sin(this.phase * 0.9) * this.limpSide * 0.014;
    }
    const grounded = this.isGrounded();
    const wounded = this.health < 45;
    let speed = this.cmd.speed;
    if (this.limpSide !== 0) speed *= RAGDOLL.limpSpeed;
    else if (wounded) speed *= 0.58;
    if (this.stagger > 0) speed *= 0.35;
    if (this.flinch > 0.12) speed *= 0.55;
    const facing = Math.cos(signedAngle(this.yaw, this.cmd.yaw));
    if (facing < 0.25) speed *= 0.08;
    else speed *= Math.max(0.35, facing);
    if (this.state === 'Falling' || !grounded) speed = 0;
    const vx = -Math.sin(this.yaw) * speed;
    const vz = -Math.cos(this.yaw) * speed;
    const vy = this.locator.linvel().y;
    this.locator.setLinvel({ x: vx, y: vy, z: vz }, true);

    const t = this.locator.translation();
    this.feet.x = t.x;
    this.feet.y = t.y - LOCATOR_Y;
    this.feet.z = t.z;
  }

  private isGrounded(): boolean {
    const t = this.locator.translation();
    const ray = new this.rapier.Ray({ x: t.x, y: t.y + 0.2, z: t.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 1.15, true, undefined, undefined, this.locatorCollider);
    return !!hit;
  }

  private applyFk(pose: LimbPose, mix: number): void {
    const yaw = this.yaw;
    const origin = this.feet;

    const place = (id: NpcPartId, lx: number, ly: number, lz: number, rx: number): void => {
      const world = rotateYaw(lx, ly, lz, yaw);
      const group = this.visual.parts[id].group;
      group.position.set(
        THREE.MathUtils.lerp(group.position.x, origin.x + world[0], mix),
        THREE.MathUtils.lerp(group.position.y, origin.y + world[1], mix),
        THREE.MathUtils.lerp(group.position.z, origin.z + world[2], mix),
      );
      tmpEuler.set(rx, yaw, 0, 'YXZ');
      tmpQuat.setFromEuler(tmpEuler);
      group.quaternion.slerp(tmpQuat, mix);
    };

    place('pelvis', 0, 0.98, 0, pose.torso * 0.2);
    place('torso', 0, 1.28, 0, pose.torso);
    place('head', 0, 1.58, 0, pose.torso * 0.4);

    const arm = (side: number, u: number, l: number, upper: NpcPartId, lower: NpcPartId, hand: NpcPartId) => {
      const shoulder = { x: side * 0.22, y: 1.52, z: 0 };
      const upperC = offsetFrom(shoulder, 0.12, u);
      const elbow = offsetFrom(shoulder, 0.24, u);
      const lowerC = offsetFrom(elbow, 0.12, u + l);
      const wrist = offsetFrom(elbow, 0.24, u + l);
      const handC = offsetFrom(wrist, 0.05, u + l);
      place(upper, upperC.x, upperC.y, upperC.z, u);
      place(lower, lowerC.x, lowerC.y, lowerC.z, u + l);
      place(hand, handC.x, handC.y, handC.z, u + l * 0.4);
    };
    arm(-1, pose.upperArmL, pose.lowerArmL, 'upperArmL', 'lowerArmL', 'handL');
    arm(1, pose.upperArmR, pose.lowerArmR, 'upperArmR', 'lowerArmR', 'handR');

    const leg = (side: number, u: number, l: number, upper: NpcPartId, lower: NpcPartId, foot: NpcPartId) => {
      const hip = { x: side * 0.09, y: 0.9, z: 0 };
      const upperC = offsetFrom(hip, 0.18, u);
      const knee = offsetFrom(hip, 0.36, u);
      const lowerC = offsetFrom(knee, 0.17, u + l);
      const ankle = offsetFrom(knee, 0.34, u + l);
      const footC = { x: ankle.x, y: Math.max(0.05, ankle.y - 0.04), z: ankle.z + 0.04 };
      place(upper, upperC.x, upperC.y, upperC.z, u);
      place(lower, lowerC.x, lowerC.y, lowerC.z, u + l);
      place(foot, footC.x, footC.y, footC.z, Math.min(0.2, u + l));
    };
    leg(-1, pose.upperLegL, pose.lowerLegL, 'upperLegL', 'lowerLegL', 'footL');
    leg(1, pose.upperLegR, pose.lowerLegR, 'upperLegR', 'lowerLegR', 'footR');
  }

  private snapRagdollToVisual(): void {
    for (const [id, part] of this.parts) {
      this.visual.parts[id].group.getWorldPosition(tmpPos);
      this.visual.parts[id].group.getWorldQuaternion(tmpQuat);
      part.body.setTranslation({ x: tmpPos.x, y: tmpPos.y, z: tmpPos.z }, true);
      part.body.setRotation({ x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w }, true);
      part.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      part.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  private syncVisualFromRagdoll(): void {
    for (const [id, part] of this.parts) {
      const t = part.body.translation();
      const r = part.body.rotation();
      const group = this.visual.parts[id].group;
      group.position.set(t.x, t.y, t.z);
      group.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  private placeLocator(x: number, y: number, z: number, wake: boolean): void {
    this.locator.setTranslation({ x, y: y + LOCATOR_Y, z }, wake);
    this.locator.setRotation(IDENTITY, wake);
    this.locator.setLinvel({ x: 0, y: 0, z: 0 }, wake);
    this.locator.setAngvel({ x: 0, y: 0, z: 0 }, wake);
  }

  private setPhysicsEnabled(on: boolean): void {
    if (on) {
      this.setLocatorEnabled(true);
      this.setRagdollEnabled(false);
      return;
    }
    this.setLocatorEnabled(false);
    for (const part of this.parts.values()) {
      part.collider.setEnabled(false);
      part.body.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true);
      part.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      part.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      part.body.sleep();
    }
  }

  private setLocatorEnabled(on: boolean): void {
    this.locatorCollider.setEnabled(on);
    this.locator.setBodyType(
      on ? this.rapier.RigidBodyType.Dynamic : this.rapier.RigidBodyType.KinematicPositionBased,
      true,
    );
    if (on) this.locator.lockRotations(true, true);
  }

  private setRagdollEnabled(on: boolean): void {
    for (const part of this.parts.values()) {
      part.collider.setEnabled(true);
      part.collider.setSensor(!on);
      part.collider.setCollisionGroups(on ? SANDBOX_PHYSICAL_GROUPS : SANDBOX_HITBOX_GROUPS);
      part.body.setBodyType(
        on ? this.rapier.RigidBodyType.Dynamic : this.rapier.RigidBodyType.KinematicPositionBased,
        true,
      );
      if (!on) {
        part.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        part.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        part.body.sleep();
      } else {
        part.body.wakeUp();
      }
    }
  }

  private buildPhysics(): void {
    this.locator = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setLinearDamping(0.4)
        .setAngularDamping(2)
        .setCcdEnabled(false)
        .setCanSleep(true),
    );
    this.locator.lockRotations(true, true);
    this.locator.userData = { kind: 'sandboxNpc', npcId: this.id, part: 'locator' } satisfies NpcUserData;
    this.locatorCollider = this.world.createCollider(
      this.rapier.ColliderDesc.capsule(0.52, 0.22)
        .setMass(8)
        .setFriction(0.9)
        .setRestitution(0)
        .setCollisionGroups(SANDBOX_GROUPS),
      this.locator,
    );

    for (const id of PART_IDS) {
      const def = PART_PHYSICS[id];
      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.dynamic()
          .setLinearDamping(def.linearDamping ?? RAGDOLL.linearDamping)
          .setAngularDamping(def.angularDamping ?? RAGDOLL.angularDamping)
          .setCcdEnabled(true)
          .setCanSleep(true),
      );
      body.userData = { kind: 'sandboxNpc', npcId: this.id, part: id } satisfies NpcUserData;
      const collider = this.world.createCollider(colliderFromDef(this.rapier, def), body);
      this.parts.set(id, { id, body, collider });
    }

    const link = (
      a: NpcPartId,
      b: NpcPartId,
      anchorA: [number, number, number],
      anchorB: [number, number, number],
      revoluteAxis?: [number, number, number],
      limits?: [number, number],
    ): void => {
      const parent = this.parts.get(a)!.body;
      const child = this.parts.get(b)!.body;
      const data = revoluteAxis
        ? this.rapier.JointData.revolute(vec(anchorA), vec(anchorB), vec(revoluteAxis))
        : this.rapier.JointData.spherical(vec(anchorA), vec(anchorB));
      const joint = this.world.createImpulseJoint(data, parent, child, true);
      joint.setContactsEnabled(false);
      if (limits && 'setLimits' in joint) {
        (joint as RAPIER.RevoluteImpulseJoint).setLimits(limits[0], limits[1]);
      }
      this.joints.push(joint);
    };

    // Anchors are in each part's local space (Y-up capsules).
    link('pelvis', 'torso', [0, 0.1, 0], [0, -0.18, 0]);
    link('torso', 'head', [0, 0.2, 0], [0, -0.12, 0]);
    link('torso', 'upperArmL', [-0.16, 0.14, 0], [0, 0.12, 0]);
    link('upperArmL', 'lowerArmL', [0, -0.13, 0], [0, 0.12, 0], [1, 0, 0], [0.08, 2.15]);
    link('lowerArmL', 'handL', [0, -0.12, 0], [0, 0.04, 0]);
    link('torso', 'upperArmR', [0.16, 0.14, 0], [0, 0.12, 0]);
    link('upperArmR', 'lowerArmR', [0, -0.13, 0], [0, 0.12, 0], [1, 0, 0], [0.08, 2.15]);
    link('lowerArmR', 'handR', [0, -0.12, 0], [0, 0.04, 0]);
    link('pelvis', 'upperLegL', [-0.09, -0.1, 0], [0, 0.18, 0]);
    link('upperLegL', 'lowerLegL', [0, -0.18, 0], [0, 0.17, 0], [1, 0, 0], [0.04, 2.05]);
    link('lowerLegL', 'footL', [0, -0.17, 0], [0, 0.04, -0.02]);
    link('pelvis', 'upperLegR', [0.09, -0.1, 0], [0, 0.18, 0]);
    link('upperLegR', 'lowerLegR', [0, -0.18, 0], [0, 0.17, 0], [1, 0, 0], [0.04, 2.05]);
    link('lowerLegR', 'footR', [0, -0.17, 0], [0, 0.04, -0.02]);
  }

  attachHumanoid(): void {
    if (this.gltf) return;
    const inst = instantiateNpcHumanoid(this.visual.look, this.kind);
    if (!inst) {
      void preloadCharacter(this.kind).then(() => {
        if (this.alive && !this.gltf) this.attachHumanoid();
      });
      return;
    }
    this.gltf = inst;
    this.root.add(inst.character.root);
    for (const part of Object.values(this.visual.parts)) {
      part.mesh.visible = false;
      part.group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) mesh.visible = false;
      });
    }
    this.applyFk(this.pose, 1);
    this.root.updateMatrixWorld(true);
    this.driveGltf(0);
  }

  private driveGltf(dt: number): void {
    if (!this.gltf) return;
    const ragdoll = this.state === 'Ragdoll' || this.state === 'Dead';
    const char = this.gltf.character;
    if (ragdoll || !char.hasMixer) {
      char.root.position.set(0, 0, 0);
      char.root.rotation.set(0, 0, 0);
      driveBonesFromParts(this.gltf, this.visual.parts);
      return;
    }
    char.root.position.set(this.feet.x, this.feet.y, this.feet.z);
    char.root.rotation.set(0, this.yaw, 0);
    const wounded = this.health < 45 || this.limpSide !== 0;
    const planar = Math.hypot(this.locator.linvel().x, this.locator.linvel().z);
    let clip: LocoClip = 'idle';
    if (this.windup > 0) clip = 'idle';
    else if (this.state === 'Recovering') clip = 'getup';
    else if (this.state === 'Falling') clip = 'fall';
    else if (this.flinch > 0.08) clip = 'idle';
    else if (planar > 2.45 && this.cmd.clip === 'run' && !wounded) clip = 'run';
    else if (planar > 0.28 || this.state === 'Walking') clip = 'walk';
    const scale = this.limpSide !== 0 ? 0.55 : wounded ? 0.7 : 1;
    char.play(clip, 0.18, this.windup > 0 ? 0.08 : scale);
    char.update(dt, this.camDist);
    this.snapHitboxesFromBones();
  }

  private snapHitboxesFromBones(): void {
    if (!this.gltf) return;
    for (const [id, bone] of Object.entries(this.gltf.character.bones) as Array<[NpcPartId, THREE.Object3D]>) {
      const part = this.parts.get(id);
      if (!part || !bone) continue;
      bone.updateWorldMatrix(true, false);
      bone.getWorldPosition(tmpPos);
      bone.getWorldQuaternion(tmpQuat);
      part.body.setTranslation({ x: tmpPos.x, y: tmpPos.y, z: tmpPos.z }, true);
      part.body.setRotation({ x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w }, true);
    }
  }

  private sampleImpact(dt: number): void {
    this.impactCool = Math.max(0, this.impactCool - dt);
    const speed =
      this.state === 'Ragdoll' || this.state === 'Dead'
        ? this.speed
        : Math.hypot(this.locator.linvel().x, this.locator.linvel().y, this.locator.linvel().z);
    const drop = this.lastSpeed - speed;
    this.lastSpeed = speed;
    if (drop > 5.5) this.emitImpact(drop);
  }

  private emitImpact(speed: number): void {
    if (this.impactCool > 0) return;
    if (!this.onImpact && !this.onBloodContact) return;
    this.impactCool = this.dead ? 0.28 : 0.16;
    const p = this.feet;
    this.onImpact?.(p.x, p.y + 0.15, p.z, 0, 1, 0, speed);
    if (this.dead) this.onBloodContact?.(p.x, p.y + 0.02, p.z, 0, 1, 0);
  }
}

function colliderFromDef(rapier: typeof RAPIER, def: PartPhysDef): RAPIER.ColliderDesc {
  let desc: RAPIER.ColliderDesc;
  switch (def.shape.type) {
    case 'capsule':
      desc = rapier.ColliderDesc.capsule(def.shape.halfHeight, def.shape.radius);
      break;
    case 'ball':
      desc = rapier.ColliderDesc.ball(def.shape.radius);
      break;
    default:
      desc = rapier.ColliderDesc.cuboid(def.shape.hx, def.shape.hy, def.shape.hz);
  }
  return desc
    .setMass(def.mass)
    .setFriction(def.friction ?? RAGDOLL.friction)
    .setRestitution(def.restitution ?? RAGDOLL.restitution)
    .setCollisionGroups(SANDBOX_HITBOX_GROUPS)
    .setSensor(true);
}

function vec(v: [number, number, number]): { x: number; y: number; z: number } {
  return { x: v[0], y: v[1], z: v[2] };
}

function rotateYaw(x: number, y: number, z: number, yaw: number): [number, number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, y, -x * s + z * c];
}

/** Walk along a limb: from a joint, `length` meters at pitch around local X (facing -Z). */
function offsetFrom(
  joint: { x: number; y: number; z: number },
  length: number,
  pitch: number,
): { x: number; y: number; z: number } {
  const cy = Math.cos(pitch);
  const sy = Math.sin(pitch);
  return {
    x: joint.x,
    y: joint.y - length * cy,
    z: joint.z - length * sy,
  };
}

function blendPose(out: LimbPose, target: LimbPose, k: number): void {
  (Object.keys(out) as Array<keyof LimbPose>).forEach((key) => {
    out[key] += (target[key] - out[key]) * k;
  });
}

function dampAngle(current: number, target: number, k: number): number {
  return current + signedAngle(current, target) * k;
}

function signedAngle(current: number, target: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function zoneImpulseScale(zone: string): number {
  switch (zone) {
    case 'head':
      return 1.15;
    case 'chest':
      return 0.85;
    case 'arm':
      return 0.5;
    case 'leg':
      return 0.72;
    default:
      return 0.7;
  }
}

function pickRagdollStyle(zone: string, killed: boolean): RagdollStyle {
  if (killed && zone === 'head' && Math.random() < 0.18) return 'tense';
  const roll = Math.random();
  if (killed) {
    if (roll < 0.26) return 'spin';
    if (roll < 0.5) return 'crumple';
    if (roll < 0.74) return 'whip';
    return 'drop';
  }
  if (zone === 'leg') return roll < 0.55 ? 'crumple' : 'drop';
  if (zone === 'arm') return roll < 0.5 ? 'spin' : 'drop';
  return roll < 0.4 ? 'spin' : 'drop';
}

function flinchPose(base: LimbPose, part: NpcPartId, amount: number): LimbPose {
  const k = Math.min(1, amount * 3.2);
  const pose: LimbPose = { ...base };
  if (part === 'head') pose.torso -= 0.18 * k;
  else if (part === 'torso' || part === 'pelvis') pose.torso += 0.22 * k;
  else if (part.includes('ArmL') || part === 'handL') {
    pose.upperArmL += 0.55 * k;
    pose.lowerArmL += 0.4 * k;
    pose.torso -= 0.08 * k;
  } else if (part.includes('ArmR') || part === 'handR') {
    pose.upperArmR += 0.55 * k;
    pose.lowerArmR += 0.4 * k;
    pose.torso -= 0.08 * k;
  } else if (part.includes('LegL') || part === 'footL') {
    pose.upperLegL += 0.35 * k;
    pose.lowerLegL += 0.25 * k;
    pose.torso += 0.1 * k;
  } else {
    pose.upperLegR += 0.35 * k;
    pose.lowerLegR += 0.25 * k;
    pose.torso += 0.1 * k;
  }
  return pose;
}

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import {
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
} from './types';
import {
  idlePose,
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
  private wanderYaw = 0;
  private wanderTimer = 0;
  private recoverTimer = 0;
  private stillTimer = 0;
  private feet = { x: 0, y: 0, z: 0 };
  private readonly pose: LimbPose = idlePose();
  private highlighted = false;
  private selected = false;
  private alive = false;
  private gltf: NpcGltfInstance | null = null;
  private lastSpeed = 0;
  private impactCool = 0;
  private flinch = 0;
  private camDist = 0;
  health = NPC_MAX_HEALTH;
  dead = false;
  corpseAt = 0;
  private kind: CharacterKind;
  onImpact: ((x: number, y: number, z: number, nx: number, ny: number, nz: number, speed: number) => void) | null =
    null;
  onHit: ((x: number, y: number, z: number, nx: number, ny: number, nz: number, zone: string, killed: boolean) => void) | null =
    null;

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
    this.buildPhysics();
    this.setPhysicsEnabled(false);
    void preloadCharacter(this.kind).then(() => {
      if (this.alive) this.attachHumanoid();
    });
  }

  get npcState(): NpcState {
    return this.state;
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
    this.kind = pickNpcKind(() => Math.random());
    Object.assign(this.visual.look, randomNpcLook(() => Math.random()));
    this.gltf?.character.dispose();
    this.gltf = null;
    this.root.visible = true;
    this.yaw = yaw;
    this.wanderYaw = yaw;
    this.feet = { x, y, z };
    this.phase = Math.random() * Math.PI * 2;
    this.wanderTimer = 0.6 + Math.random() * 1.4;
    this.stillTimer = 0;
    this.recoverTimer = 0;
    this.applyHighlight(false, false);

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

  enterRagdoll(impulse?: { x: number; y: number; z: number }, atPart: NpcPartId = 'torso'): void {
    if (!this.alive) return;
    this.gltf?.character.stop();
    this.snapRagdollToVisual();
    this.setLocatorEnabled(false);
    this.setRagdollEnabled(true);
    const locVel = this.locator.linvel();
    for (const part of this.parts.values()) {
      part.body.setLinvel({ x: locVel.x, y: locVel.y, z: locVel.z }, true);
      part.body.wakeUp();
    }
    if (impulse) {
      const target = this.parts.get(atPart)?.body ?? this.parts.get('torso')?.body;
      target?.applyImpulse(impulse, true);
    }
    this.state = this.dead ? 'Dead' : 'Ragdoll';
    this.stillTimer = 0;
    this.lastSpeed = Math.hypot(locVel.x, locVel.y, locVel.z);
    this.emitImpact(6 + (impulse ? Math.hypot(impulse.x, impulse.y, impulse.z) * 0.2 : 0));
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    this.applyHighlight(this.highlighted, selected);
  }

  setHovered(hovered: boolean): void {
    this.highlighted = hovered;
    this.applyHighlight(hovered, this.selected);
  }

  applyShot(dir: { x: number; y: number; z: number }, part: NpcPartId, strength: number): void {
    this.enterRagdoll(
      { x: dir.x * strength, y: dir.y * strength + 2, z: dir.z * strength },
      part,
    );
  }

  applyHit(
    dir: { x: number; y: number; z: number },
    part: NpcPartId,
    damage: number,
    impulse: number,
  ): { killed: boolean; zone: string; health: number; alreadyDead: boolean } {
    const zone = npcZoneForPart(part);
    const origin = this.visual.parts[part]?.group.position ?? this.position;
    if (this.dead) {
      const target = this.parts.get(part)?.body ?? this.parts.get('torso')?.body;
      target?.applyImpulse({ x: dir.x * impulse * 0.45, y: dir.y * impulse * 0.45 + 1.2, z: dir.z * impulse * 0.45 }, true);
      this.onHit?.(origin.x, origin.y, origin.z, -dir.x, -dir.y, -dir.z, zone, false);
      return { killed: false, zone, health: 0, alreadyDead: true };
    }
    this.health = Math.max(0, this.health - damage);
    this.flinch = 0.18;
    const killed = this.health <= 0;
    if (killed) {
      this.dead = true;
      this.corpseAt = performance.now();
      this.enterRagdoll(
        { x: dir.x * impulse, y: dir.y * impulse + 2.4, z: dir.z * impulse },
        part,
      );
    } else {
      const v = this.locator.linvel();
      this.locator.setLinvel({ x: v.x + dir.x * 1.15, y: v.y + 0.15, z: v.z + dir.z * 1.15 }, true);
    }
    this.onHit?.(origin.x, origin.y, origin.z, -dir.x, -dir.y, -dir.z, zone, killed);
    return { killed, zone, health: this.health, alreadyDead: false };
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

    if (this.state === 'Ragdoll' || this.state === 'Dead') {
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
        if (!this.dead && this.stillTimer > RAGDOLL.recoverStillSec) this.beginRecover();
      }
      return;
    }

    if (this.state === 'Recovering') {
      this.recoverTimer += dt;
      const k = Math.min(1, this.recoverTimer / RAGDOLL.recoverBlendSec);
      this.applyFk(idlePose(), k);
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
        this.enterRagdoll({ x: v.x * 0.4, y: 0, z: v.z * 0.4 });
        return;
      }
      this.state = planar > 0.4 ? 'Walking' : 'Idle';
    } else if (grounded) {
      this.state = planar > 0.35 ? 'Walking' : 'Idle';
    }

    this.phase += dt * (this.state === 'Walking' ? 7.2 : 1.6);
    const stride = this.state === 'Walking' ? Math.min(1, planar / RAGDOLL.walkSpeed) : 0.15;
    const target = this.state === 'Walking' ? walkPose(this.phase, stride) : idlePose();
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
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderYaw += (Math.random() - 0.5) * 2.2;
      this.wanderTimer = 1.2 + Math.random() * 2.4;
    }
    this.yaw = dampAngle(this.yaw, this.wanderYaw, 1 - Math.exp(-4 * dt));

    const grounded = this.isGrounded();
    const walk = this.state !== 'Falling';
    const speed = walk && grounded ? RAGDOLL.walkSpeed : 0;
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

  private applyHighlight(hovered: boolean, selected: boolean): void {
    const color = selected || hovered ? 0xd6ff3d : 0x000000;
    const emit = selected ? 0.38 : hovered ? 0.2 : 0;
    for (const mat of this.visual.materials) {
      mat.emissive.setHex(color);
      mat.emissiveIntensity = emit;
    }
    this.gltf?.character.setHighlight(color, emit);
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
          .setLinearDamping(RAGDOLL.linearDamping)
          .setAngularDamping(RAGDOLL.angularDamping)
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
    link('upperArmL', 'lowerArmL', [0, -0.13, 0], [0, 0.12, 0], [1, 0, 0], [0.05, 2.3]);
    link('lowerArmL', 'handL', [0, -0.12, 0], [0, 0.04, 0]);
    link('torso', 'upperArmR', [0.16, 0.14, 0], [0, 0.12, 0]);
    link('upperArmR', 'lowerArmR', [0, -0.13, 0], [0, 0.12, 0], [1, 0, 0], [0.05, 2.3]);
    link('lowerArmR', 'handR', [0, -0.12, 0], [0, 0.04, 0]);
    link('pelvis', 'upperLegL', [-0.09, -0.1, 0], [0, 0.18, 0]);
    link('upperLegL', 'lowerLegL', [0, -0.18, 0], [0, 0.17, 0], [1, 0, 0], [0.02, 2.2]);
    link('lowerLegL', 'footL', [0, -0.17, 0], [0, 0.04, -0.02]);
    link('pelvis', 'upperLegR', [0.09, -0.1, 0], [0, 0.18, 0]);
    link('upperLegR', 'lowerLegR', [0, -0.18, 0], [0, 0.17, 0], [1, 0, 0], [0.02, 2.2]);
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
    const keepOverlays = inst.kind === 'humanoid';
    for (const part of Object.values(this.visual.parts)) {
      part.mesh.visible = false;
      part.group.traverse((obj) => {
        if (obj === part.group || obj === part.mesh) return;
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const keep =
          keepOverlays &&
          (mesh.name === 'hair' || mesh.name === 'bun' || mesh.name === 'collar' || mesh.name === 'belt');
        mesh.visible = keep;
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
    const clip: LocoClip =
      this.state === 'Falling' ? 'fall' : this.state === 'Walking' && this.flinch <= 0 ? 'walk' : 'idle';
    char.play(clip);
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
    if (this.impactCool > 0 || !this.onImpact) return;
    this.impactCool = 0.16;
    const p = this.feet;
    this.onImpact(p.x, p.y + 0.15, p.z, 0, 1, 0, speed);
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
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + d * k;
}

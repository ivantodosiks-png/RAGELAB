import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { SANDBOX_GROUPS } from '@ragelab/shared';
import {
  WEAPON_PHYSICS,
  instantiateWeaponVisual,
  loadWeaponModel,
  prepareWeaponVisual,
  type SandboxWeaponKind,
} from '../weapons/weaponAssets';

export interface WeaponUserData {
  kind: 'sandboxWeapon';
  weaponId: number;
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

let nextId = 1;

export class SandboxWeapon {
  readonly id: number;
  readonly root = new THREE.Group();
  spawnedAt = 0;
  kind: SandboxWeaponKind = 'pistol';

  private body!: RAPIER.RigidBody;
  private collider!: RAPIER.Collider;
  private visual: THREE.Object3D | null = null;
  private placeholder: THREE.Mesh;
  private alive = false;
  held = false;
  private impactCool = 0;
  private lastSpeed = 0;
  private readonly rapier: typeof RAPIER;
  private readonly world: RAPIER.World;

  onImpact: ((x: number, y: number, z: number, nx: number, ny: number, nz: number, speed: number) => void) | null =
    null;

  constructor(rapier: typeof RAPIER, world: RAPIER.World) {
    this.id = nextId++;
    this.rapier = rapier;
    this.world = world;
    this.root.name = 'sandboxWeapon';
    this.root.visible = false;

    const geo = new THREE.BoxGeometry(0.08, 0.08, 0.28);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.5, metalness: 0.4 });
    this.placeholder = new THREE.Mesh(geo, mat);
    this.placeholder.castShadow = true;
    this.root.add(this.placeholder);

    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic().setCcdEnabled(true).setCanSleep(true).setLinearDamping(0.18).setAngularDamping(0.4),
    );
    this.body.userData = { kind: 'sandboxWeapon', weaponId: this.id } satisfies WeaponUserData;
    const phys = WEAPON_PHYSICS.pistol;
    this.collider = world.createCollider(
      rapier.ColliderDesc.cuboid(phys.hx, phys.hy, phys.hz)
        .setMass(phys.mass)
        .setFriction(0.58)
        .setRestitution(0.12)
        .setCollisionGroups(SANDBOX_GROUPS),
      this.body,
    );
    this.body.setEnabled(false);
    this.collider.setEnabled(false);
  }

  get active(): boolean {
    return this.alive;
  }

  get mass(): number {
    return WEAPON_PHYSICS[this.kind].mass;
  }

  get speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  get translation(): { x: number; y: number; z: number } {
    return this.body.translation();
  }

  matchesObject(obj: THREE.Object3D): boolean {
    let cursor: THREE.Object3D | null = obj;
    while (cursor) {
      if (cursor === this.root) return true;
      cursor = cursor.parent;
    }
    return false;
  }

  spawn(kind: SandboxWeaponKind, x: number, y: number, z: number, yaw: number): void {
    this.kind = kind;
    this.alive = true;
    this.held = false;
    this.spawnedAt = performance.now();
    this.root.visible = true;
    this.placeholder.visible = true;
    if (this.visual) {
      this.visual.removeFromParent();
      this.visual = null;
    }

    const phys = WEAPON_PHYSICS[kind];
    this.collider.setHalfExtents({ x: phys.hx, y: phys.hy, z: phys.hz });
    this.collider.setMass(phys.mass);
    this.body.setEnabled(true);
    this.collider.setEnabled(true);
    this.body.setBodyType(this.rapier.RigidBodyType.Dynamic, true);
    this.body.setTranslation({ x, y: y + phys.hy + 0.02, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.wakeUp();
    this.lastSpeed = 0;
    this.attachVisual();
  }

  despawn(): void {
    if (!this.alive) return;
    this.alive = false;
    this.held = false;
    this.root.visible = false;
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setEnabled(false);
    this.collider.setEnabled(false);
  }

  hold(): void {
    if (!this.alive) return;
    this.held = true;
    this.body.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  throw(dir: { x: number; y: number; z: number }, extra = 0): void {
    if (!this.alive) return;
    this.held = false;
    this.body.setBodyType(this.rapier.RigidBodyType.Dynamic, true);
    const speed = 11 + extra + this.mass * 0.6;
    this.body.setLinvel({ x: dir.x * speed, y: dir.y * speed + 1.6, z: dir.z * speed }, true);
    this.body.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 8 }, true);
    this.body.wakeUp();
    this.lastSpeed = speed;
  }

  follow(pos: { x: number; y: number; z: number }, yaw: number): void {
    this.body.setNextKinematicTranslation(pos);
    this.body.setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
  }

  applyImpulse(dir: { x: number; y: number; z: number }, strength: number): void {
    if (!this.alive || this.held) return;
    this.body.applyImpulse({ x: dir.x * strength, y: dir.y * strength + 1.2, z: dir.z * strength }, true);
    this.body.wakeUp();
  }

  update(dt: number, camera: THREE.Camera): void {
    if (!this.alive) return;
    this.impactCool = Math.max(0, this.impactCool - dt);
    const t = this.body.translation();
    const r = this.body.rotation();
    this.root.position.set(t.x, t.y, t.z);
    this.root.quaternion.set(r.x, r.y, r.z, r.w);
    this.root.traverse((obj) => {
        const lod = obj as THREE.LOD;
        if (lod instanceof THREE.LOD) lod.update(camera);
    });
    const speed = this.speed;
    const drop = this.lastSpeed - speed;
    this.lastSpeed = speed;
    if (drop > 6 && this.onImpact) {
      this.onImpact(t.x, t.y, t.z, 0, 1, 0, drop);
    }
  }

  contactsNpc(callback: (npcId: number, part: string, impulse: { x: number; y: number; z: number }) => void): void {
    if (!this.alive || this.held || this.impactCool > 0) return;
    const v = this.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed < 4.2) return;
    this.world.contactPairsWith(this.collider, (other) => {
      const data = other.parent()?.userData as { kind?: string; npcId?: number; part?: string } | undefined;
      if (!data || data.kind !== 'sandboxNpc' || data.npcId == null) return;
      const scale = this.mass * speed * 0.42;
      callback(data.npcId, data.part ?? 'torso', {
        x: v.x * scale * 0.08,
        y: Math.max(2.2, Math.abs(v.y) * scale * 0.04),
        z: v.z * scale * 0.08,
      });
      this.impactCool = 0.18;
    });
  }

  dispose(): void {
    this.despawn();
    if (this.body.isValid()) this.world.removeRigidBody(this.body);
    this.placeholder.geometry.dispose();
    (this.placeholder.material as THREE.Material).dispose();
    this.root.removeFromParent();
  }

  private attachVisual(): void {
    const kind = this.kind;
    const phys = WEAPON_PHYSICS[kind];
    const ready = instantiateWeaponVisual(kind, phys.length, { lod: true, ground: false, shadows: true });
    if (ready) {
      this.setVisual(ready);
      return;
    }
    void loadWeaponModel(kind).then((clone) => {
      if (!this.alive || this.kind !== kind || !clone) return;
      this.setVisual(prepareWeaponVisual(clone, phys.length, { lod: true, ground: false, shadows: true }));
    });
  }

  private setVisual(obj: THREE.Object3D): void {
    if (this.visual) this.visual.removeFromParent();
    this.visual = obj;
    this.placeholder.visible = false;
    this.root.add(obj);
  }
}

void IDENTITY;

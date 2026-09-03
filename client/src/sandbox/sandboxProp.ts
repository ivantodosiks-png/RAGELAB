import * as THREE from 'three';
import { SANDBOX_PROP_GROUPS, colliderDescForProp, getArchetype, type PropKind } from '@ragelab/shared';
import type RAPIER from '@dimforge/rapier3d-compat';
import { propGeometry, propMaterial } from '../maps/mapMeshBuilder';

export interface PropUserData {
  kind: 'sandboxProp';
  propId: number;
}

const geoCache = new Map<PropKind, THREE.BufferGeometry>();

function sharedGeo(kind: PropKind): THREE.BufferGeometry {
  let geo = geoCache.get(kind);
  if (!geo) {
    geo = propGeometry(kind);
    geoCache.set(kind, geo);
  }
  return geo;
}

function halfY(kind: PropKind): number {
  const shape = getArchetype(kind).shape;
  if (shape.type === 'box') return shape.halfExtents[1];
  if (shape.type === 'cylinder') return shape.halfHeight;
  if (shape.type === 'sphere') return shape.radius;
  return 0.4;
}

let nextId = 1;

export class SandboxProp {
  readonly id: number;
  readonly root = new THREE.Group();
  spawnedAt = 0;
  kind: PropKind = 'crate';

  private body!: RAPIER.RigidBody;
  private collider!: RAPIER.Collider;
  private mesh: THREE.Mesh;
  private alive = false;
  held = false;
  private lastSpeed = 0;
  private readonly rapier: typeof RAPIER;
  private readonly world: RAPIER.World;
  private readonly matByKind = new Map<PropKind, THREE.MeshStandardMaterial>();

  onImpact: ((x: number, y: number, z: number, nx: number, ny: number, nz: number, speed: number) => void) | null =
    null;

  constructor(rapier: typeof RAPIER, world: RAPIER.World) {
    this.id = nextId++;
    this.rapier = rapier;
    this.world = world;
    this.root.name = 'sandboxProp';
    this.root.visible = false;

    const mat = this.materialFor('crate');
    this.mesh = new THREE.Mesh(sharedGeo('crate'), mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.root.add(this.mesh);

    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic().setCcdEnabled(true).setCanSleep(true).setLinearDamping(0.06).setAngularDamping(0.2),
    );
    this.body.userData = { kind: 'sandboxProp', propId: this.id } satisfies PropUserData;
    this.collider = world.createCollider(
      colliderDescForProp(rapier, 'crate', 1)
        .setMass(24)
        .setFriction(0.7)
        .setRestitution(0.12)
        .setCollisionGroups(SANDBOX_PROP_GROUPS),
      this.body,
    );
    this.body.setEnabled(false);
    this.collider.setEnabled(false);
  }

  get active(): boolean {
    return this.alive;
  }

  get mass(): number {
    return getArchetype(this.kind).mass;
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

  spawn(kind: PropKind, x: number, y: number, z: number, yaw: number): void {
    this.kind = kind;
    this.alive = true;
    this.held = false;
    this.spawnedAt = performance.now();
    this.root.visible = true;

    this.mesh.geometry = sharedGeo(kind);
    this.mesh.material = this.materialFor(kind);

    this.rebuildCollider(kind);
    const hy = halfY(kind);
    this.body.setEnabled(true);
    this.collider.setEnabled(true);
    this.body.setBodyType(this.rapier.RigidBodyType.Dynamic, true);
    this.body.setTranslation({ x, y: y + hy + 0.02, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.wakeUp();
    this.lastSpeed = 0;
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

  throw(dir: { x: number; y: number; z: number }): void {
    if (!this.alive) return;
    this.held = false;
    this.body.setBodyType(this.rapier.RigidBodyType.Dynamic, true);
    const speed = 9 + this.mass * 0.08;
    this.body.setLinvel({ x: dir.x * speed, y: dir.y * speed + 1.4, z: dir.z * speed }, true);
    this.body.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 5, z: (Math.random() - 0.5) * 6 }, true);
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

  update(): void {
    if (!this.alive) return;
    const t = this.body.translation();
    const r = this.body.rotation();
    this.root.position.set(t.x, t.y, t.z);
    this.root.quaternion.set(r.x, r.y, r.z, r.w);
    const speed = this.speed;
    const drop = this.lastSpeed - speed;
    this.lastSpeed = speed;
    if (drop > 7 && this.onImpact) this.onImpact(t.x, t.y, t.z, 0, 1, 0, drop);
  }

  dispose(): void {
    this.despawn();
    if (this.body.isValid()) this.world.removeRigidBody(this.body);
    for (const mat of this.matByKind.values()) mat.dispose();
    this.matByKind.clear();
    this.root.removeFromParent();
  }

  private rebuildCollider(kind: PropKind): void {
    const enabled = this.collider.isEnabled();
    this.world.removeCollider(this.collider, false);
    const a = getArchetype(kind);
    this.collider = this.world.createCollider(
      colliderDescForProp(this.rapier, kind, 1)
        .setMass(a.mass)
        .setFriction(a.friction)
        .setRestitution(a.restitution)
        .setCollisionGroups(SANDBOX_PROP_GROUPS),
      this.body,
    );
    this.collider.setEnabled(enabled);
  }

  private materialFor(kind: PropKind): THREE.MeshStandardMaterial {
    let mat = this.matByKind.get(kind);
    if (!mat) {
      mat = propMaterial(kind);
      this.matByKind.set(kind, mat);
    }
    return mat;
  }
}

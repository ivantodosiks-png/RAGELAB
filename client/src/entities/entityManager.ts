import * as THREE from 'three';
import {
  type MapDefinition,
  type PlayerId,
  type PlayerIdentity,
  type PropKind,
} from '@ragelab/shared';
import { PlayerAvatar, SharedAvatarAssets } from './playerAvatar';
import { propGeometry, propMaterial } from '../maps/mapMeshBuilder';
import { doorTransform, doorWidthAxis } from '../physics/clientWorld';
import type { SnapshotInterpolator } from '../networking/snapshotInterpolator';

interface PropSlot {
  id: number;
  kind: PropKind;
  /** Index inside the InstancedMesh for this kind. */
  instance: number;
  scale: number;
  visible: boolean;
}

interface PropBatch {
  mesh: THREE.InstancedMesh;
  used: number;
}

const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Owns every replicated visual: remote player avatars, sandbox props, doors and
 * pickups. Instanced where possible and pooled everywhere, so a busy 16 player
 * room does not churn the GC or the draw call budget.
 */
export class EntityManager {
  readonly root = new THREE.Group();

  private readonly avatars = new Map<PlayerId, PlayerAvatar>();
  private readonly identities = new Map<PlayerId, PlayerIdentity>();
  private readonly avatarAssets = new SharedAvatarAssets();

  private readonly propSlots = new Map<number, PropSlot>();
  private readonly propBatches = new Map<PropKind, PropBatch>();

  private readonly doorMeshes: THREE.Mesh[] = [];
  private readonly pickupMeshes = new Map<string, THREE.Object3D>();

  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scaleVec = new THREE.Vector3();

  constructor(
    private readonly map: MapDefinition,
    private readonly materialFor: (name: string) => THREE.MeshStandardMaterial,
  ) {
    this.root.name = 'entities';
    this.buildPropBatches();
    this.buildDoors();
  }

  // ── props ─────────────────────────────────────────────────────────────────

  private buildPropBatches(): void {
    const counts = new Map<PropKind, number>();
    for (const def of this.map.props) {
      counts.set(def.kind, (counts.get(def.kind) ?? 0) + 1);
    }

    for (const [kind, count] of counts) {
      const mesh = new THREE.InstancedMesh(propGeometry(kind), propMaterial(kind), count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.name = `props:${kind}`;
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, HIDDEN_MATRIX);
      this.root.add(mesh);
      this.propBatches.set(kind, { mesh, used: 0 });
    }

    let id = 1;
    for (const def of this.map.props) {
      const batch = this.propBatches.get(def.kind)!;
      this.propSlots.set(id, {
        id,
        kind: def.kind,
        instance: batch.used++,
        scale: def.scale ?? 1,
        visible: false,
      });
      id += 1;
    }
  }

  private buildDoors(): void {
    for (const def of this.map.doors) {
      const geometry = new THREE.BoxGeometry(def.size[0], def.size[1], def.size[2]);
      const mesh = new THREE.Mesh(geometry, this.materialFor(def.material));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `door:${def.id}`;
      this.root.add(mesh);
      this.doorMeshes.push(mesh);
    }
  }

  /** Register the pickup markers built by the map builder so we can hide them. */
  registerPickups(source: THREE.Object3D): void {
    const group = source.getObjectByName('pickups');
    if (!group) return;
    for (const child of group.children) {
      const id = child.userData.pickupId as string | undefined;
      if (id) this.pickupMeshes.set(id, child);
    }
  }

  setPickupAvailable(id: string, available: boolean): void {
    const mesh = this.pickupMeshes.get(id);
    if (mesh) mesh.visible = available;
  }

  // ── identities ────────────────────────────────────────────────────────────

  setIdentities(list: PlayerIdentity[]): void {
    this.identities.clear();
    for (const identity of list) {
      this.identities.set(identity.id, identity);
      this.avatars.get(identity.id)?.setIdentity(identity);
    }
  }

  identity(id: PlayerId): PlayerIdentity | undefined {
    return this.identities.get(id);
  }

  avatar(id: PlayerId): PlayerAvatar | undefined {
    return this.avatars.get(id);
  }

  // ── per-frame sync ────────────────────────────────────────────────────────

  update(
    interp: SnapshotInterpolator,
    dt: number,
    nowMs: number,
    cameraPosition: THREE.Vector3,
  ): void {
    this.syncAvatars(interp, dt, nowMs, cameraPosition);
    this.syncProps(interp);
    this.syncDoors(interp);
  }

  private syncAvatars(
    interp: SnapshotInterpolator,
    dt: number,
    nowMs: number,
    cameraPosition: THREE.Vector3,
  ): void {
    for (const [id, state] of interp.players) {
      let avatar = this.avatars.get(id);
      if (!avatar) {
        avatar = new PlayerAvatar(id, this.identities.get(id), this.avatarAssets);
        this.avatars.set(id, avatar);
        this.root.add(avatar.root);
      }
      avatar.update(state, dt, nowMs, cameraPosition);
    }

    for (const [id, avatar] of this.avatars) {
      if (interp.players.has(id)) continue;
      avatar.dispose();
      this.avatars.delete(id);
    }
  }

  private syncProps(interp: SnapshotInterpolator): void {
    const dirty = new Set<PropKind>();

    for (const [id, slot] of this.propSlots) {
      const state = interp.props.get(id);
      const shouldShow = state !== undefined;
      if (!shouldShow) {
        if (slot.visible) {
          this.propBatches.get(slot.kind)!.mesh.setMatrixAt(slot.instance, HIDDEN_MATRIX);
          slot.visible = false;
          dirty.add(slot.kind);
        }
        continue;
      }

      this.position.set(state.position.x, state.position.y, state.position.z);
      this.quaternion.set(
        state.rotation.x,
        state.rotation.y,
        state.rotation.z,
        state.rotation.w,
      );
      this.scaleVec.setScalar(slot.scale);
      this.matrix.compose(this.position, this.quaternion, this.scaleVec);
      this.propBatches.get(slot.kind)!.mesh.setMatrixAt(slot.instance, this.matrix);
      slot.visible = true;
      dirty.add(slot.kind);
    }

    for (const kind of dirty) {
      this.propBatches.get(kind)!.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private syncDoors(interp: SnapshotInterpolator): void {
    for (let i = 0; i < this.doorMeshes.length; i++) {
      const def = this.map.doors[i];
      const mesh = this.doorMeshes[i];
      if (!def || !mesh) continue;
      const progress = interp.doors[i] ?? 0;
      const { axis, width } = doorWidthAxis(def);
      const t = doorTransform(def, axis, width, progress);
      mesh.position.set(t.position.x, t.position.y, t.position.z);
      mesh.rotation.y = t.yaw;
    }
  }

  /** World position of a player's chest, used to place hit effects and audio. */
  playerAnchor(id: PlayerId, out: THREE.Vector3): boolean {
    const avatar = this.avatars.get(id);
    if (!avatar) return false;
    out.copy(avatar.root.position);
    out.y += 1.1;
    return true;
  }

  dispose(): void {
    for (const avatar of this.avatars.values()) avatar.dispose();
    this.avatars.clear();
    this.avatarAssets.dispose();

    for (const batch of this.propBatches.values()) {
      batch.mesh.geometry.dispose();
      (batch.mesh.material as THREE.Material).dispose();
      batch.mesh.removeFromParent();
    }
    this.propBatches.clear();
    this.propSlots.clear();

    for (const mesh of this.doorMeshes) {
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
    this.doorMeshes.length = 0;
    this.pickupMeshes.clear();
    this.root.clear();
  }
}

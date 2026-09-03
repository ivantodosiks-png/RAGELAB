import * as THREE from 'three';
import {
  AnimationState,
  PLAYER_HEIGHT_CROUCH,
  PLAYER_HEIGHT_STAND,
  PLAYER_RADIUS,
  PlayerFlag,
  animationStateFor,
  clamp,
  getWeapon,
  lerp,
  weaponFromIndex,
  type AnimationStateId,
  type PlayerIdentity,
} from '@ragelab/shared';
import type { InterpolatedPlayer } from '../networking/snapshotInterpolator';
import { muzzleCoreTexture, muzzleStarTexture } from '../renderer/textures';
import { buildWeaponMesh, muzzleOffsetFor } from '../weapons/weaponMeshes';
import { instantiateWeaponVisual, loadWeaponModel, prepareWeaponVisual } from '../weapons/weaponAssets';
import {
  instantiateCharacter,
  preloadCharacter,
  type SkinnedCharacter,
} from '../characters/skinnedHumanoid';
import { clipFromAnimation, lookFromIdentity } from '../player/localCharacter';

const TEAM_COLORS = [0xf05b4a, 0x4a9df0, 0x67e08a, 0xf0c14a];

interface Limb {
  pivot: THREE.Object3D;
  mesh: THREE.Mesh;
}

/**
 * Procedural humanoid used for remote players.
 *
 * Deliberately geometric: no external model to download, one shared geometry
 * set across every avatar, and the whole thing is four draw calls. Animation is
 * driven entirely from replicated state (velocity + flags), so no animation
 * data needs to cross the wire.
 */
export class PlayerAvatar {
  readonly root = new THREE.Group();

  private readonly torsoPivot = new THREE.Object3D();
  private readonly headPivot = new THREE.Object3D();
  private readonly legs: Limb[] = [];
  private readonly arms: Limb[] = [];
  private readonly weaponHolder = new THREE.Group();
  private readonly muzzlePoint = new THREE.Object3D();
  private readonly muzzleCore: THREE.Sprite;
  private readonly muzzleStar: THREE.Sprite;
  private readonly nameplate: THREE.Sprite;
  private readonly healthBar: THREE.Sprite;

  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private phase = 0;
  private crouchBlend = 0;
  private currentState: AnimationStateId = AnimationState.Idle;
  private deathBlend = 0;
  private muzzleFlashUntil = 0;
  private readonly muzzleLight: THREE.PointLight;
  private currentWeapon = -1;
  private readonly weaponDisposables: Array<{ dispose(): void }> = [];
  private skinned: SkinnedCharacter | null = null;
  private readonly proxyMeshes: THREE.Object3D[] = [];
  private readonly handWorld = new THREE.Vector3();
  private readonly handQuat = new THREE.Quaternion();
  private readonly parentInv = new THREE.Quaternion();

  constructor(
    readonly playerId: number,
    identity: PlayerIdentity | undefined,
    shared: SharedAvatarAssets,
  ) {
    this.root.name = `avatar:${playerId}`;

    const color = TEAM_COLORS[(identity?.team ?? 0) % TEAM_COLORS.length]!;
    this.bodyMaterial = shared.bodyMaterial.clone();
    this.bodyMaterial.color.setHex(color);

    this.root.add(this.torsoPivot);

    const torso = new THREE.Mesh(shared.torsoGeometry, this.bodyMaterial);
    torso.position.y = 1.02;
    torso.castShadow = true;
    torso.receiveShadow = true;
    this.torsoPivot.add(torso);
    this.proxyMeshes.push(torso);

    this.headPivot.position.y = 1.5;
    this.torsoPivot.add(this.headPivot);
    const head = new THREE.Mesh(shared.headGeometry, shared.headMaterial);
    head.castShadow = true;
    this.headPivot.add(head);
    this.proxyMeshes.push(head);

    // Visor so you can tell which way a player is facing at a glance.
    const visor = new THREE.Mesh(shared.visorGeometry, shared.visorMaterial);
    visor.position.set(0, 0.02, -0.15);
    this.headPivot.add(visor);
    this.proxyMeshes.push(visor);

    for (const side of [-1, 1]) {
      const pivot = new THREE.Object3D();
      pivot.position.set(side * 0.13, 0.78, 0);
      this.torsoPivot.add(pivot);
      const mesh = new THREE.Mesh(shared.legGeometry, this.bodyMaterial);
      mesh.position.y = -0.39;
      mesh.castShadow = true;
      pivot.add(mesh);
      this.legs.push({ pivot, mesh });
      this.proxyMeshes.push(mesh);
    }

    for (const side of [-1, 1]) {
      const pivot = new THREE.Object3D();
      pivot.position.set(side * 0.29, 1.34, 0);
      this.torsoPivot.add(pivot);
      const mesh = new THREE.Mesh(shared.armGeometry, shared.limbMaterial);
      mesh.position.y = -0.26;
      mesh.castShadow = true;
      pivot.add(mesh);
      this.arms.push({ pivot, mesh });
      this.proxyMeshes.push(mesh);
    }

    this.weaponHolder.position.set(0.04, -0.3, -0.16);
    this.weaponHolder.rotation.set(0.12, 0, 0.04);
    this.arms[1]!.pivot.add(this.weaponHolder);
    this.weaponHolder.add(this.muzzlePoint);

    this.muzzleCore = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: muzzleCoreTexture(),
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.muzzleStar = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: muzzleStarTexture(),
        color: 0xffe8a0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.muzzleCore.visible = false;
    this.muzzleStar.visible = false;
    this.muzzleCore.scale.setScalar(0.22);
    this.muzzleStar.scale.setScalar(0.45);
    this.muzzlePoint.add(this.muzzleCore, this.muzzleStar);

    this.muzzleLight = new THREE.PointLight(0xffd8a0, 0, 8, 2);
    this.muzzlePoint.add(this.muzzleLight);
    this.equipWeapon(0);

    this.nameplate = makeLabelSprite(identity?.username ?? `Player ${playerId}`);
    this.nameplate.position.y = PLAYER_HEIGHT_STAND + 0.42;
    this.root.add(this.nameplate);

    this.healthBar = makeHealthSprite();
    this.healthBar.position.y = PLAYER_HEIGHT_STAND + 0.25;
    this.root.add(this.healthBar);

    void preloadCharacter('soldier').then(() => this.attachSkinned(identity));
  }

  setIdentity(identity: PlayerIdentity): void {
    const color = TEAM_COLORS[identity.team % TEAM_COLORS.length]!;
    this.bodyMaterial.color.setHex(color);
    const material = this.nameplate.material as THREE.SpriteMaterial;
    material.map?.dispose();
    const sprite = makeLabelSprite(identity.username);
    material.map = (sprite.material as THREE.SpriteMaterial).map;
    material.needsUpdate = true;
    this.nameplate.scale.copy(sprite.scale);
  }

  flashMuzzle(nowMs: number): void {
    this.muzzleFlashUntil = nowMs + 90;
    this.muzzleStar.material.rotation = Math.random() * Math.PI;
  }

  update(state: InterpolatedPlayer, dt: number, nowMs: number, cameraPos: THREE.Vector3): void {
    const dead = (state.flags & PlayerFlag.Dead) !== 0;
    const crouching = (state.flags & PlayerFlag.Crouching) !== 0;

    this.root.position.set(state.position.x, state.position.y, state.position.z);
    this.root.rotation.y = state.yaw;

    // Crouch squashes the whole rig rather than re-rigging the skeleton.
    this.crouchBlend = lerp(this.crouchBlend, crouching ? 1 : 0, 1 - Math.exp(-14 * dt));
    const scaleY = lerp(1, PLAYER_HEIGHT_CROUCH / PLAYER_HEIGHT_STAND, this.crouchBlend);
    this.torsoPivot.scale.y = scaleY;

    this.deathBlend = lerp(this.deathBlend, dead ? 1 : 0, 1 - Math.exp(-9 * dt));
    // Ragdoll-lite: tip the body over and sink it toward the floor.
    this.torsoPivot.rotation.x = this.deathBlend * (Math.PI / 2) * 0.92;
    this.torsoPivot.position.y = -this.deathBlend * 0.55;

    const state2d = animationStateFor({ flags: state.flags, velocity: state.velocity });
    this.currentState = state2d;

    if (this.skinned) {
      this.skinned.play(dead ? 'idle' : clipFromAnimation(state2d, speedForClip(state.velocity)));
      this.skinned.update(dt, this.root.position.distanceTo(cameraPos));
      this.skinned.root.scale.y = scaleY;
      this.skinned.root.rotation.x = this.deathBlend * (Math.PI / 2) * 0.92;
      this.skinned.root.position.y = -this.deathBlend * 0.55;
      this.syncWeaponToHand();
    } else {
      const speed = Math.hypot(state.velocity.x, state.velocity.z);
      const strideRate = state2d === AnimationState.Run ? 9.5 : 6.4;
      this.phase += dt * strideRate * clamp(speed / 5.2, 0, 1.6);

      const swing = clamp(speed / 5.2, 0, 1.3) * (dead ? 0 : 1);
      const legSwing = Math.sin(this.phase) * 0.62 * swing;
      this.legs[0]!.pivot.rotation.x = legSwing;
      this.legs[1]!.pivot.rotation.x = -legSwing;

      if (state2d === AnimationState.Jump || state2d === AnimationState.Fall) {
        this.legs[0]!.pivot.rotation.x = -0.35;
        this.legs[1]!.pivot.rotation.x = 0.2;
      }

      // Arms hold the weapon toward the aim pitch; the off hand supports it.
      const pitch = clamp(state.pitch, -1.2, 1.2);
      this.arms[1]!.pivot.rotation.x = -1.35 - pitch * (dead ? 0 : 1);
      this.arms[0]!.pivot.rotation.x = -1.15 - pitch * 0.9 * (dead ? 0 : 1);
      this.arms[0]!.pivot.rotation.z = 0.32;
      this.arms[1]!.pivot.rotation.z = -0.22;

      if (dead) {
        this.arms[0]!.pivot.rotation.x = -0.2;
        this.arms[1]!.pivot.rotation.x = -0.2;
      }

      this.headPivot.rotation.x = pitch * 0.55;
    }

    this.equipWeapon(state.weapon);

    const flashing = nowMs < this.muzzleFlashUntil;
    const flashLife = flashing ? clamp((this.muzzleFlashUntil - nowMs) / 90, 0, 1) : 0;
    const pulse = flashLife ** 0.45;
    this.muzzleLight.intensity = flashing ? 28 * pulse : 0;
    this.muzzleCore.visible = flashing;
    this.muzzleStar.visible = flashing;
    (this.muzzleCore.material as THREE.SpriteMaterial).opacity = pulse;
    (this.muzzleStar.material as THREE.SpriteMaterial).opacity = pulse * 0.9;

    // Nameplates face the camera and fade with distance.
    const top = PLAYER_HEIGHT_STAND * scaleY;
    this.nameplate.position.y = top + 0.42 - this.deathBlend * top;
    this.healthBar.position.y = top + 0.25 - this.deathBlend * top;
    const dist = this.root.position.distanceTo(cameraPos);
    const visible = !dead && dist < 60;
    this.nameplate.visible = visible;
    this.healthBar.visible = visible;
    if (visible) {
      // Constant screen size up close, shrinking gently far away.
      const scale = clamp(dist * 0.035, 0.5, 1.6);
      this.nameplate.scale.set(1.7 * scale, 0.34 * scale, 1);
      this.healthBar.scale.set(1.0 * scale, 0.1 * scale, 1);
      const material = this.healthBar.material as THREE.SpriteMaterial;
      material.opacity = state.health < 100 ? 0.95 : 0;
      const bar = this.healthBar;
      bar.scale.x *= clamp(state.health / 100, 0.02, 1);
    }
  }

  get animationState(): AnimationStateId {
    return this.currentState;
  }

  private attachSkinned(identity: PlayerIdentity | undefined): void {
    if (this.skinned) return;
    const inst = instantiateCharacter('soldier', lookFromIdentity(identity));
    if (!inst) return;
    this.skinned = inst;
    this.root.add(inst.root);
    this.weaponHolder.removeFromParent();
    this.root.add(this.weaponHolder);
    this.torsoPivot.visible = false;
    for (const mesh of this.proxyMeshes) mesh.visible = false;
  }

  private syncWeaponToHand(): void {
    const hand = this.skinned?.bones.handR;
    if (!hand) return;
    hand.updateWorldMatrix(true, false);
    hand.getWorldPosition(this.handWorld);
    hand.getWorldQuaternion(this.handQuat);
    this.root.worldToLocal(this.handWorld);
    this.weaponHolder.position.copy(this.handWorld);
    this.root.getWorldQuaternion(this.parentInv);
    this.parentInv.invert();
    this.weaponHolder.quaternion.copy(this.parentInv).multiply(this.handQuat);
    this.weaponHolder.rotation.x += 1.2;
  }

  private equipWeapon(index: number): void {
    if (index === this.currentWeapon) return;
    this.currentWeapon = index;
    const keep = new Set<THREE.Object3D>([this.muzzlePoint]);
    for (const child of [...this.weaponHolder.children]) {
      if (!keep.has(child)) this.weaponHolder.remove(child);
    }
    for (const item of this.weaponDisposables) item.dispose();
    this.weaponDisposables.length = 0;
    const def = getWeapon(weaponFromIndex(index));
    const built = buildWeaponMesh(def, this.weaponDisposables);
    built.root.scale.setScalar(0.92);
    this.weaponHolder.add(built.root);
    this.muzzlePoint.position.set(...muzzleOffsetFor(def));
    this.attachAvatarWeapon(def.id, def.visual.size[2]);
  }

  private attachAvatarWeapon(id: string, length: number): void {
    const token = this.currentWeapon;
    const apply = (visual: THREE.Object3D): void => {
      if (token !== this.currentWeapon) return;
      const keep = new Set<THREE.Object3D>([this.muzzlePoint]);
      for (const child of [...this.weaponHolder.children]) {
        if (!keep.has(child)) this.weaponHolder.remove(child);
      }
      visual.scale.setScalar(0.92);
      this.weaponHolder.add(visual);
    };
    const ready = instantiateWeaponVisual(id, length, { lod: false, shadows: true });
    if (ready) {
      apply(ready);
      return;
    }
    void loadWeaponModel(id).then((clone) => {
      if (!clone || token !== this.currentWeapon) return;
      apply(prepareWeaponVisual(clone, length, { lod: false, shadows: true, id }));
    });
  }

  dispose(): void {
    this.skinned?.dispose();
    this.skinned = null;
    this.bodyMaterial.dispose();
    for (const item of this.weaponDisposables) item.dispose();
    (this.muzzleCore.material as THREE.SpriteMaterial).dispose();
    (this.muzzleStar.material as THREE.SpriteMaterial).dispose();
    (this.nameplate.material as THREE.SpriteMaterial).map?.dispose();
    (this.nameplate.material as THREE.SpriteMaterial).dispose();
    (this.healthBar.material as THREE.SpriteMaterial).dispose();
    this.muzzleLight.dispose();
    this.root.removeFromParent();
  }
}

/** Geometry and materials shared by every avatar; created once per session. */
export class SharedAvatarAssets {
  readonly torsoGeometry = new THREE.CapsuleGeometry(PLAYER_RADIUS * 0.82, 0.52, 4, 10);
  readonly headGeometry = new THREE.SphereGeometry(0.16, 14, 10);
  readonly visorGeometry = new THREE.BoxGeometry(0.2, 0.07, 0.06);
  readonly legGeometry = new THREE.CapsuleGeometry(0.1, 0.52, 3, 8);
  readonly armGeometry = new THREE.CapsuleGeometry(0.075, 0.38, 3, 8);
  readonly weaponGeometry = new THREE.BoxGeometry(0.08, 0.12, 0.62);

  readonly bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.12 });
  readonly limbMaterial = new THREE.MeshStandardMaterial({
    color: 0x2b3038,
    roughness: 0.7,
    metalness: 0.1,
  });
  readonly headMaterial = new THREE.MeshStandardMaterial({
    color: 0x1d2127,
    roughness: 0.45,
    metalness: 0.3,
  });
  readonly visorMaterial = new THREE.MeshStandardMaterial({
    color: 0x9fe8ff,
    emissive: new THREE.Color(0x3fb6d8),
    emissiveIntensity: 1.4,
    roughness: 0.2,
    metalness: 0.6,
  });
  readonly weaponMaterial = new THREE.MeshStandardMaterial({
    color: 0x23262b,
    roughness: 0.5,
    metalness: 0.65,
  });

  dispose(): void {
    this.torsoGeometry.dispose();
    this.headGeometry.dispose();
    this.visorGeometry.dispose();
    this.legGeometry.dispose();
    this.armGeometry.dispose();
    this.weaponGeometry.dispose();
    this.bodyMaterial.dispose();
    this.limbMaterial.dispose();
    this.headMaterial.dispose();
    this.visorMaterial.dispose();
    this.weaponMaterial.dispose();
  }
}

function makeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '600 34px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, 128, 34, 240);
  ctx.fillStyle = '#f2f5f8';
  ctx.fillText(text, 128, 34, 240);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: true,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.7, 0.34, 1);
  return sprite;
}

function makeHealthSprite(): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    color: 0x67e08a,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1, 0.1, 1);
  return sprite;
}

function speedForClip(velocity: { x: number; y: number; z: number }): number {
  return Math.hypot(velocity.x, velocity.z);
}

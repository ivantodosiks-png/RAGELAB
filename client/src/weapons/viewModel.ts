import * as THREE from 'three';
import { clamp, lerp, type Vec3, type WeaponDefinition } from '@ragelab/shared';
import { muzzleCoreTexture, muzzleStarTexture } from '../renderer/textures';
import { buildWeaponMesh, ejectOffsetFor, muzzleOffsetFor } from './weaponMeshes';
import { instantiateWeaponVisual, loadWeaponModel, prepareWeaponVisual, weaponModelUrl } from './weaponAssets';

/**
 * First-person weapon model.
 *
 * Built procedurally from the weapon definition so a new weapon needs no art.
 * The muzzle flash lives *on the barrel* in the view-model scene — otherwise
 * the overlay pass would hide a world-space sprite behind the gun.
 */
export class WeaponViewModel {
  readonly root = new THREE.Group();

  private readonly holder = new THREE.Group();
  private readonly recoilPivot = new THREE.Group();
  private readonly model = new THREE.Group();
  private readonly muzzlePoint = new THREE.Object3D();
  private readonly ejectPoint = new THREE.Object3D();
  private readonly flash: ViewMuzzleFlash;

  private def: WeaponDefinition | null = null;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private magRestY = 0;
  private slidePart: THREE.Object3D | null = null;
  private readonly slideRest = new THREE.Vector3();
  private slideKick = 0;
  private redDot: THREE.Sprite | null = null;
  private redDotBloom: THREE.Sprite | null = null;

  /** 0 = hip, 1 = fully aimed. */
  private aimBlend = 0;
  private aimTarget = 0;

  private recoilOffset = 0;
  private recoilPitch = 0;
  private readonly swayOffset = new THREE.Vector2();
  private readonly swayTarget = new THREE.Vector2();
  private bobPhase = 0;

  private reloadProgress = 0;
  private reloadDurationSec = 0;
  private equipProgress = 1;
  private equipDurationSec = 0.3;

  private readonly hipPosition = new THREE.Vector3();
  private readonly aimPosition = new THREE.Vector3();
  private readonly worldPosition = new THREE.Vector3();
  private readonly worldDirection = new THREE.Vector3();
  private readonly worldRight = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3();

  constructor() {
    this.root.name = 'viewModel';
    this.root.add(this.holder);
    this.holder.add(this.recoilPivot);
    this.recoilPivot.add(this.model);
    this.model.add(this.muzzlePoint);
    this.model.add(this.ejectPoint);
    this.flash = new ViewMuzzleFlash();
    this.muzzlePoint.add(this.flash.root);
  }

  /** Rebuild the mesh for a new weapon and play the raise animation. */
  equip(def: WeaponDefinition): void {
    this.def = def;
    this.disposeModel();
    this.slidePart = null;
    this.slideKick = 0;
    this.clearRedDot();

    const built = buildWeaponMesh(def, this.disposables);
    this.model.add(built.root);
    this.magRestY = built.magRestY;
    this.attachGltf(def);

    this.muzzlePoint.position.set(...muzzleOffsetFor(def));
    this.ejectPoint.position.set(...ejectOffsetFor(def));

    this.hipPosition.set(...def.visual.hipPosition);
    this.aimPosition.set(...def.visual.aimPosition);
    this.holder.position.copy(this.hipPosition);

    this.equipDurationSec = def.equipMs / 1000;
    this.equipProgress = 0;
    this.reloadProgress = 0;
  }

  triggerFlash(scale: number): void {
    this.flash.trigger(scale);
  }

  setAiming(aiming: boolean): void {
    this.aimTarget = aiming ? 1 : 0;
  }

  get aimAmount(): number {
    return this.aimBlend;
  }

  startReload(durationMs: number): void {
    this.reloadDurationSec = durationMs / 1000;
    this.reloadProgress = 0.0001;
  }

  get isReloading(): boolean {
    return this.reloadProgress > 0 && this.reloadProgress < 1;
  }

  /** Kick the model backwards; `strength` comes from the weapon recoil profile. */
  kick(strength: number): void {
    this.recoilOffset = Math.min(this.recoilOffset + strength, 0.22);
    this.recoilPitch = Math.min(this.recoilPitch + strength * 3.2, 0.6);
    // Glock slide: hard rearward snap, fast return.
    if (this.slidePart) this.slideKick = 1;
  }

  /** Mouse movement drives a lagging sway; called with the frame's aim delta. */
  addAimDelta(yawDelta: number, pitchDelta: number): void {
    this.swayTarget.x = clamp(this.swayTarget.x + yawDelta * 0.6, -0.06, 0.06);
    this.swayTarget.y = clamp(this.swayTarget.y + pitchDelta * 0.6, -0.05, 0.05);
  }

  update(dt: number, speedRatio: number, grounded: boolean, crouching: boolean): void {
    if (!this.def) return;

    this.aimBlend = lerp(
      this.aimBlend,
      this.aimTarget,
      1 - Math.exp(-(1000 / Math.max(60, this.def.aimTimeMs)) * dt * 3.2),
    );

    // Sway decays toward zero; the target itself decays so flicks feel snappy.
    this.swayTarget.multiplyScalar(Math.exp(-7 * dt));
    this.swayOffset.x = lerp(this.swayOffset.x, this.swayTarget.x, 1 - Math.exp(-12 * dt));
    this.swayOffset.y = lerp(this.swayOffset.y, this.swayTarget.y, 1 - Math.exp(-12 * dt));

    this.recoilOffset = lerp(this.recoilOffset, 0, 1 - Math.exp(-14 * dt));
    this.recoilPitch = lerp(this.recoilPitch, 0, 1 - Math.exp(-12 * dt));
    this.slideKick = lerp(this.slideKick, 0, 1 - Math.exp(-42 * dt));
    if (this.slidePart) {
      // Travel ~22 mm — snappy cycle reads better than a slow crawl.
      this.slidePart.position.set(
        this.slideRest.x,
        this.slideRest.y,
        this.slideRest.z + this.slideKick * 0.022,
      );
    }

    this.equipProgress = Math.min(1, this.equipProgress + dt / Math.max(0.05, this.equipDurationSec));

    if (this.reloadProgress > 0 && this.reloadProgress < 1) {
      this.reloadProgress = Math.min(
        1,
        this.reloadProgress + dt / Math.max(0.1, this.reloadDurationSec),
      );
    }

    // Weapon bob, damped hard while aiming so sights stay usable.
    const bobScale = (1 - this.aimBlend * 0.85) * (grounded ? 1 : 0.25);
    this.bobPhase += dt * (7 + speedRatio * 5);
    const bobX = Math.sin(this.bobPhase) * 0.012 * speedRatio * bobScale;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.01 * speedRatio * bobScale;

    // Position: blend hip -> aim, then layer bob, sway, recoil and animations.
    const target = this.holder.position;
    target.x = lerp(this.hipPosition.x, this.aimPosition.x, this.aimBlend) + bobX + this.swayOffset.x;
    target.y =
      lerp(this.hipPosition.y, this.aimPosition.y, this.aimBlend) -
      bobY +
      this.swayOffset.y -
      (crouching ? 0.015 : 0);
    target.z = lerp(this.hipPosition.z, this.aimPosition.z, this.aimBlend) + this.recoilOffset;

    // Raise animation on equip.
    const equipEase = 1 - (1 - this.equipProgress) ** 3;
    target.y -= (1 - equipEase) * 0.32;
    this.holder.rotation.x = (1 - equipEase) * -0.5;
    this.holder.rotation.z = (1 - equipEase) * 0.35;

    // Reload animation: dip the weapon, swap the mag at the halfway point.
    if (this.reloadProgress > 0 && this.reloadProgress < 1) {
      const p = this.reloadProgress;
      const dip = Math.sin(p * Math.PI);
      target.y -= dip * 0.16;
      target.z += dip * 0.05;
      this.holder.rotation.x += dip * 0.55;
      this.holder.rotation.z += dip * 0.22;

      const magazine = this.model.getObjectByName('magazine');
      if (magazine) {
        // Magazine drops out in the first half, new one slides in during the second.
        const magPhase = p < 0.45 ? p / 0.45 : p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
        magazine.position.y = this.magRestY - magPhase * 0.14;
        magazine.visible = !(p > 0.45 && p < 0.6);
      }
    } else {
      const magazine = this.model.getObjectByName('magazine');
      if (magazine) {
        magazine.position.y = this.magRestY;
        magazine.visible = true;
      }
    }

    this.recoilPivot.rotation.x = this.recoilPitch;
    this.model.rotation.y = this.swayOffset.x * 2.2;
    if (this.redDot && this.redDotBloom) {
      // Brighten the collimator reticle as you settle into ADS.
      const glow = 0.55 + this.aimBlend * 0.45;
      const core = this.redDot.material as THREE.SpriteMaterial;
      const bloom = this.redDotBloom.material as THREE.SpriteMaterial;
      core.opacity = glow;
      bloom.opacity = glow * 0.55;
      const s = 0.0065 + this.aimBlend * 0.0015;
      this.redDot.scale.setScalar(s);
      this.redDotBloom.scale.setScalar(s * 2.4);
    }
    this.flash.update(dt);
  }

  /** World-space muzzle transform, used to place flashes and shell ejection. */
  muzzleTransform(out: { position: Vec3; direction: Vec3 }): void {
    this.muzzlePoint.getWorldPosition(this.worldPosition);
    this.muzzlePoint.getWorldDirection(this.worldDirection);
    out.position.x = this.worldPosition.x;
    out.position.y = this.worldPosition.y;
    out.position.z = this.worldPosition.z;
    out.direction.x = -this.worldDirection.x;
    out.direction.y = -this.worldDirection.y;
    out.direction.z = -this.worldDirection.z;
  }

  ejectTransform(out: { position: Vec3; right: Vec3; up: Vec3 }): void {
    this.ejectPoint.getWorldPosition(this.worldPosition);
    this.ejectPoint.matrixWorld.extractBasis(this.worldRight, this.worldUp, this.worldDirection);
    out.position.x = this.worldPosition.x;
    out.position.y = this.worldPosition.y;
    out.position.z = this.worldPosition.z;
    out.right.x = this.worldRight.x;
    out.right.y = this.worldRight.y;
    out.right.z = this.worldRight.z;
    out.up.x = this.worldUp.x;
    out.up.y = this.worldUp.y;
    out.up.z = this.worldUp.z;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  private disposeModel(): void {
    this.clearRedDot();
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.model.clear();
    this.model.add(this.muzzlePoint);
    this.model.add(this.ejectPoint);
  }

  private attachGltf(def: WeaponDefinition): void {
    const url = weaponModelUrl(def.id);
    if (!url) return;
    const length = Math.max(def.visual.size[2], 0.2);
    const apply = (visual: THREE.Object3D): void => {
      if (this.def?.id !== def.id) {
        visual.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) mat.dispose();
        });
        return;
      }
      const procedural = this.model.children.find((child) => child !== this.muzzlePoint && child !== this.ejectPoint);
      if (procedural) this.model.remove(procedural);
      visual.name = 'weaponGltf';
      // Keep the fitted origin; only a tiny forward nudge so the grip clears
      // the near plane without rotating the barrel toward the camera.
      visual.position.z -= 0.02;
      this.model.add(visual);
      this.bindAnimatedParts(visual, def);
    };
    const ready = instantiateWeaponVisual(def.id, length, { lod: false, shadows: false });
    if (ready) {
      apply(ready);
      return;
    }
    void loadWeaponModel(def.id).then((clone) => {
      if (!clone) return;
      apply(prepareWeaponVisual(clone, length, { lod: false, shadows: false, id: def.id }));
    });
  }

  private bindAnimatedParts(visual: THREE.Object3D, def: WeaponDefinition): void {
    const slide =
      visual.getObjectByName('slide') ??
      visual.getObjectByName('Slide') ??
      visual.getObjectByName('Glock17 Slide');
    this.slidePart = slide ?? null;
    if (this.slidePart) this.slideRest.copy(this.slidePart.position);

    const magazine = visual.getObjectByName('magazine') ?? visual.getObjectByName('Magazine');
    if (magazine) {
      this.magRestY = magazine.position.y;
      // Keep the canonical name so the reload dip finds it.
      magazine.name = 'magazine';
    }

    // Nudge muzzle/eject to the fitted mesh tip for authored pistols / rifles.
    if (def.id === 'glock' || def.id === 'rifle') {
      visual.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(visual);
      const spanY = box.max.y - box.min.y;
      const spanZ = box.max.z - box.min.z;
      const muzzleZ = box.min.z - 0.004;
      // Rifle barrel sits mid-height; optic (Visier) is above.
      const muzzleY =
        def.id === 'rifle'
          ? box.min.y + spanY * 0.48
          : box.min.y + spanY * 0.62;
      this.muzzlePoint.position.set(0, muzzleY, muzzleZ);
      this.ejectPoint.position.set(
        box.max.x * 0.45,
        muzzleY + spanY * 0.08,
        box.min.z + spanZ * (def.id === 'rifle' ? 0.42 : 0.15),
      );
    }

    if (def.collimator) this.attachCollimatorDot(visual);
  }

  private attachCollimatorDot(visual: THREE.Object3D): void {
    this.clearRedDot();
    visual.updateMatrixWorld(true);

    // Prefer the Visier / optic material bounds; fall back to top-forward of the gun.
    let opticBox: THREE.Box3 | null = null;
    visual.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const optic = mats.some((m) => m && /visier|optic|scope|glass/i.test((m as THREE.Material).name || ''));
      if (!optic) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (!mesh.geometry.boundingBox) return;
      const b = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      opticBox = opticBox ? opticBox.union(b) : b;
    });

    const gunBox = new THREE.Box3().setFromObject(visual);
    const box = opticBox ?? gunBox;
    const center = box.getCenter(new THREE.Vector3());
    // Sit the reticle in the optic window, slightly toward the shooter so it reads through the glass.
    const local = visual.worldToLocal(center.clone());
    if (!opticBox) {
      local.y = gunBox.max.y - (gunBox.max.y - gunBox.min.y) * 0.08;
      local.z = gunBox.min.z + (gunBox.max.z - gunBox.min.z) * 0.58;
      local.x = 0;
    } else {
      local.z += 0.006;
    }

    const makeDot = (color: number, size: number, opacity: number): THREE.Sprite => {
      const mat = new THREE.SpriteMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.setScalar(size);
      sprite.position.copy(local);
      sprite.renderOrder = 40;
      sprite.frustumCulled = false;
      return sprite;
    };

    this.redDot = makeDot(0xff2a1a, 0.007, 0.9);
    this.redDotBloom = makeDot(0xff5533, 0.017, 0.45);
    this.redDot.name = 'collimatorDot';
    this.redDotBloom.name = 'collimatorBloom';
    visual.add(this.redDot, this.redDotBloom);
  }

  private clearRedDot(): void {
    for (const sprite of [this.redDot, this.redDotBloom]) {
      if (!sprite) continue;
      sprite.removeFromParent();
      (sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.redDot = null;
    this.redDotBloom = null;
  }

  dispose(): void {
    this.disposeModel();
    this.flash.dispose();
    this.root.clear();
  }
}

class ViewMuzzleFlash {
  readonly root = new THREE.Group();
  private readonly core: THREE.Sprite;
  private readonly bloom: THREE.Sprite;
  private readonly star: THREE.Sprite;
  private readonly streaks: THREE.Mesh[] = [];
  private readonly jets: THREE.Mesh[] = [];
  private readonly light: THREE.PointLight;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private life = 0;
  private strength = 1;

  constructor() {
    const additiveSprite = (map: THREE.Texture, color: number, order: number): THREE.Sprite => {
      const mat = new THREE.SpriteMaterial({
        map,
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = order;
      return sprite;
    };

    this.core = additiveSprite(muzzleCoreTexture(), 0xffffff, 24);
    this.bloom = additiveSprite(muzzleCoreTexture(), 0xffc070, 22);
    this.star = additiveSprite(muzzleStarTexture(), 0xfff4c8, 23);

    const streakGeo = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(streakGeo);
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: muzzleCoreTexture(),
        color: 0xffe7a8,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(streakGeo, mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.rotation.z = i * (Math.PI / 2);
      mesh.position.z = -0.22;
      mesh.visible = false;
      mesh.renderOrder = 21;
      this.streaks.push(mesh);
      this.root.add(mesh);
    }

    const jetGeo = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(jetGeo);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: muzzleStarTexture(),
        color: 0xffd080,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(jetGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 20;
      this.jets.push(mesh);
      this.root.add(mesh);
    }

    this.light = new THREE.PointLight(0xffd090, 0, 7.5, 1.45);
    this.light.visible = false;

    this.root.add(this.core, this.bloom, this.star, this.light);
  }

  trigger(scale: number): void {
    this.strength = Math.max(0.95, scale);
    this.life = 1;
    this.core.visible = true;
    this.bloom.visible = true;
    this.star.visible = true;
    this.light.visible = true;
    this.star.material.rotation = Math.random() * Math.PI;
    const spin = Math.random() * Math.PI * 2;
    for (let i = 0; i < this.jets.length; i++) {
      const mesh = this.jets[i]!;
      mesh.visible = true;
      const a = spin + (i / this.jets.length) * Math.PI * 2;
      mesh.rotation.set(Math.PI / 2, 0, a);
      mesh.position.set(Math.sin(a) * 0.014, Math.cos(a) * 0.014, -0.035);
    }
    for (const streak of this.streaks) streak.visible = true;
  }

  update(dt: number): void {
    if (this.life <= 0) return;
    this.life = Math.max(0, this.life - dt * 8.2);
    const pulse = Math.pow(this.life, 0.38);
    const s = this.strength;
    this.core.scale.setScalar((0.18 + (1 - this.life) * 0.12) * s);
    this.bloom.scale.setScalar((0.46 + (1 - this.life) * 0.28) * s);
    this.star.scale.setScalar((0.58 + (1 - this.life) * 0.24) * s);
    (this.core.material as THREE.SpriteMaterial).opacity = Math.min(1, pulse * 1.25);
    (this.bloom.material as THREE.SpriteMaterial).opacity = pulse * 0.85;
    (this.star.material as THREE.SpriteMaterial).opacity = pulse * 1.05;

    for (const streak of this.streaks) {
      streak.scale.set(0.09 * s, (0.72 + (1 - this.life) * 0.38) * s, 1);
      (streak.material as THREE.MeshBasicMaterial).opacity = pulse * 1.0;
    }
    for (const jet of this.jets) {
      jet.scale.set(0.11 * s, (0.36 + (1 - this.life) * 0.18) * s, 1);
      (jet.material as THREE.MeshBasicMaterial).opacity = pulse * 0.95;
    }

    this.light.intensity = 72 * pulse * s;
    if (this.life <= 0) this.hide();
  }

  private hide(): void {
    this.core.visible = false;
    this.bloom.visible = false;
    this.star.visible = false;
    this.light.visible = false;
    for (const mesh of this.streaks) mesh.visible = false;
    for (const mesh of this.jets) mesh.visible = false;
  }

  dispose(): void {
    (this.core.material as THREE.SpriteMaterial).dispose();
    (this.bloom.material as THREE.SpriteMaterial).dispose();
    (this.star.material as THREE.SpriteMaterial).dispose();
    for (const mesh of this.streaks) (mesh.material as THREE.Material).dispose();
    for (const mesh of this.jets) (mesh.material as THREE.Material).dispose();
    for (const geo of this.geometries) geo.dispose();
    this.light.dispose();
    this.root.clear();
  }
}

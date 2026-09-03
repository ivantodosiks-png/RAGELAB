import * as THREE from 'three';
import {
  PARTICLE_BUDGETS,
  QualityLevel,
  getArchetype,
  type GraphicsSettings,
  type PropKind,
  type SurfaceId,
  type Vec3,
  type WeaponDefinition,
} from '@ragelab/shared';
import { ParticlePool } from './particlePool';
import { DecalPool } from './decalPool';
import { TracerPool } from './tracerPool';
import { BodyBloodPool } from './bodyBlood';
import { muzzleStarTexture } from '../renderer/textures';

interface SurfaceLook {
  spark: number;
  dust: number;
  dustEnd: number;
  sparkChance: number;
  decal: 'bullet' | 'scorch';
}

const SURFACE_LOOKS: Record<SurfaceId, SurfaceLook> = {
  concrete: { spark: 0xffd9a0, dust: 0xbdb6a8, dustEnd: 0x6f6a62, sparkChance: 0.25, decal: 'bullet' },
  metal: { spark: 0xfff0c0, dust: 0xa8adb5, dustEnd: 0x5c6068, sparkChance: 1.0, decal: 'bullet' },
  wood: { spark: 0xc98a4b, dust: 0xa87848, dustEnd: 0x5f4527, sparkChance: 0.15, decal: 'bullet' },
  sand: { spark: 0xd9c79a, dust: 0xd2bd8f, dustEnd: 0x8a7a56, sparkChance: 0.0, decal: 'bullet' },
  glass: { spark: 0xdff4ff, dust: 0xcfe6f2, dustEnd: 0x8fb3c4, sparkChance: 0.8, decal: 'bullet' },
  rubber: { spark: 0x555555, dust: 0x3d3d3d, dustEnd: 0x1f1f1f, sparkChance: 0.0, decal: 'scorch' },
  grass: { spark: 0x9ad46a, dust: 0x6f9a4a, dustEnd: 0x3c5a2a, sparkChance: 0.0, decal: 'bullet' },
};

/**
 * All transient visuals live here: impacts, muzzle flashes, explosions, debris,
 * blood and tracers. Every subsystem is pooled and sized from the graphics
 * quality preset, so LOW genuinely costs less rather than just looking worse.
 */
export class EffectsManager {
  readonly root = new THREE.Group();

  private readonly particles: ParticlePool;
  private readonly decals: DecalPool;
  private readonly tracers: TracerPool;
  private readonly bodyBlood: BodyBloodPool;

  private settings: GraphicsSettings;
  private budget = PARTICLE_BUDGETS[QualityLevel.High]!;

  private readonly muzzleFlashes: Array<{
    sprite: THREE.Sprite;
    light: THREE.PointLight;
    life: number;
  }> = [];
  private muzzleCursor = 0;

  private readonly tmpVec = new THREE.Vector3();

  constructor(settings: GraphicsSettings) {
    this.root.name = 'effects';
    this.settings = settings;
    this.budget = PARTICLE_BUDGETS[settings.particles] ?? this.budget;

    this.particles = new ParticlePool(this.budget.max);
    this.decals = new DecalPool(this.budget.decals);
    this.tracers = new TracerPool(64);
    this.bodyBlood = new BodyBloodPool(Math.max(16, Math.floor(this.budget.decals / 2)));

    this.root.add(this.particles.points, this.decals.root, this.tracers.root);
    this.buildMuzzleFlashes();
  }

  private buildMuzzleFlashes(): void {
    const material = new THREE.SpriteMaterial({
      map: muzzleStarTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    for (let i = 0; i < 8; i++) {
      const sprite = new THREE.Sprite(material.clone());
      sprite.visible = false;
      sprite.renderOrder = 9;
      this.root.add(sprite);
      const light = new THREE.PointLight(0xffc880, 0, 9, 2);
      light.visible = false;
      this.root.add(light);
      this.muzzleFlashes.push({ sprite, light, life: 0 });
    }
  }

  applySettings(settings: GraphicsSettings): void {
    this.settings = settings;
    this.budget = PARTICLE_BUDGETS[settings.particles] ?? this.budget;
  }

  setSoftCap(maxLive: number): void {
    this.particles.setSoftCap(maxLive);
  }

  setViewportHeight(height: number): void {
    this.particles.setPixelScale(height);
  }

  get particleCount(): number {
    return this.particles.active;
  }

  private get effectsScale(): number {
    switch (this.settings.effects) {
      case QualityLevel.Low:
        return 0.35;
      case QualityLevel.Medium:
        return 0.65;
      case QualityLevel.High:
        return 1;
      default:
        return 1.4;
    }
  }

  // ── impacts ───────────────────────────────────────────────────────────────

  bulletImpact(position: Vec3, normal: Vec3, surface: SurfaceId, strength: number, nowMs: number): void {
    const look = SURFACE_LOOKS[surface] ?? SURFACE_LOOKS.concrete;
    const count = Math.max(1, Math.round(this.budget.impactCount * this.effectsScale * strength));

    for (let i = 0; i < count; i++) {
      // Cone around the surface normal with a wide scatter.
      const dir = scatter(normal, 0.9);
      const speed = 1.6 + Math.random() * 4.5 * strength;
      this.particles.spawn({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: dir.x * speed,
        vy: dir.y * speed,
        vz: dir.z * speed,
        life: 0.28 + Math.random() * 0.4,
        size: 0.035 + Math.random() * 0.03,
        sizeEnd: 0.008,
        color: look.dust,
        colorEnd: look.dustEnd,
        gravity: 0.85,
        drag: 2.4,
      });
    }

    if (Math.random() < look.sparkChance) {
      const sparks = Math.max(2, Math.round(6 * this.effectsScale));
      for (let i = 0; i < sparks; i++) {
        const dir = scatter(normal, 0.75);
        const speed = 5 + Math.random() * 9;
        this.particles.spawn({
          x: position.x,
          y: position.y,
          z: position.z,
          vx: dir.x * speed,
          vy: dir.y * speed,
          vz: dir.z * speed,
          life: 0.18 + Math.random() * 0.22,
          size: 0.028,
          sizeEnd: 0.004,
          color: 0xfff4d0,
          colorEnd: look.spark,
          gravity: 1.1,
          drag: 1.2,
        });
      }
    }

    // Small puff of smoke that drifts upward.
    if (this.settings.effects !== QualityLevel.Low) {
      this.particles.spawn({
        x: position.x + normal.x * 0.05,
        y: position.y + normal.y * 0.05,
        z: position.z + normal.z * 0.05,
        vx: normal.x * 0.5,
        vy: normal.y * 0.5 + 0.35,
        vz: normal.z * 0.5,
        life: 0.7 + Math.random() * 0.4,
        size: 0.12,
        sizeEnd: 0.5,
        color: look.dust,
        colorEnd: look.dustEnd,
        gravity: 0,
        drag: 1.8,
        buoyancy: 0.55,
        fadeIn: 0.15,
      });
    }

    this.decals.spawn(look.decal, position, normal, 0.14 + strength * 0.1, nowMs);
  }

  bloodEffect(position: Vec3, normal: Vec3, nowMs: number, scale = 1, surface = true): void {
    const count = Math.max(2, Math.round(8 * this.effectsScale * scale));
    for (let i = 0; i < count; i++) {
      const dir = scatter(normal, 1.1);
      const speed = 2 + Math.random() * 5 * scale;
      this.particles.spawn({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: dir.x * speed,
        vy: dir.y * speed + 1,
        vz: dir.z * speed,
        life: 0.32 + Math.random() * 0.28,
        size: 0.035 + Math.random() * 0.03 * scale,
        sizeEnd: 0.01,
        color: 0xb4232a,
        colorEnd: 0x5c0d12,
        gravity: 1.4,
        drag: 1.1,
      });
    }
    if (surface) this.decals.spawn('blood', position, normal, 0.28 + 0.18 * scale, nowMs);
  }

  npcHitEffect(
    position: Vec3,
    normal: Vec3,
    nowMs: number,
    zone: string,
    killed: boolean,
    attach?: THREE.Object3D | null,
  ): void {
    const head = zone === 'head';
    const limb = zone === 'arm' || zone === 'leg';
    const scale = killed ? (head ? 1.5 : 1.18) : head ? 0.95 : limb ? 0.48 : 0.62;
    const burst = Math.max(3, Math.round((head ? 11 : limb ? 6 : 8) * this.effectsScale * (killed ? 1.15 : 0.85)));
    for (let i = 0; i < burst; i++) {
      const dir = scatter(normal, head ? 0.85 : 1.15);
      const speed = (head ? 3.2 : 2.1) + Math.random() * (killed ? 5.5 : 3.4) * scale;
      this.particles.spawn({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: dir.x * speed,
        vy: dir.y * speed + 0.8,
        vz: dir.z * speed,
        life: 0.28 + Math.random() * 0.32,
        size: 0.032 + Math.random() * 0.028 * scale,
        sizeEnd: 0.008,
        color: i % 3 === 0 ? 0x7a1218 : 0xb4232a,
        colorEnd: 0x3a070c,
        gravity: 1.35,
        drag: 1.05,
      });
    }
    const splash = Math.max(2, Math.round((head ? 6 : 3) * this.effectsScale));
    for (let i = 0; i < splash; i++) {
      const speed = 4.2 + Math.random() * 3.6 * scale;
      this.particles.spawn({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: -normal.x * speed + (Math.random() - 0.5) * 1.4,
        vy: -normal.y * speed * 0.35 + 1.1 + Math.random(),
        vz: -normal.z * speed + (Math.random() - 0.5) * 1.4,
        life: 0.22 + Math.random() * 0.2,
        size: 0.04 + Math.random() * 0.025,
        sizeEnd: 0.01,
        color: 0xd12a32,
        colorEnd: 0x4a0c12,
        gravity: 1.6,
        drag: 0.85,
      });
    }
    if (attach) {
      this.tmpVec.set(position.x, position.y, position.z);
      this.bodyBlood.spawn(attach, this.tmpVec, 0.15 + 0.1 * scale, nowMs);
      if (killed || head) {
        this.tmpVec.x += (Math.random() - 0.5) * 0.04;
        this.tmpVec.y += 0.02;
        this.bodyBlood.spawn(attach, this.tmpVec, 0.1 + 0.06 * scale, nowMs);
      }
    } else {
      this.decals.spawn('blood', position, normal, 0.26 + 0.16 * scale, nowMs);
    }
    const sparks = killed ? 4 : 2;
    for (let i = 0; i < sparks; i++) {
      const dir = scatter(normal, 0.55);
      this.particles.spawn({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: dir.x * 3.5,
        vy: dir.y * 3.5 + 0.6,
        vz: dir.z * 3.5,
        life: 0.12 + Math.random() * 0.1,
        size: 0.028,
        sizeEnd: 0.006,
        color: 0xffe8c8,
        colorEnd: 0x8a2a2a,
        gravity: 0.4,
        drag: 2.4,
      });
    }
  }

  /** Pooled smear/decal on nearby geometry. Recycles through DecalPool + ParticlePool. */
  bloodSmear(position: Vec3, normal: Vec3, nowMs: number): void {
    const nlen = Math.hypot(normal.x, normal.y, normal.z) || 1;
    const nx = normal.x / nlen;
    const ny = normal.y / nlen;
    const nz = normal.z / nlen;
    this.decals.spawn('blood', position, { x: nx, y: ny, z: nz }, 0.22 + Math.random() * 0.16, nowMs);
    const drips = Math.max(1, Math.round(3 * this.effectsScale));
    for (let i = 0; i < drips; i++) {
      const dir = scatter({ x: nx, y: ny, z: nz }, 0.7);
      this.particles.spawn({
        x: position.x + nx * 0.02,
        y: position.y + ny * 0.02,
        z: position.z + nz * 0.02,
        vx: dir.x * 0.8,
        vy: dir.y * 0.4 - 1.2,
        vz: dir.z * 0.8,
        life: 0.35 + Math.random() * 0.25,
        size: 0.03,
        sizeEnd: 0.008,
        color: 0x8a161c,
        colorEnd: 0x3a070c,
        gravity: 1.8,
        drag: 1.4,
      });
    }
  }

  explosion(position: Vec3, radius: number, nowMs: number): void {
    const scale = this.effectsScale;
    const fireCount = Math.round(26 * scale);
    for (let i = 0; i < fireCount; i++) {
      const dir = randomDirection();
      const speed = radius * (0.4 + Math.random() * 1.1);
      this.particles.spawn({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: dir.x * speed,
        vy: dir.y * speed * 0.8 + 2,
        vz: dir.z * speed,
        life: 0.35 + Math.random() * 0.45,
        size: 0.35 + Math.random() * 0.4,
        sizeEnd: 0.9,
        color: 0xfff0b0,
        colorEnd: 0xd2481a,
        gravity: 0.1,
        drag: 2.2,
      });
    }

    const smokeCount = Math.round(18 * scale);
    for (let i = 0; i < smokeCount; i++) {
      const dir = randomDirection();
      this.particles.spawn({
        x: position.x + dir.x * radius * 0.3,
        y: position.y + Math.abs(dir.y) * radius * 0.2,
        z: position.z + dir.z * radius * 0.3,
        vx: dir.x * 2.2,
        vy: 1.4 + Math.random() * 1.6,
        vz: dir.z * 2.2,
        life: 1.6 + Math.random() * 1.4,
        size: 0.7,
        sizeEnd: 3.2,
        color: 0x4a443e,
        colorEnd: 0x1d1b19,
        gravity: 0,
        drag: 1.1,
        buoyancy: 0.9,
        fadeIn: 0.12,
      });
    }

    const debrisCount = Math.round(this.budget.debris * 1.6 * scale);
    for (let i = 0; i < debrisCount; i++) {
      const dir = randomDirection();
      const speed = 6 + Math.random() * 14;
      this.particles.spawn({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: dir.x * speed,
        vy: Math.abs(dir.y) * speed + 4,
        vz: dir.z * speed,
        life: 1.1 + Math.random() * 0.9,
        size: 0.05,
        sizeEnd: 0.03,
        color: 0x2e2a26,
        gravity: 1,
        drag: 0.4,
      });
    }

    this.decals.spawn('scorch', position, { x: 0, y: 1, z: 0 }, radius * 0.8, nowMs);

    // A bright flash that dies within a couple of frames.
    const flash = this.muzzleFlashes[this.muzzleCursor]!;
    this.muzzleCursor = (this.muzzleCursor + 1) % this.muzzleFlashes.length;
    flash.sprite.position.set(position.x, position.y, position.z);
    flash.sprite.scale.setScalar(radius * 1.1);
    flash.sprite.visible = true;
    (flash.sprite.material as THREE.SpriteMaterial).opacity = 1;
    flash.light.position.copy(flash.sprite.position);
    flash.light.color.setHex(0xffa860);
    flash.light.intensity = 60;
    flash.light.distance = radius * 4;
    flash.light.visible = this.settings.quality !== QualityLevel.Low;
    flash.life = 0.22;
  }

  propBreak(position: Vec3, kind: PropKind, nowMs: number): void {
    const archetype = getArchetype(kind);
    const color = archetype.material.color;
    const count = Math.round(this.budget.debris * 2 * this.effectsScale);
    for (let i = 0; i < count; i++) {
      const dir = randomDirection();
      const speed = 2.5 + Math.random() * 7;
      this.particles.spawn({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: dir.x * speed,
        vy: Math.abs(dir.y) * speed + 2,
        vz: dir.z * speed,
        life: 0.9 + Math.random() * 0.8,
        size: 0.07 + Math.random() * 0.06,
        sizeEnd: 0.03,
        color,
        gravity: 1,
        drag: 0.6,
      });
    }
    void nowMs;
  }

  muzzleFlash(position: Vec3, direction: Vec3, def: WeaponDefinition): void {
    const flash = this.muzzleFlashes[this.muzzleCursor]!;
    this.muzzleCursor = (this.muzzleCursor + 1) % this.muzzleFlashes.length;
    const scale = def.visual.muzzleFlashScale;

    flash.sprite.position.set(
      position.x + direction.x * 0.08,
      position.y + direction.y * 0.08,
      position.z + direction.z * 0.08,
    );
    flash.sprite.scale.setScalar(1.15 * scale);
    flash.sprite.visible = true;
    const material = flash.sprite.material as THREE.SpriteMaterial;
    material.color.setHex(0xffffff);
    material.opacity = 1;

    flash.light.position.copy(flash.sprite.position);
    flash.light.color.setHex(0xffc070);
    flash.light.intensity = 90 * scale;
    flash.light.distance = 22;
    flash.light.visible = this.settings.quality !== QualityLevel.Low;
    flash.life = 0.12;

    const sparkCount = Math.max(4, Math.round(10 * this.effectsScale * scale));
    for (let i = 0; i < sparkCount; i++) {
      const dir = scatter(direction, 0.55);
      const speed = 8 + Math.random() * 14;
      this.particles.spawn({
        x: flash.sprite.position.x,
        y: flash.sprite.position.y,
        z: flash.sprite.position.z,
        vx: dir.x * speed,
        vy: dir.y * speed + 1.5,
        vz: dir.z * speed,
        life: 0.08 + Math.random() * 0.1,
        size: 0.03,
        sizeEnd: 0.004,
        color: 0xfff4c8,
        colorEnd: 0xff6a18,
        gravity: 0.4,
        drag: 2.4,
      });
    }

    if (this.settings.effects !== QualityLevel.Low) {
      this.particles.spawn({
        x: flash.sprite.position.x,
        y: flash.sprite.position.y,
        z: flash.sprite.position.z,
        vx: direction.x * 1.2,
        vy: direction.y * 1.2 + 0.35,
        vz: direction.z * 1.2,
        life: 0.45,
        size: 0.1 * scale,
        sizeEnd: 0.42 * scale,
        color: 0xc8c2b4,
        colorEnd: 0x3a3834,
        gravity: 0,
        drag: 2.4,
        buoyancy: 0.45,
        fadeIn: 0.12,
      });
    }
  }

  tracer(
    origin: Vec3,
    direction: Vec3,
    length: number,
    def: WeaponDefinition,
    cameraPosition: THREE.Vector3,
  ): void {
    this.tracers.spawn(
      origin,
      direction,
      length,
      def.visual.tracerWidth,
      def.visual.tracerColor,
      cameraPosition,
    );
  }

  /** Brass ejected from the local view model. */
  shellEject(position: Vec3, right: Vec3, up: Vec3): void {
    this.particles.spawn({
      x: position.x,
      y: position.y,
      z: position.z,
      vx: right.x * 2.4 + up.x * 1.2 + (Math.random() - 0.5),
      vy: right.y * 2.4 + up.y * 1.2 + 1.4,
      vz: right.z * 2.4 + up.z * 1.2 + (Math.random() - 0.5),
      life: 1.1,
      size: 0.028,
      sizeEnd: 0.024,
      color: 0xd8a24a,
      gravity: 1,
      drag: 0.5,
    });
  }

  footstepDust(position: Vec3, surface: SurfaceId): void {
    if (this.settings.effects === QualityLevel.Low) return;
    const look = SURFACE_LOOKS[surface] ?? SURFACE_LOOKS.concrete;
    this.particles.spawn({
      x: position.x + (Math.random() - 0.5) * 0.2,
      y: position.y + 0.03,
      z: position.z + (Math.random() - 0.5) * 0.2,
      vx: (Math.random() - 0.5) * 0.4,
      vy: 0.25,
      vz: (Math.random() - 0.5) * 0.4,
      life: 0.5,
      size: 0.08,
      sizeEnd: 0.26,
      color: look.dust,
      colorEnd: look.dustEnd,
      gravity: 0,
      drag: 2.6,
      buoyancy: 0.2,
      fadeIn: 0.25,
    });
  }

  /** Body/world collision burst. Intensity scales with impact speed; pooled particles + decals. */
  physicsImpact(position: Vec3, normal: Vec3, speed: number): void {
    if (speed < 3.2) return;
    const strength = Math.min(2.4, 0.28 + speed / 11);
    const scale = this.effectsScale;
    const nowMs = performance.now();
    const nlen = Math.hypot(normal.x, normal.y, normal.z) || 1;
    const nx = normal.x / nlen;
    const ny = normal.y / nlen;
    const nz = normal.z / nlen;
    const look = SURFACE_LOOKS.concrete;

    const dust = Math.max(4, Math.round(10 * strength * scale));
    for (let i = 0; i < dust; i++) {
      const dir = scatter({ x: nx, y: ny, z: nz }, 1.05);
      const spd = (1.2 + Math.random() * 3.8) * strength;
      this.particles.spawn({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: dir.x * spd,
        vy: dir.y * spd + 0.4,
        vz: dir.z * spd,
        life: 0.28 + Math.random() * 0.45,
        size: 0.04 + Math.random() * 0.05 * strength,
        sizeEnd: 0.01,
        color: look.dust,
        colorEnd: look.dustEnd,
        gravity: 0.9,
        drag: 2.2,
      });
    }

    const splash = Math.max(6, Math.round(8 * strength * scale));
    for (let i = 0; i < splash; i++) {
      const a = (i / splash) * Math.PI * 2 + Math.random() * 0.3;
      const radial = 1.6 + Math.random() * 2.4 * strength;
      this.particles.spawn({
        x: position.x,
        y: position.y + 0.02,
        z: position.z,
        vx: Math.cos(a) * radial,
        vy: 1.1 + Math.random() * 2.2 * strength,
        vz: Math.sin(a) * radial,
        life: 0.22 + Math.random() * 0.28,
        size: 0.03 + Math.random() * 0.025,
        sizeEnd: 0.006,
        color: 0xe8dcc4,
        colorEnd: look.dustEnd,
        gravity: 1.15,
        drag: 1.6,
      });
    }

    if (strength > 0.7) {
      const sparks = Math.max(3, Math.round(5 * strength * scale));
      for (let i = 0; i < sparks; i++) {
        const dir = scatter({ x: nx, y: ny, z: nz }, 0.85);
        const spd = 4 + Math.random() * 9 * strength;
        this.particles.spawn({
          x: position.x,
          y: position.y,
          z: position.z,
          vx: dir.x * spd,
          vy: dir.y * spd + 1.2,
          vz: dir.z * spd,
          life: 0.12 + Math.random() * 0.18,
          size: 0.022,
          sizeEnd: 0.004,
          color: 0xfff2c4,
          colorEnd: 0xd48a3a,
          gravity: 1.1,
          drag: 1.1,
        });
      }
    }

    if (this.settings.effects !== QualityLevel.Low) {
      this.particles.spawn({
        x: position.x + nx * 0.04,
        y: position.y + ny * 0.04,
        z: position.z + nz * 0.04,
        vx: nx * 0.35,
        vy: ny * 0.35 + 0.45,
        vz: nz * 0.35,
        life: 0.55 + Math.random() * 0.35,
        size: 0.14 * strength,
        sizeEnd: 0.55 * strength,
        color: look.dust,
        colorEnd: look.dustEnd,
        gravity: 0,
        drag: 1.9,
        buoyancy: 0.5,
        fadeIn: 0.12,
      });
    }

    if (strength > 0.55) {
      this.decals.spawn('scorch', position, { x: nx, y: ny, z: nz }, 0.22 + strength * 0.18, nowMs);
    }
  }

  update(dt: number, nowMs: number): void {
    this.particles.update(dt);
    this.decals.update(nowMs);
    this.bodyBlood.update(nowMs);
    this.tracers.update(dt);

    for (const flash of this.muzzleFlashes) {
      if (flash.life <= 0) continue;
      flash.life -= dt;
      if (flash.life <= 0) {
        flash.sprite.visible = false;
        flash.light.visible = false;
        continue;
      }
      const material = flash.sprite.material as THREE.SpriteMaterial;
      material.opacity = Math.min(1, flash.life * 14);
      flash.light.intensity *= 0.72;
    }
  }

  clear(): void {
    this.particles.clear();
    this.decals.clear();
    this.bodyBlood.clear();
    this.tracers.clear();
    for (const flash of this.muzzleFlashes) {
      flash.sprite.visible = false;
      flash.light.visible = false;
      flash.life = 0;
    }
  }

  clearParticles(): void {
    this.particles.clear();
  }

  clearDecals(): void {
    this.decals.clear();
  }

  dispose(): void {
    this.particles.dispose();
    this.decals.dispose();
    this.bodyBlood.dispose();
    this.tracers.dispose();
    for (const flash of this.muzzleFlashes) {
      (flash.sprite.material as THREE.SpriteMaterial).dispose();
      flash.light.dispose();
    }
    this.muzzleFlashes.length = 0;
    this.root.clear();
  }
}

const SCATTER: Vec3 = { x: 0, y: 0, z: 0 };

/** Random unit vector within `spread` radians-ish of `normal`. */
function scatter(normal: Vec3, spread: number): Vec3 {
  const rx = (Math.random() - 0.5) * 2 * spread;
  const ry = (Math.random() - 0.5) * 2 * spread;
  const rz = (Math.random() - 0.5) * 2 * spread;
  let x = normal.x + rx;
  let y = normal.y + ry;
  let z = normal.z + rz;
  const len = Math.hypot(x, y, z) || 1;
  x /= len;
  y /= len;
  z /= len;
  SCATTER.x = x;
  SCATTER.y = y;
  SCATTER.z = z;
  return SCATTER;
}

function randomDirection(): Vec3 {
  const z = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  SCATTER.x = r * Math.cos(theta);
  SCATTER.y = z;
  SCATTER.z = r * Math.sin(theta);
  return SCATTER;
}

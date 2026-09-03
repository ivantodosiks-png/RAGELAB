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

    this.root.add(this.particles.points, this.decals.root, this.tracers.root);
    this.buildMuzzleFlashes();
  }

  private buildMuzzleFlashes(): void {
    const material = new THREE.SpriteMaterial({
      color: 0xffd9a0,
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

  bloodEffect(position: Vec3, normal: Vec3, nowMs: number): void {
    const count = Math.max(3, Math.round(9 * this.effectsScale));
    for (let i = 0; i < count; i++) {
      const dir = scatter(normal, 1.1);
      const speed = 2 + Math.random() * 5;
      this.particles.spawn({
        x: position.x,
        y: position.y,
        z: position.z,
        vx: dir.x * speed,
        vy: dir.y * speed + 1,
        vz: dir.z * speed,
        life: 0.35 + Math.random() * 0.3,
        size: 0.04 + Math.random() * 0.035,
        sizeEnd: 0.012,
        color: 0xb4232a,
        colorEnd: 0x5c0d12,
        gravity: 1.4,
        drag: 1.1,
      });
    }
    // A decal only lands if the shot was close to a surface; the caller passes
    // the impact normal so the splat sits flat against it.
    this.decals.spawn('blood', position, normal, 0.4, nowMs);
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

    flash.sprite.position.set(
      position.x + direction.x * 0.1,
      position.y + direction.y * 0.1,
      position.z + direction.z * 0.1,
    );
    flash.sprite.scale.setScalar(0.35 * def.visual.muzzleFlashScale);
    flash.sprite.visible = true;
    const material = flash.sprite.material as THREE.SpriteMaterial;
    material.color.setHex(def.visual.tracerColor);
    material.opacity = 1;

    flash.light.position.copy(flash.sprite.position);
    flash.light.color.setHex(def.visual.tracerColor);
    flash.light.intensity = 22 * def.visual.muzzleFlashScale;
    flash.light.distance = 9;
    flash.light.visible = this.settings.quality !== QualityLevel.Low;
    flash.life = 0.055;

    // Smoke wisp from the barrel.
    if (this.settings.effects === QualityLevel.Ultra) {
      this.particles.spawn({
        x: flash.sprite.position.x,
        y: flash.sprite.position.y,
        z: flash.sprite.position.z,
        vx: direction.x * 1.4,
        vy: direction.y * 1.4 + 0.4,
        vz: direction.z * 1.4,
        life: 0.55,
        size: 0.08,
        sizeEnd: 0.35,
        color: 0x9a958c,
        colorEnd: 0x2c2a27,
        gravity: 0,
        drag: 2.6,
        buoyancy: 0.5,
        fadeIn: 0.2,
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

  update(dt: number, nowMs: number): void {
    this.particles.update(dt);
    this.decals.update(nowMs);
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

    void this.tmpVec;
  }

  clear(): void {
    this.particles.clear();
    this.decals.clear();
    this.tracers.clear();
    for (const flash of this.muzzleFlashes) {
      flash.sprite.visible = false;
      flash.light.visible = false;
      flash.life = 0;
    }
  }

  dispose(): void {
    this.particles.dispose();
    this.decals.dispose();
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

import * as THREE from 'three';
import { radialSprite } from '../renderer/textures';

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  sizeEnd: number;
  color: THREE.ColorRepresentation;
  colorEnd?: THREE.ColorRepresentation;
  /** Gravity multiplier; 0 for smoke that should rise on its own. */
  gravity: number;
  drag: number;
  /** Extra upward acceleration, used for smoke plumes. */
  buoyancy?: number;
  fadeIn?: number;
}

const GRAVITY = -22;

/**
 * One THREE.Points draw call for every particle in the game.
 *
 * Particles live in flat typed arrays and are recycled from a free list, so a
 * firefight allocates nothing. When the pool is exhausted the oldest particle
 * is reused rather than growing the buffer, which keeps the frame time flat
 * under load.
 */
export class ParticlePool {
  readonly points: THREE.Points;

  private readonly capacity: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;

  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly sizeStart: Float32Array;
  private readonly sizeEnd: Float32Array;
  private readonly colorStart: Float32Array;
  private readonly colorEnd: Float32Array;
  private readonly gravityScale: Float32Array;
  private readonly drag: Float32Array;
  private readonly buoyancy: Float32Array;
  private readonly fadeIn: Float32Array;

  private readonly free: number[] = [];
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private cursor = 0;
  private liveCount = 0;
  private softCap: number;

  private readonly tmpColor = new THREE.Color();

  constructor(capacity: number) {
    this.capacity = capacity;
    this.softCap = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.velocities = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.sizeStart = new Float32Array(capacity);
    this.sizeEnd = new Float32Array(capacity);
    this.colorStart = new Float32Array(capacity * 3);
    this.colorEnd = new Float32Array(capacity * 3);
    this.gravityScale = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.buoyancy = new Float32Array(capacity);
    this.fadeIn = new Float32Array(capacity);

    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('particleColor', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('particleSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('particleAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setDrawRange(0, capacity);
    // Particles are scattered all over the map, so a bounding sphere test would
    // never cull anything useful.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        map: { value: radialSprite('rgba(255,255,255,1)', 'rgba(255,255,255,0)') },
        pixelScale: { value: 600 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 particleColor;
        attribute float particleSize;
        attribute float particleAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float pixelScale;
        void main() {
          vColor = particleColor;
          vAlpha = particleAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = particleSize * pixelScale / max(-mvPosition.z, 0.001);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.001) discard;
          vec4 tex = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, tex.a * vAlpha);
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.points.name = 'particles';
  }

  private stealSlot(): number {
    for (let n = 0; n < this.capacity; n++) {
      const i = (this.cursor + n) % this.capacity;
      if (this.life[i]! > 0) {
        this.cursor = (i + 1) % this.capacity;
        this.liveCount -= 1;
        return i;
      }
    }
    const fallback = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    return fallback;
  }

  get active(): number {
    return this.liveCount;
  }

  setPixelScale(height: number): void {
    this.material.uniforms.pixelScale!.value = height * 0.55;
  }

  setSoftCap(maxLive: number): void {
    this.softCap = Math.max(1, Math.min(this.capacity, Math.round(maxLive)));
  }

  spawn(p: ParticleSpawn): void {
    let index: number | undefined;
    if (this.liveCount >= this.softCap) {
      index = this.stealSlot();
    } else {
      index = this.free.pop();
      if (index === undefined) index = this.stealSlot();
    }

    const i3 = index * 3;
    this.positions[i3] = p.x;
    this.positions[i3 + 1] = p.y;
    this.positions[i3 + 2] = p.z;
    this.velocities[i3] = p.vx;
    this.velocities[i3 + 1] = p.vy;
    this.velocities[i3 + 2] = p.vz;

    this.life[index] = p.life;
    this.maxLife[index] = p.life;
    this.sizeStart[index] = p.size;
    this.sizeEnd[index] = p.sizeEnd;
    this.gravityScale[index] = p.gravity;
    this.drag[index] = p.drag;
    this.buoyancy[index] = p.buoyancy ?? 0;
    this.fadeIn[index] = p.fadeIn ?? 0;

    this.tmpColor.set(p.color);
    this.colorStart[i3] = this.tmpColor.r;
    this.colorStart[i3 + 1] = this.tmpColor.g;
    this.colorStart[i3 + 2] = this.tmpColor.b;
    this.colors[i3] = this.tmpColor.r;
    this.colors[i3 + 1] = this.tmpColor.g;
    this.colors[i3 + 2] = this.tmpColor.b;

    this.tmpColor.set(p.colorEnd ?? p.color);
    this.colorEnd[i3] = this.tmpColor.r;
    this.colorEnd[i3 + 1] = this.tmpColor.g;
    this.colorEnd[i3 + 2] = this.tmpColor.b;

    this.sizes[index] = p.size;
    this.alphas[index] = p.fadeIn && p.fadeIn > 0 ? 0 : 1;
    this.liveCount += 1;
  }

  update(dt: number): void {
    if (this.liveCount === 0) return;

    for (let i = 0; i < this.capacity; i++) {
      const remaining = this.life[i]!;
      if (remaining <= 0) continue;

      const next = remaining - dt;
      if (next <= 0) {
        this.life[i] = 0;
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        this.free.push(i);
        this.liveCount -= 1;
        continue;
      }
      this.life[i] = next;

      const i3 = i * 3;
      const dragFactor = Math.max(0, 1 - this.drag[i]! * dt);
      let vx = this.velocities[i3]! * dragFactor;
      let vy = this.velocities[i3 + 1]! * dragFactor;
      let vz = this.velocities[i3 + 2]! * dragFactor;
      vy += GRAVITY * this.gravityScale[i]! * dt;
      vy += this.buoyancy[i]! * dt;
      this.velocities[i3] = vx;
      this.velocities[i3 + 1] = vy;
      this.velocities[i3 + 2] = vz;

      this.positions[i3]! += vx * dt;
      this.positions[i3 + 1]! += vy * dt;
      this.positions[i3 + 2]! += vz * dt;

      const t = 1 - next / this.maxLife[i]!;
      this.sizes[i] = this.sizeStart[i]! + (this.sizeEnd[i]! - this.sizeStart[i]!) * t;

      this.colors[i3] = this.colorStart[i3]! + (this.colorEnd[i3]! - this.colorStart[i3]!) * t;
      this.colors[i3 + 1] =
        this.colorStart[i3 + 1]! + (this.colorEnd[i3 + 1]! - this.colorStart[i3 + 1]!) * t;
      this.colors[i3 + 2] =
        this.colorStart[i3 + 2]! + (this.colorEnd[i3 + 2]! - this.colorStart[i3 + 2]!) * t;

      const fade = this.fadeIn[i]!;
      if (fade > 0 && t < fade) this.alphas[i] = t / fade;
      else this.alphas[i] = Math.min(1, (1 - t) * 2.4);
    }

    this.geometry.attributes.position!.needsUpdate = true;
    this.geometry.attributes.particleColor!.needsUpdate = true;
    this.geometry.attributes.particleSize!.needsUpdate = true;
    this.geometry.attributes.particleAlpha!.needsUpdate = true;
  }

  clear(): void {
    this.free.length = 0;
    for (let i = this.capacity - 1; i >= 0; i--) {
      this.free.push(i);
      this.life[i] = 0;
      this.alphas[i] = 0;
      this.sizes[i] = 0;
    }
    this.liveCount = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}

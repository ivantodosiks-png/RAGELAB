import * as THREE from 'three';
import { mulberry32 } from '@ragelab/shared';

export type ProceduralTextureKind =
  | 'concrete'
  | 'metal'
  | 'wood'
  | 'crate'
  | 'grid'
  | 'sand'
  | 'hazard'
  | 'asphalt'
  | 'grass'
  | 'brick'
  | 'pavement';

const cache = new Map<string, THREE.Texture>();
const pbrCache = new Map<string, ProceduralPbrMaps>();
const SIZE = 512;

export interface ProceduralPbrMaps {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
}

/**
 * Textures are generated on a canvas at startup instead of shipping image
 * assets. Keeps the download tiny, guarantees the game looks right with zero
 * external files, and every texture is deterministic so it can be cached.
 */
export function proceduralTexture(kind: ProceduralTextureKind): THREE.Texture {
  return proceduralPbr(kind).map;
}

export function proceduralPbr(kind: ProceduralTextureKind): ProceduralPbrMaps {
  const cached = pbrCache.get(kind);
  if (cached) return cached;

  const albedo = paintAlbedo(kind);
  const pixels = albedo.getContext('2d')!.getImageData(0, 0, SIZE, SIZE);
  const roughness = imageDataCanvas(roughnessFromAlbedo(pixels, kind));
  const normal = imageDataCanvas(normalFromAlbedo(pixels, kind));

  const maps: ProceduralPbrMaps = {
    map: canvasTexture(albedo, THREE.SRGBColorSpace),
    roughnessMap: canvasTexture(roughness, THREE.NoColorSpace),
    normalMap: canvasTexture(normal, THREE.NoColorSpace),
  };
  pbrCache.set(kind, maps);
  cache.set(kind, maps.map);
  return maps;
}

function paintAlbedo(kind: ProceduralTextureKind): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');

  switch (kind) {
    case 'concrete':
      drawConcrete(ctx);
      break;
    case 'metal':
      drawMetal(ctx);
      break;
    case 'wood':
      drawWood(ctx);
      break;
    case 'crate':
      drawCrate(ctx);
      break;
    case 'grid':
      drawGrid(ctx);
      break;
    case 'sand':
      drawSand(ctx);
      break;
    case 'hazard':
      drawHazard(ctx);
      break;
    case 'asphalt':
      drawAsphalt(ctx);
      break;
    case 'grass':
      drawGrass(ctx);
      break;
    case 'brick':
      drawBrick(ctx);
      break;
    case 'pavement':
      drawPavement(ctx);
      break;
  }
  return canvas;
}

function imageDataCanvas(data: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  return canvas;
}

function canvasTexture(canvas: HTMLCanvasElement, colorSpace: THREE.ColorSpace): THREE.Texture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const ROUGHNESS_BASE: Record<ProceduralTextureKind, number> = {
  concrete: 210,
  metal: 90,
  wood: 200,
  crate: 205,
  grid: 175,
  sand: 235,
  hazard: 140,
  asphalt: 225,
  grass: 242,
  brick: 215,
  pavement: 205,
};

const ROUGHNESS_VARIATION: Record<ProceduralTextureKind, number> = {
  concrete: 36,
  metal: 55,
  wood: 40,
  crate: 32,
  grid: 28,
  sand: 18,
  hazard: 22,
  asphalt: 24,
  grass: 14,
  brick: 30,
  pavement: 26,
};

const NORMAL_STRENGTH: Record<ProceduralTextureKind, number> = {
  concrete: 1.8,
  metal: 0.7,
  wood: 1.6,
  crate: 1.9,
  grid: 1.4,
  sand: 2.2,
  hazard: 0.9,
  asphalt: 1.5,
  grass: 2.6,
  brick: 3.1,
  pavement: 1.7,
};

function roughnessFromAlbedo(src: ImageData, kind: ProceduralTextureKind): ImageData {
  const out = new ImageData(src.width, src.height);
  const base = ROUGHNESS_BASE[kind];
  const amp = ROUGHNESS_VARIATION[kind];
  for (let i = 0; i < src.data.length; i += 4) {
    const lum = (src.data[i]! * 0.3 + src.data[i + 1]! * 0.59 + src.data[i + 2]! * 0.11) / 255;
    const g = clamp255(base + (lum - 0.5) * amp);
    out.data[i] = g;
    out.data[i + 1] = g;
    out.data[i + 2] = g;
    out.data[i + 3] = 255;
  }
  return out;
}

function normalFromAlbedo(src: ImageData, kind: ProceduralTextureKind): ImageData {
  const w = src.width;
  const h = src.height;
  const strength = NORMAL_STRENGTH[kind];
  const heightAt = (x: number, y: number): number => {
    const xx = ((x % w) + w) % w;
    const yy = ((y % h) + h) % h;
    const i = (yy * w + xx) * 4;
    return (src.data[i]! + src.data[i + 1]! + src.data[i + 2]!) / 765;
  };
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * strength;
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      out.data[i] = clamp255((nx * 0.5 + 0.5) * 255);
      out.data[i + 1] = clamp255((ny * 0.5 + 0.5) * 255);
      out.data[i + 2] = clamp255((nz * 0.5 + 0.5) * 255);
      out.data[i + 3] = 255;
    }
  }
  return out;
}

function noiseFill(
  ctx: CanvasRenderingContext2D,
  base: [number, number, number],
  amplitude: number,
  seed: number,
): void {
  const rand = mulberry32(seed);
  const image = ctx.createImageData(SIZE, SIZE);
  const data = image.data;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const n = (rand() - 0.5) * amplitude;
    data[i * 4 + 0] = clamp255(base[0] + n);
    data[i * 4 + 1] = clamp255(base[1] + n);
    data[i * 4 + 2] = clamp255(base[2] + n);
    data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function drawConcrete(ctx: CanvasRenderingContext2D): void {
  noiseFill(ctx, [214, 214, 214], 40, 12345);
  const rand = mulberry32(777);
  // Blotches + hairline cracks.
  for (let i = 0; i < 90; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const r = 4 + rand() * 26;
    const shade = 150 + rand() * 60;
    ctx.fillStyle = `rgba(${shade | 0},${shade | 0},${shade | 0},0.16)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(90,90,90,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    let x = rand() * SIZE;
    let y = rand() * SIZE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (rand() - 0.5) * 34;
      y += (rand() - 0.5) * 34;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawMetal(ctx: CanvasRenderingContext2D): void {
  noiseFill(ctx, [206, 210, 216], 18, 4242);
  // Brushed streaks.
  const rand = mulberry32(99);
  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 340; i++) {
    const y = rand() * SIZE;
    const shade = 130 + rand() * 100;
    ctx.strokeStyle = `rgb(${shade | 0},${shade | 0},${(shade + 6) | 0})`;
    ctx.lineWidth = rand() * 1.8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SIZE, y + (rand() - 0.5) * 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Panel seams and rivets.
  ctx.strokeStyle = 'rgba(70,74,80,0.75)';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, SIZE - 4, SIZE - 4);
  ctx.fillStyle = 'rgba(210,214,220,0.6)';
  for (const [x, y] of [
    [14, 14],
    [SIZE - 14, 14],
    [14, SIZE - 14],
    [SIZE - 14, SIZE - 14],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWood(ctx: CanvasRenderingContext2D): void {
  noiseFill(ctx, [214, 176, 122], 18, 31337);
  const rand = mulberry32(5150);
  for (let i = 0; i < 26; i++) {
    const y = (i / 26) * SIZE + (rand() - 0.5) * 4;
    ctx.strokeStyle = `rgba(${(120 + rand() * 40) | 0},${(88 + rand() * 30) | 0},${(56 + rand() * 20) | 0},0.5)`;
    ctx.lineWidth = 1 + rand() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= SIZE; x += 16) {
      ctx.lineTo(x, y + Math.sin((x / SIZE) * Math.PI * 3 + i) * 3);
    }
    ctx.stroke();
  }
  // Knots.
  for (let i = 0; i < 3; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const grad = ctx.createRadialGradient(x, y, 1, x, y, 16);
    grad.addColorStop(0, 'rgba(88,60,34,0.9)');
    grad.addColorStop(1, 'rgba(88,60,34,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCrate(ctx: CanvasRenderingContext2D): void {
  drawWood(ctx);
  ctx.strokeStyle = 'rgba(74,50,28,0.85)';
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, SIZE - 12, SIZE - 12);
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(6, 6);
  ctx.lineTo(SIZE - 6, SIZE - 6);
  ctx.moveTo(SIZE - 6, 6);
  ctx.lineTo(6, SIZE - 6);
  ctx.stroke();
  // Stencil mark so crates read as crates from a distance.
  ctx.fillStyle = 'rgba(40,28,16,0.55)';
  ctx.font = 'bold 40px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('RL', SIZE / 2, SIZE / 2);
}

function drawGrid(ctx: CanvasRenderingContext2D): void {
  noiseFill(ctx, [186, 190, 196], 14, 606);
  ctx.strokeStyle = 'rgba(58,62,68,0.9)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const p = (i / 4) * SIZE;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, SIZE);
    ctx.moveTo(0, p);
    ctx.lineTo(SIZE, p);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(200,205,212,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 16; i++) {
    const p = (i / 16) * SIZE;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, SIZE);
    ctx.moveTo(0, p);
    ctx.lineTo(SIZE, p);
  }
  ctx.stroke();
}

function drawSand(ctx: CanvasRenderingContext2D): void {
  noiseFill(ctx, [224, 206, 168], 28, 2024);
  const rand = mulberry32(4004);
  for (let i = 0; i < 700; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    ctx.fillStyle = `rgba(${(150 + rand() * 60) | 0},${(130 + rand() * 50) | 0},${(96 + rand() * 40) | 0},0.5)`;
    ctx.fillRect(x, y, 1 + rand() * 2, 1 + rand() * 2);
  }
}

function drawHazard(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#d8d2c4';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#1c1c1c';
  const stripe = 34;
  ctx.save();
  ctx.translate(-SIZE, 0);
  for (let i = 0; i < 24; i++) {
    ctx.beginPath();
    ctx.moveTo(i * stripe * 2, 0);
    ctx.lineTo(i * stripe * 2 + stripe, 0);
    ctx.lineTo(i * stripe * 2 + stripe + SIZE, SIZE);
    ctx.lineTo(i * stripe * 2 + SIZE, SIZE);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Weathering pass so it does not look like flat vector art.
  const rand = mulberry32(8181);
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(rand() * SIZE, rand() * SIZE, rand() * 8, rand() * 8);
  }
  ctx.globalAlpha = 1;
}

function drawAsphalt(ctx: CanvasRenderingContext2D): void {
  noiseFill(ctx, [42, 44, 48], 22, 91001);
  const rand = mulberry32(44);
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(${(62 + rand() * 48) | 0},${(64 + rand() * 48) | 0},${(68 + rand() * 48) | 0},0.3)`;
    ctx.fillRect(rand() * SIZE, rand() * SIZE, 2 + rand() * 12, 1 + rand() * 5);
  }
  // Fine aggregate speckles.
  for (let i = 0; i < 1400; i++) {
    const shade = 28 + rand() * 70;
    ctx.fillStyle = `rgba(${shade | 0},${shade | 0},${(shade + 4) | 0},0.45)`;
    ctx.fillRect(rand() * SIZE, rand() * SIZE, 1, 1);
  }
  // Soft seam lines so large UV repeats do not look like one flat slab.
  ctx.strokeStyle = 'rgba(20,20,22,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(SIZE * 0.5, 0);
  ctx.lineTo(SIZE * 0.5, SIZE);
  ctx.stroke();
}

function drawGrass(ctx: CanvasRenderingContext2D): void {
  noiseFill(ctx, [78, 112, 58], 32, 2202);
  const rand = mulberry32(19);
  for (let i = 0; i < 1400; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    ctx.strokeStyle = `rgba(${(36 + rand() * 55) | 0},${(88 + rand() * 90) | 0},${(28 + rand() * 42) | 0},0.6)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 5, y - 5 - rand() * 8);
    ctx.stroke();
  }
  // Occasional dry patches.
  for (let i = 0; i < 18; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const r = 10 + rand() * 28;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, 'rgba(140,128,72,0.28)');
    g.addColorStop(1, 'rgba(140,128,72,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBrick(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#6a4034';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const rand = mulberry32(71);
  const bw = 42;
  const bh = 20;
  for (let row = 0; row < SIZE / bh + 1; row++) {
    const ox = row % 2 === 0 ? 0 : bw / 2;
    for (let col = -1; col < SIZE / bw + 1; col++) {
      const x = col * bw + ox;
      const y = row * bh;
      const r = 150 + rand() * 40;
      const g = 78 + rand() * 28;
      const b = 58 + rand() * 22;
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
  }
}

function drawPavement(ctx: CanvasRenderingContext2D): void {
  noiseFill(ctx, [168, 164, 156], 20, 6061);
  ctx.strokeStyle = 'rgba(90,88,84,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) {
    const p = (i / 8) * SIZE;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, SIZE);
    ctx.moveTo(0, p);
    ctx.lineTo(SIZE, p);
  }
  ctx.stroke();
}

/** Soft radial sprite used for smoke, muzzle flash and blood particles. */
export function radialSprite(inner: string, outer: string, size = 64): THREE.Texture {
  const key = `sprite:${inner}:${outer}:${size}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, texture);
  return texture;
}

/** Bullet hole decal (dark centre, cracked rim). */
export function bulletHoleTexture(): THREE.Texture {
  const key = 'decal:bullet';
  const cached = cache.get(key);
  if (cached) return cached;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(10,10,10,1)');
  grad.addColorStop(0.35, 'rgba(30,28,26,0.9)');
  grad.addColorStop(0.7, 'rgba(60,56,52,0.35)');
  grad.addColorStop(1, 'rgba(60,56,52,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  const rand = mulberry32(1234);
  ctx.strokeStyle = 'rgba(20,18,16,0.7)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 9; i++) {
    const angle = rand() * Math.PI * 2;
    const len = 8 + rand() * 16;
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2);
    ctx.lineTo(size / 2 + Math.cos(angle) * len, size / 2 + Math.sin(angle) * len);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, texture);
  return texture;
}

export function bloodDecalTexture(): THREE.Texture {
  const key = 'decal:blood';
  const cached = cache.get(key);
  if (cached) return cached;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(31);
  ctx.clearRect(0, 0, size, size);
  // Stylised splat: a few overlapping blobs, deliberately graphic rather than
  // photoreal.
  for (let i = 0; i < 7; i++) {
    const x = size / 2 + (rand() - 0.5) * 22;
    const y = size / 2 + (rand() - 0.5) * 22;
    const r = 6 + rand() * 12;
    const grad = ctx.createRadialGradient(x, y, 1, x, y, r);
    grad.addColorStop(0, 'rgba(150,20,24,0.95)');
    grad.addColorStop(1, 'rgba(110,12,16,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, texture);
  return texture;
}

/** Hot core of a muzzle flash — white-yellow radial bloom. */
export function muzzleCoreTexture(): THREE.Texture {
  const key = 'fx:muzzle-core';
  const cached = cache.get(key);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.1, 'rgba(255,250,210,1)');
  g.addColorStop(0.28, 'rgba(255,190,70,0.95)');
  g.addColorStop(0.55, 'rgba(255,90,16,0.4)');
  g.addColorStop(1, 'rgba(40,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, texture);
  return texture;
}

/** Cross-shaped flash that reads as a real muzzle star. */
export function muzzleStarTexture(): THREE.Texture {
  const key = 'fx:muzzle-star';
  const cached = cache.get(key);
  if (cached) return cached;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 4);
    const g = ctx.createLinearGradient(0, 0, 0, -size / 2);
    g.addColorStop(0, 'rgba(255,255,220,1)');
    g.addColorStop(0.15, 'rgba(255,200,80,0.95)');
    g.addColorStop(0.55, 'rgba(255,90,20,0.35)');
    g.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(0, -size / 2);
    ctx.lineTo(10, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 48);
  halo.addColorStop(0, 'rgba(255,255,230,0.95)');
  halo.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, 48, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, texture);
  return texture;
}

export function disposeTextureCache(): void {
  const seen = new Set<THREE.Texture>();
  const drop = (texture?: THREE.Texture): void => {
    if (!texture || seen.has(texture)) return;
    seen.add(texture);
    texture.dispose();
  };
  for (const texture of cache.values()) drop(texture);
  for (const maps of pbrCache.values()) {
    drop(maps.map);
    drop(maps.roughnessMap);
    drop(maps.normalMap);
  }
  cache.clear();
  pbrCache.clear();
}

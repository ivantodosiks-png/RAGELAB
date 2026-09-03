import * as THREE from 'three';
import { mulberry32 } from '@ragelab/shared';

export type ProceduralTextureKind =
  | 'concrete'
  | 'metal'
  | 'wood'
  | 'crate'
  | 'grid'
  | 'sand'
  | 'hazard';

const cache = new Map<string, THREE.Texture>();
const SIZE = 256;

/**
 * Textures are generated on a canvas at startup instead of shipping image
 * assets. Keeps the download tiny, guarantees the game looks right with zero
 * external files, and every texture is deterministic so it can be cached.
 */
export function proceduralTexture(kind: ProceduralTextureKind): THREE.Texture {
  const cached = cache.get(kind);
  if (cached) return cached;

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
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  cache.set(kind, texture);
  return texture;
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
  noiseFill(ctx, [176, 176, 176], 46, 12345);
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
  noiseFill(ctx, [168, 172, 178], 22, 4242);
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
  noiseFill(ctx, [178, 138, 92], 20, 31337);
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
  noiseFill(ctx, [150, 154, 160], 16, 606);
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
  noiseFill(ctx, [196, 176, 140], 34, 2024);
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

export function disposeTextureCache(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}

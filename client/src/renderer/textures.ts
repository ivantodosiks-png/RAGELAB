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
const SIZE = 1024;

export interface ProceduralPbrMaps {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
  aoMap: THREE.Texture;
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
  const ao = imageDataCanvas(aoFromAlbedo(pixels));

  const maps: ProceduralPbrMaps = {
    map: canvasTexture(albedo, THREE.SRGBColorSpace),
    roughnessMap: canvasTexture(roughness, THREE.NoColorSpace),
    normalMap: canvasTexture(normal, THREE.NoColorSpace),
    aoMap: canvasTexture(ao, THREE.NoColorSpace),
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
  texture.anisotropy = 16;
  texture.magFilter = THREE.LinearFilter;
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
  concrete: 2.8,
  metal: 0.7,
  wood: 1.8,
  crate: 1.9,
  grid: 1.4,
  sand: 2.4,
  hazard: 0.9,
  asphalt: 2.6,
  grass: 3.8,
  brick: 4.2,
  pavement: 2.9,
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

/** Cavity-style AO from local albedo contrast (darker recesses, brighter flats). */
function aoFromAlbedo(src: ImageData): ImageData {
  const w = src.width;
  const h = src.height;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < src.data.length; i += 4, p++) {
    lum[p] = (src.data[i]! * 0.3 + src.data[i + 1]! * 0.59 + src.data[i + 2]! * 0.11) / 255;
  }
  const sample = (x: number, y: number): number => {
    const xx = ((x % w) + w) % w;
    const yy = ((y % h) + h) % h;
    return lum[yy * w + xx]!;
  };
  const out = new ImageData(w, h);
  const radius = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const center = sample(x, y);
      let sum = 0;
      let count = 0;
      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          if (ox === 0 && oy === 0) continue;
          sum += sample(x + ox, y + oy);
          count++;
        }
      }
      const avg = sum / count;
      // Recesses (darker than neighborhood) get more occlusion.
      const cavity = Math.max(0, avg - center);
      const ao = clamp255((1 - cavity * 2.4) * 220 + 35);
      const i = (y * w + x) * 4;
      out.data[i] = ao;
      out.data[i + 1] = ao;
      out.data[i + 2] = ao;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Deterministic value noise in [0, 1]. */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const hash = (ix: number, iy: number): number => {
    const n = Math.imul(((ix * 374761393) ^ (iy * 668265263) ^ seed) >>> 0, 0x27d4eb2d);
    return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
  };
  const u = fade(xf);
  const v = fade(yf);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
}

/** Fractal Brownian motion — layered value noise. */
function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * freq, y * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return value / norm;
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

/** FBM-based base fill for richer large-scale color variation. */
function fbmFill(
  ctx: CanvasRenderingContext2D,
  base: [number, number, number],
  amplitude: number,
  seed: number,
  scale = 0.012,
  octaves = 5,
): void {
  const image = ctx.createImageData(SIZE, SIZE);
  const data = image.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = (fbm(x * scale, y * scale, seed, octaves) - 0.5) * amplitude;
      const i = (y * SIZE + x) * 4;
      data[i] = clamp255(base[0] + n);
      data[i + 1] = clamp255(base[1] + n);
      data[i + 2] = clamp255(base[2] + n);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function drawConcrete(ctx: CanvasRenderingContext2D): void {
  fbmFill(ctx, [196, 198, 200], 38, 12345, 0.008, 5);
  const image = ctx.getImageData(0, 0, SIZE, SIZE);
  const data = image.data;
  // Fine aggregate + pore noise layered on FBM.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const grain = (valueNoise(x * 0.35, y * 0.35, 901) - 0.5) * 28;
      const pore = fbm(x * 0.06, y * 0.06, 333, 3);
      const i = (y * SIZE + x) * 4;
      const darken = pore < 0.32 ? (0.32 - pore) * 55 : 0;
      data[i] = clamp255(data[i]! + grain - darken);
      data[i + 1] = clamp255(data[i + 1]! + grain - darken);
      data[i + 2] = clamp255(data[i + 2]! + grain - darken * 0.9);
    }
  }
  ctx.putImageData(image, 0, 0);

  const rand = mulberry32(777);
  for (let i = 0; i < 140; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const r = 6 + rand() * 36;
    const shade = 140 + rand() * 70;
    ctx.fillStyle = `rgba(${shade | 0},${shade | 0},${shade | 0},0.14)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Hairline cracks with slight branching.
  ctx.strokeStyle = 'rgba(70,72,74,0.4)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 18; i++) {
    let x = rand() * SIZE;
    let y = rand() * SIZE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 12; s++) {
      x += (rand() - 0.5) * 42;
      y += (rand() - 0.5) * 42;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Soft formwork lines.
  ctx.strokeStyle = 'rgba(120,122,124,0.18)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const p = ((i + 0.5) / 4) * SIZE;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p + (rand() - 0.5) * 8, SIZE);
    ctx.stroke();
  }
}

function drawMetal(ctx: CanvasRenderingContext2D): void {
  fbmFill(ctx, [198, 202, 208], 16, 4242, 0.02, 3);
  const rand = mulberry32(99);
  // Brushed streaks with slight vertical wobble.
  ctx.globalAlpha = 0.28;
  for (let i = 0; i < 520; i++) {
    const y = rand() * SIZE;
    const shade = 120 + rand() * 110;
    ctx.strokeStyle = `rgb(${shade | 0},${shade | 0},${(shade + 8) | 0})`;
    ctx.lineWidth = 0.6 + rand() * 1.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= SIZE; x += 48) {
      ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 1.5 + (rand() - 0.5) * 2);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Oxidation freckles.
  for (let i = 0; i < 80; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const r = 2 + rand() * 10;
    ctx.fillStyle = `rgba(${(90 + rand() * 40) | 0},${(70 + rand() * 30) | 0},${(50 + rand() * 20) | 0},0.18)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Panel seams and rivets.
  ctx.strokeStyle = 'rgba(55,58,64,0.8)';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(3, 3, SIZE - 6, SIZE - 6);
  ctx.beginPath();
  ctx.moveTo(SIZE / 2, 4);
  ctx.lineTo(SIZE / 2, SIZE - 4);
  ctx.moveTo(4, SIZE / 2);
  ctx.lineTo(SIZE - 4, SIZE / 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(210,214,220,0.65)';
  const rivets = [
    [14, 14],
    [SIZE - 14, 14],
    [14, SIZE - 14],
    [SIZE - 14, SIZE - 14],
    [SIZE / 2, 14],
    [SIZE / 2, SIZE - 14],
    [14, SIZE / 2],
    [SIZE - 14, SIZE / 2],
  ];
  for (const [x, y] of rivets) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,42,48,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawWood(ctx: CanvasRenderingContext2D): void {
  fbmFill(ctx, [186, 142, 92], 22, 31337, 0.015, 4);
  const image = ctx.getImageData(0, 0, SIZE, SIZE);
  const data = image.data;
  // Grain rings via warped sine along Y.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const warp = fbm(x * 0.004, y * 0.01, 88, 3) * 40;
      const grain = Math.sin((y + warp) * 0.085) * 18 + Math.sin((y + warp) * 0.22) * 8;
      const pore = valueNoise(x * 0.4, y * 0.08, 55) * 14;
      const i = (y * SIZE + x) * 4;
      data[i] = clamp255(data[i]! + grain - pore * 0.4);
      data[i + 1] = clamp255(data[i + 1]! + grain * 0.75 - pore * 0.3);
      data[i + 2] = clamp255(data[i + 2]! + grain * 0.45 - pore * 0.2);
    }
  }
  ctx.putImageData(image, 0, 0);

  const rand = mulberry32(5150);
  for (let i = 0; i < 32; i++) {
    const y = (i / 32) * SIZE + (rand() - 0.5) * 6;
    ctx.strokeStyle = `rgba(${(100 + rand() * 50) | 0},${(70 + rand() * 35) | 0},${(40 + rand() * 25) | 0},0.45)`;
    ctx.lineWidth = 1 + rand() * 2.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= SIZE; x += 12) {
      ctx.lineTo(x, y + Math.sin((x / SIZE) * Math.PI * 4 + i) * 4 + (rand() - 0.5));
    }
    ctx.stroke();
  }
  // Knots with concentric rings.
  for (let i = 0; i < 5; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const r = 10 + rand() * 18;
    for (let ring = 0; ring < 4; ring++) {
      const rr = r * (1 - ring * 0.2);
      ctx.strokeStyle = `rgba(${(70 + ring * 12) | 0},${(48 + ring * 8) | 0},${(28 + ring * 4) | 0},${0.55 - ring * 0.1})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y, rr * 1.3, rr * 0.7, rand() * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    const grad = ctx.createRadialGradient(x, y, 1, x, y, r);
    grad.addColorStop(0, 'rgba(70,46,26,0.85)');
    grad.addColorStop(1, 'rgba(70,46,26,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
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
  fbmFill(ctx, [214, 192, 148], 32, 2024, 0.01, 5);
  const image = ctx.getImageData(0, 0, SIZE, SIZE);
  const data = image.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const ripple = Math.sin(x * 0.04 + fbm(x * 0.01, y * 0.01, 7, 2) * 6) * 10;
      const grain = (valueNoise(x * 0.5, y * 0.5, 4004) - 0.5) * 30;
      const dune = (fbm(x * 0.006, y * 0.012, 11, 3) - 0.5) * 22;
      const i = (y * SIZE + x) * 4;
      data[i] = clamp255(data[i]! + ripple + grain + dune);
      data[i + 1] = clamp255(data[i + 1]! + ripple * 0.85 + grain + dune * 0.9);
      data[i + 2] = clamp255(data[i + 2]! + ripple * 0.55 + grain * 0.7 + dune * 0.6);
    }
  }
  ctx.putImageData(image, 0, 0);
  const rand = mulberry32(4004);
  for (let i = 0; i < 1200; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    ctx.fillStyle = `rgba(${(140 + rand() * 70) | 0},${(120 + rand() * 55) | 0},${(80 + rand() * 45) | 0},0.45)`;
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
  fbmFill(ctx, [38, 40, 44], 28, 91001, 0.009, 5);
  const image = ctx.getImageData(0, 0, SIZE, SIZE);
  const data = image.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const agg = valueNoise(x * 0.45, y * 0.45, 44);
      const patch = fbm(x * 0.02, y * 0.02, 910, 3);
      const i = (y * SIZE + x) * 4;
      // Light aggregate flecks.
      const fleck = agg > 0.72 ? (agg - 0.72) * 120 : agg < 0.18 ? -(0.18 - agg) * 40 : 0;
      const wear = (patch - 0.5) * 18;
      data[i] = clamp255(data[i]! + fleck + wear);
      data[i + 1] = clamp255(data[i + 1]! + fleck + wear);
      data[i + 2] = clamp255(data[i + 2]! + fleck * 0.95 + wear + 2);
    }
  }
  ctx.putImageData(image, 0, 0);

  const rand = mulberry32(44);
  // Oil stains / dark patches.
  for (let i = 0; i < 28; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const r = 18 + rand() * 55;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, 'rgba(12,12,14,0.35)');
    g.addColorStop(1, 'rgba(12,12,14,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Tar seams / repair strips.
  ctx.strokeStyle = 'rgba(18,18,20,0.45)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    let x = rand() * SIZE;
    let y = rand() * SIZE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (rand() - 0.4) * 80;
      y += (rand() - 0.5) * 50;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Soft slab seam so large UV repeats do not look like one flat slab.
  ctx.strokeStyle = 'rgba(22,22,24,0.4)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(SIZE * 0.5, 0);
  ctx.lineTo(SIZE * 0.5 + (rand() - 0.5) * 4, SIZE);
  ctx.stroke();
  // Fine light gravel speckles.
  for (let i = 0; i < 2200; i++) {
    const shade = 50 + rand() * 90;
    ctx.fillStyle = `rgba(${shade | 0},${shade | 0},${(shade + 6) | 0},0.4)`;
    ctx.fillRect(rand() * SIZE, rand() * SIZE, 1, 1);
  }
}

function drawGrass(ctx: CanvasRenderingContext2D): void {
  fbmFill(ctx, [62, 98, 46], 40, 2202, 0.011, 5);
  const image = ctx.getImageData(0, 0, SIZE, SIZE);
  const data = image.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const clump = fbm(x * 0.03, y * 0.03, 19, 4);
      const blade = valueNoise(x * 0.2, y * 0.55, 77);
      const i = (y * SIZE + x) * 4;
      const greenShift = (clump - 0.5) * 35;
      const tip = blade > 0.65 ? 18 : blade < 0.25 ? -12 : 0;
      data[i] = clamp255(data[i]! + greenShift * 0.3 + tip * 0.4);
      data[i + 1] = clamp255(data[i + 1]! + greenShift + tip);
      data[i + 2] = clamp255(data[i + 2]! + greenShift * 0.25);
    }
  }
  ctx.putImageData(image, 0, 0);

  const rand = mulberry32(19);
  // Dense blade strokes in overlapping layers.
  for (let i = 0; i < 3200; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const lean = (rand() - 0.5) * 7;
    const h = 4 + rand() * 12;
    ctx.strokeStyle = `rgba(${(28 + rand() * 50) | 0},${(70 + rand() * 110) | 0},${(22 + rand() * 40) | 0},${0.35 + rand() * 0.4})`;
    ctx.lineWidth = 0.8 + rand() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + lean * 0.5, y - h * 0.5, x + lean, y - h);
    ctx.stroke();
  }
  // Dry / bare earth patches.
  for (let i = 0; i < 28; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const r = 12 + rand() * 40;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, 'rgba(130,118,62,0.32)');
    g.addColorStop(1, 'rgba(130,118,62,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Tiny flower / weed flecks.
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle =
      rand() > 0.5 ? `rgba(200,190,70,${0.35 + rand() * 0.3})` : `rgba(160,70,90,${0.25 + rand() * 0.3})`;
    ctx.fillRect(rand() * SIZE, rand() * SIZE, 1 + rand() * 2, 1 + rand() * 2);
  }
}

function drawBrick(ctx: CanvasRenderingContext2D): void {
  // Mortar base.
  fbmFill(ctx, [150, 144, 132], 18, 7001, 0.04, 3);
  const rand = mulberry32(71);
  const bw = 96;
  const bh = 40;
  const mortar = 5;

  for (let row = 0; row < SIZE / bh + 2; row++) {
    const ox = row % 2 === 0 ? 0 : bw / 2;
    for (let col = -1; col < SIZE / bw + 2; col++) {
      const x = col * bw + ox;
      const y = row * bh;
      const baseR = 138 + rand() * 55;
      const baseG = 62 + rand() * 38;
      const baseB = 48 + rand() * 28;
      // Per-brick body with slight color noise.
      const brick = ctx.createImageData(bw - mortar, bh - mortar);
      for (let by = 0; by < bh - mortar; by++) {
        for (let bx = 0; bx < bw - mortar; bx++) {
          const n = (valueNoise((x + bx) * 0.08, (y + by) * 0.08, 71 + row) - 0.5) * 28;
          const edge =
            Math.min(bx, by, bw - mortar - 1 - bx, bh - mortar - 1 - by) < 2 ? -18 : 0;
          const i = (by * (bw - mortar) + bx) * 4;
          brick.data[i] = clamp255(baseR + n + edge);
          brick.data[i + 1] = clamp255(baseG + n * 0.7 + edge);
          brick.data[i + 2] = clamp255(baseB + n * 0.5 + edge);
          brick.data[i + 3] = 255;
        }
      }
      ctx.putImageData(brick, x + mortar / 2, y + mortar / 2);

      // Soft bevel highlight on top edge.
      ctx.fillStyle = 'rgba(255,220,200,0.12)';
      ctx.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, 2);
      // Bottom shadow into mortar.
      ctx.fillStyle = 'rgba(40,20,16,0.22)';
      ctx.fillRect(x + mortar / 2, y + bh - mortar / 2 - 2, bw - mortar, 2);

      // Occasional chip / spall.
      if (rand() > 0.88) {
        const cx = x + mortar + rand() * (bw - mortar * 2);
        const cy = y + mortar + rand() * (bh - mortar * 2);
        ctx.fillStyle = `rgba(${(baseR - 30) | 0},${(baseG - 20) | 0},${(baseB - 15) | 0},0.7)`;
        ctx.beginPath();
        ctx.arc(cx, cy, 2 + rand() * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // Weathering wash over the whole wall.
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 60; i++) {
    const shade = rand() > 0.5 ? 20 : 200;
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fillRect(rand() * SIZE, rand() * SIZE, 20 + rand() * 80, 8 + rand() * 30);
  }
  ctx.globalAlpha = 1;
}

function drawPavement(ctx: CanvasRenderingContext2D): void {
  fbmFill(ctx, [162, 158, 150], 22, 6061, 0.01, 4);
  const tiles = 8;
  const gap = 4;
  const cell = SIZE / tiles;
  const rand = mulberry32(6061);

  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const x = tx * cell;
      const y = ty * cell;
      const tint = (rand() - 0.5) * 18;
      // Per-slab shade variation.
      ctx.fillStyle = `rgba(${(155 + tint) | 0},${(151 + tint) | 0},${(143 + tint) | 0},0.35)`;
      ctx.fillRect(x + gap / 2, y + gap / 2, cell - gap, cell - gap);

      // Micro roughness inside slab via noise overlay.
      const slab = ctx.getImageData(x + gap / 2, y + gap / 2, cell - gap, cell - gap);
      for (let py = 0; py < slab.height; py++) {
        for (let px = 0; px < slab.width; px++) {
          const n = (valueNoise((x + px) * 0.12, (y + py) * 0.12, 99) - 0.5) * 20;
          const i = (py * slab.width + px) * 4;
          slab.data[i] = clamp255(slab.data[i]! + n);
          slab.data[i + 1] = clamp255(slab.data[i + 1]! + n);
          slab.data[i + 2] = clamp255(slab.data[i + 2]! + n);
        }
      }
      ctx.putImageData(slab, x + gap / 2, y + gap / 2);

      // Bevel.
      ctx.strokeStyle = 'rgba(210,206,198,0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + gap / 2 + 1, y + gap / 2 + 1, cell - gap - 2, cell - gap - 2);
    }
  }

  // Grout / joint lines (darker, slightly uneven).
  ctx.strokeStyle = 'rgba(70,68,64,0.65)';
  ctx.lineWidth = gap;
  ctx.beginPath();
  for (let i = 0; i <= tiles; i++) {
    const p = i * cell;
    ctx.moveTo(p + (rand() - 0.5) * 1.5, 0);
    ctx.lineTo(p + (rand() - 0.5) * 1.5, SIZE);
    ctx.moveTo(0, p + (rand() - 0.5) * 1.5);
    ctx.lineTo(SIZE, p + (rand() - 0.5) * 1.5);
  }
  ctx.stroke();

  // Wear / dirt in joints and corners.
  for (let i = 0; i < 80; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    ctx.fillStyle = `rgba(90,86,78,${0.08 + rand() * 0.15})`;
    ctx.beginPath();
    ctx.arc(x, y, 4 + rand() * 14, 0, Math.PI * 2);
    ctx.fill();
  }
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
    drop(maps.aoMap);
  }
  cache.clear();
  pbrCache.clear();
}

import * as THREE from 'three';
import { SANDBOX_WEAPON_KINDS, createWeaponVisual, type SandboxWeaponKind } from '../weapons/weaponAssets';
import type { ToolGunToolId } from './spawnCatalog';

const SIZE = 128;
const weaponCache = new Map<string, string>();
const toolCache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
let failed = false;

function getRenderer(): THREE.WebGLRenderer | null {
  if (failed) return null;
  if (renderer) return renderer;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    renderer.setSize(SIZE, SIZE, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    return renderer;
  } catch {
    failed = true;
    return null;
  }
}

function labelFallback(label: string, fill: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#141a16';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = fill;
  ctx.font = '700 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.slice(0, 5).toUpperCase(), SIZE / 2, SIZE / 2);
  return canvas.toDataURL('image/png');
}

function renderWeapon(kind: SandboxWeaponKind): string {
  const gl = getRenderer();
  if (!gl) return labelFallback(kind, '#d6ff3d');

  const visual = createWeaponVisual(kind, weaponPhysicsLength(kind), { lod: false, shadows: false });
  if (!visual) return labelFallback(kind, '#d6ff3d');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141a16);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.04, 24);
  scene.add(visual);

  const box = new THREE.Box3().setFromObject(visual);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  visual.position.sub(center);
  const span = Math.max(size.x, size.y, size.z, 0.16);
  const dist = span * 2.05;
  camera.position.set(dist * 0.62, dist * 0.42, dist * 0.95);
  camera.lookAt(0, span * 0.04, 0);

  scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x2a2418, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(2.4, 3.6, 2.2);
  const fill = new THREE.DirectionalLight(0x9ad0ff, 0.4);
  fill.position.set(-2.8, 1.1, -1.2);
  scene.add(key, fill);

  gl.render(scene, camera);
  const url = gl.domElement.toDataURL('image/png');
  scene.clear();
  return url;
}

function weaponPhysicsLength(kind: SandboxWeaponKind): number {
  switch (kind) {
    case 'sniper':
      return 1.05;
    case 'rifle':
      return 0.82;
    case 'shotgun':
      return 0.78;
    case 'smg':
      return 0.52;
    case 'melee':
      return 0.92;
    case 'magnum':
      return 0.28;
    default:
      return 0.22;
  }
}

const TOOL_SVG: Record<ToolGunToolId, string> = {
  delete: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#1a100e"/><path d="M20 20l24 24M44 20L20 44" stroke="#ff5a45" stroke-width="5" stroke-linecap="round"/><path d="M18 50h28" stroke="#ff5a45" stroke-width="3" stroke-linecap="round" opacity=".45"/></svg>`,
  select: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#141a10"/><path d="M18 14l8 34 8-12 14-6z" fill="#d6ff3d" stroke="#0c100d" stroke-width="2" stroke-linejoin="round"/><circle cx="46" cy="46" r="7" fill="none" stroke="#d6ff3d" stroke-width="3"/></svg>`,
  ragdoll: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#12180e"/><circle cx="32" cy="16" r="6" fill="#b8e04a"/><path d="M22 28h20M32 28v14M22 54l10-12 10 12M18 36l10-6M46 36l-10-6" stroke="#b8e04a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  grab: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#101812"/><path d="M24 34V20a4 4 0 018 0v10M32 30V18a4 4 0 018 0v14M40 32V22a4 4 0 018 0v16c0 8-6 14-14 14h-4c-8 0-14-5-14-12v-8a4 4 0 018 0v4" fill="none" stroke="#6fe88a" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

function svgUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function weaponIconUrl(kind: SandboxWeaponKind): string {
  const hit = weaponCache.get(kind);
  if (hit) return hit;
  const url = renderWeapon(kind);
  weaponCache.set(kind, url);
  return url;
}

export function toolIconUrl(tool: ToolGunToolId): string {
  const hit = toolCache.get(tool);
  if (hit) return hit;
  const url = svgUrl(TOOL_SVG[tool]);
  toolCache.set(tool, url);
  return url;
}

export function warmupSpawnIcons(): void {
  for (const kind of SANDBOX_WEAPON_KINDS) weaponIconUrl(kind);
  for (const tool of ['delete', 'select', 'ragdoll', 'grab'] as ToolGunToolId[]) toolIconUrl(tool);
}

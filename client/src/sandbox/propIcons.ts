import * as THREE from 'three';
import { PROP_KINDS, type PropKind } from '@ragelab/shared';
import { createPropVisual } from './propVisuals';

const SIZE = 128;
const cache = new Map<PropKind, string>();
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
    renderer.toneMappingExposure = 1.05;
    return renderer;
  } catch {
    failed = true;
    return null;
  }
}

function swatchFallback(kind: PropKind): string {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#141a16';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#d6ff3d';
  ctx.font = '700 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(kind.slice(0, 4).toUpperCase(), SIZE / 2, SIZE / 2);
  return canvas.toDataURL('image/png');
}

function renderKind(kind: PropKind): string {
  const gl = getRenderer();
  if (!gl) return swatchFallback(kind);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141a16);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 20);
  const visual = createPropVisual(kind);
  scene.add(visual);

  const box = new THREE.Box3().setFromObject(visual);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  visual.position.sub(center);
  const span = Math.max(size.x, size.y, size.z, 0.2);
  const dist = span * 2.15;
  camera.position.set(dist * 0.72, dist * 0.55, dist * 0.86);
  camera.lookAt(0, span * 0.02, 0);

  const hemi = new THREE.HemisphereLight(0xe8f0ff, 0x2a2418, 1.15);
  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(2.2, 4, 2.6);
  const fill = new THREE.DirectionalLight(0x9ad0ff, 0.35);
  fill.position.set(-3, 1.2, -1.4);
  scene.add(hemi, key, fill);

  gl.render(scene, camera);
  const url = gl.domElement.toDataURL('image/png');
  scene.clear();
  return url;
}

/** Renders a 128px preview of the live prop mesh. Cached per kind. */
export function propIconUrl(kind: PropKind): string {
  const hit = cache.get(kind);
  if (hit) return hit;
  const url = renderKind(kind);
  cache.set(kind, url);
  return url;
}

/** Warm the atlas when the spawn menu first opens. Cheap after the first call. */
export function warmupPropIcons(): void {
  for (const kind of PROP_KINDS) propIconUrl(kind);
}

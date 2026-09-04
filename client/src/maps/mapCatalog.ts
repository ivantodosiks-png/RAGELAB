const BASE = import.meta.env.BASE_URL;

/**
 * Kenney City Kit + Aim Pit props. Each GLB has its pack colormap embedded
 * (no external Textures/colormap.png), so Vite/Vercel production serves one
 * self-contained file per model.
 */
export const CITY_SCALE = 10;

export const CITY_MODELS: Record<string, { file: string; scale?: number; dir?: string }> = {
  'building-a': { file: 'building-a.glb' },
  'building-b': { file: 'building-b.glb' },
  'building-d': { file: 'building-d.glb' },
  'building-g': { file: 'building-g.glb' },
  'building-h': { file: 'building-h.glb' },
  'building-j': { file: 'building-j.glb' },
  'building-l': { file: 'building-l.glb' },
  'building-n': { file: 'building-n.glb' },
  'skyscraper-a': { file: 'skyscraper-a.glb' },
  'skyscraper-c': { file: 'skyscraper-c.glb' },
  'house-c': { file: 'house-c.glb' },
  'house-f': { file: 'house-f.glb' },
  'house-k': { file: 'house-k.glb' },
  'house-p': { file: 'house-p.glb' },
  'tree-large': { file: 'tree-large.glb', scale: 14 },
  'tree-small': { file: 'tree-small.glb', scale: 12 },
  fence: { file: 'fence.glb' },
  'fence-low': { file: 'fence-low.glb' },
  planter: { file: 'planter.glb' },
  driveway: { file: 'driveway.glb' },
  'path-stones': { file: 'path-stones.glb' },
  'path-long': { file: 'path-long.glb' },
  parasol: { file: 'parasol.glb' },
  'road-straight': { file: 'road-straight.glb' },
  'road-half': { file: 'road-half.glb' },
  'road-cross': { file: 'road-cross.glb' },
  'road-t': { file: 'road-t.glb' },
  'road-side': { file: 'road-side.glb' },
  'road-end': { file: 'road-end.glb' },
  'road-bend': { file: 'road-bend.glb' },
  'road-drive': { file: 'road-drive.glb' },
  'road-split': { file: 'road-split.glb' },
  'road-square': { file: 'road-square.glb' },
  lamp: { file: 'lamp.glb' },
  'lamp-curve': { file: 'lamp-curve.glb' },
  'light-square': { file: 'light-square.glb' },
  'construction-light': { file: 'construction-light.glb' },
  sign: { file: 'sign.glb' },
  'sign-highway': { file: 'sign-highway.glb' },
  'sign-highway-wide': { file: 'sign-highway-wide.glb' },
  cone: { file: 'cone.glb' },
  barrier: { file: 'barrier.glb' },
  // Kenney Blaster Kit (CC0) — Aim Pit dressing
  'crate-medium': { file: 'crate-medium.glb', dir: 'aimpit', scale: 1 },
  'crate-wide': { file: 'crate-wide.glb', dir: 'aimpit', scale: 1 },
  'crate-small': { file: 'crate-small.glb', dir: 'aimpit', scale: 1 },
  'target-large': { file: 'target-large.glb', dir: 'aimpit', scale: 1.35 },
  'target-small': { file: 'target-small.glb', dir: 'aimpit', scale: 1.1 },
  'target-detail': { file: 'target-detail.glb', dir: 'aimpit', scale: 1.2 },
  'grenade-prop': { file: 'grenade-a.glb', dir: 'aimpit', scale: 1 },
  // Full-map GLB (FPS playground arena) — replaces Test Box
  arena: { file: 'arena.glb', dir: 'maps', scale: 1 },
  // Desert Arena low-poly environment
  desert: { file: 'desert.glb', dir: 'maps', scale: 1 },
};

export function cityModelUrl(id: string): string {
  const def = CITY_MODELS[id];
  if (!def) throw new Error(`Unknown city model: ${id}`);
  const folder = def.dir ?? 'city';
  return `${BASE}models/${folder}/${def.file}`;
}

export function cityModelScale(id: string): number {
  return CITY_MODELS[id]?.scale ?? CITY_SCALE;
}

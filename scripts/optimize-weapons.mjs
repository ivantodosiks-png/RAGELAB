/**
 * Bake Flat Guns West (and melee) GLBs for the browser:
 * strip unused skins, merge materials, weld, optional simplify, meshopt.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  flatten,
  join,
  palette,
  prune,
  quantize,
  reorder,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});

const jobs = [
  {
    src: 'tmp-assets/flat_guns_west/Flat Guns West/GLB/Pistol_Compact_West.glb',
    dest: 'client/public/models/weapons/pistol.glb',
  },
  {
    src: 'tmp-assets/flat_guns_west/Flat Guns West/GLB/Rifle_Battle_West.glb',
    dest: 'client/public/models/weapons/rifle.glb',
  },
  {
    src: 'tmp-assets/flat_guns_west/Flat Guns West/GLB/Shotgun_Pump_West.glb',
    dest: 'client/public/models/weapons/shotgun.glb',
  },
  {
    src: 'tmp-assets/flat_guns_west/Flat Guns West/GLB/SMG_Full_West.glb',
    dest: 'client/public/models/weapons/smg.glb',
  },
  {
    src: 'tmp-assets/flat_guns_west/Flat Guns West/GLB/Sniper_Rifle_West.glb',
    dest: 'client/public/models/weapons/sniper.glb',
  },
];

import { existsSync } from 'node:fs';
const meleeCandidates = [
  'tmp-assets/fantasysword/fantasysword.glb',
  'tmp-assets/fantasysword/FantasySword.glb',
  'tmp-assets/fantasysword/sword.glb',
];
function findMelee() {
  const files = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of (await import('node:fs')).readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.toLowerCase().endsWith('.glb')) files.push(p);
    }
  }
  walk('tmp-assets/fantasysword');
  return files[0];
}
const melee = findMelee();
if (melee) jobs.push({ src: melee, dest: 'client/public/models/weapons/melee.glb' });

function stripSkins(document) {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      prim.setAttribute('JOINTS_0', null);
      prim.setAttribute('WEIGHTS_0', null);
    }
  }
  for (const node of document.getRoot().listNodes()) {
    node.setSkin(null);
  }
  for (const skin of document.getRoot().listSkins()) skin.dispose();
}

function stats(document) {
  let tris = 0;
  let verts = 0;
  let prims = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      prims += 1;
      const pos = prim.getAttribute('POSITION');
      verts += pos?.getCount() ?? 0;
      const idx = prim.getIndices();
      tris += idx ? idx.getCount() / 3 : (pos?.getCount() ?? 0) / 3;
    }
  }
  return {
    tris: Math.round(tris),
    verts,
    prims,
    materials: document.getRoot().listMaterials().length,
  };
}

const report = [];

for (const job of jobs) {
  const document = await io.read(job.src);
  const before = stats(document);
  stripSkins(document);
  await document.transform(
    flatten(),
    palette({ min: 2 }),
    join({ keepNamed: false }),
    weld(),
    dedup(),
    prune(),
    quantize(),
  );
  await mkdir(path.dirname(job.dest), { recursive: true });
  await io.write(job.dest, document);
  const after = stats(document);
  const bytes = (await import('node:fs')).statSync(job.dest).size;
  report.push({ file: path.basename(job.dest), before, after, bytes });
  console.log(path.basename(job.dest), before, '->', after, `${bytes} bytes`);
}

await writeFile('tmp-assets/weapon-opt-report.json', JSON.stringify(report, null, 2));

/**
 * Bake CC0 weapon GLBs for the browser: strip skins, merge, weld, quantize,
 * optional simplify, and emit LOD0/LOD1/LOD2 nodes in one file.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  flatten,
  join,
  prune,
  quantize,
  simplify,
  weld,
  cloneDocument,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(HERE) === 'opt' ? path.resolve(HERE, '../..') : path.resolve(HERE, '..');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});

const jobs = [
  {
    // Large-frame West pistol (Desert Eagle silhouette). Barrel is authored
    // along -Z after bind pose is stripped; runtime fitWeaponModel enforces it.
    src: 'tmp-assets/flat_guns_west/Flat Guns West/GLB/Pistol_Full_West.glb',
    dest: 'client/public/models/weapons/pistol.glb',
    length: 0.26,
  },
  {
    src: 'tmp-assets/flat_guns_west/Flat Guns West/GLB/Rifle_Battle_West.glb',
    dest: 'client/public/models/weapons/rifle.glb',
    length: 0.82,
  },
  {
    src: 'tmp-assets/flat_guns_west/Flat Guns West/GLB/Shotgun_Pump_West.glb',
    dest: 'client/public/models/weapons/shotgun.glb',
    length: 0.78,
  },
  {
    src: 'tmp-assets/flat_guns_west/Flat Guns West/GLB/SMG_Full_West.glb',
    dest: 'client/public/models/weapons/smg.glb',
    length: 0.52,
  },
  {
    src: 'tmp-assets/flat_guns_west/Flat Guns West/GLB/Sniper_Rifle_West.glb',
    dest: 'client/public/models/weapons/sniper.glb',
    length: 1.05,
  },
  {
    src: 'tmp-assets/melee/katana.glb',
    dest: 'client/public/models/weapons/melee.glb',
    length: 0.92,
  },
];

function stripSkins(document) {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      prim.setAttribute('JOINTS_0', null);
      prim.setAttribute('WEIGHTS_0', null);
    }
  }
  for (const node of document.getRoot().listNodes()) node.setSkin(null);
  for (const skin of document.getRoot().listSkins()) skin.dispose();
}

function dropTextures(document) {
  for (const mat of document.getRoot().listMaterials()) {
    mat.setBaseColorTexture(null);
    mat.setMetallicRoughnessTexture(null);
    mat.setNormalTexture(null);
    mat.setOcclusionTexture(null);
    mat.setEmissiveTexture(null);
  }
  for (const tex of document.getRoot().listTextures()) tex.dispose();
}

function renameMagazine(document) {
  for (const node of document.getRoot().listNodes()) {
    if (/magazine/i.test(node.getName())) node.setName('magazine');
  }
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

function cloneLodSource(document) {
  return cloneDocument(document);
}

async function optimizeBase(src) {
  const document = await io.read(path.join(ROOT, src));
  const before = stats(document);
  stripSkins(document);
  dropTextures(document);
  renameMagazine(document);
  await document.transform(flatten(), join({ keepNamed: true }), weld(), dedup(), prune());
  const afterJoin = stats(document);
  if (afterJoin.tris > 2800) {
    await document.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio: 2800 / afterJoin.tris, error: 0.02 }),
      prune(),
    );
  }
  await document.transform(quantize());
  return { document, before, after: stats(document) };
}

async function lodCopy(baseDoc, ratio) {
  const document = cloneLodSource(baseDoc);
  const current = stats(document);
  if (ratio < 0.99 && current.tris > 200) {
    await document.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.05 }),
      prune(),
    );
  }
  return document;
}

const report = [];

for (const job of jobs) {
  const absSrc = path.join(ROOT, job.src);
  const { document, before, after } = await optimizeBase(job.src);
  const lod1 = await lodCopy(document, 0.45);
  const lod2 = await lodCopy(document, 0.18);

  const dest = path.join(ROOT, job.dest);
  await mkdir(path.dirname(dest), { recursive: true });
  await io.write(dest, document);
  await io.write(dest.replace(/\.glb$/, '.lod1.glb'), lod1);
  await io.write(dest.replace(/\.glb$/, '.lod2.glb'), lod2);
  const bytes = (await stat(dest)).size;
  const row = {
    file: path.basename(job.dest),
    src: path.basename(absSrc),
    before,
    after,
    lod1: stats(lod1),
    lod2: stats(lod2),
    bytes,
  };
  report.push(row);
  console.log(
    row.file,
    `${before.tris}t/${before.mats}m -> ${after.tris}t/${after.mats}m`,
    `lod1 ${row.lod1.tris}t lod2 ${row.lod2.tris}t`,
    `${bytes} B`,
  );
}

await writeFile(path.join(ROOT, 'tmp-assets/weapon-opt-report.json'), JSON.stringify(report, null, 2));
void ROOT;

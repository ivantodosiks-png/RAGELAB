import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const SRC_GLTF = path.resolve('tools/hlbsp/2000.gltf');
const OUT = path.resolve('client/public/models/maps/fy2000.glb');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC_GLTF);

const dropMat = /clip|aaatrigger|sky|hint|skip|origin/i;
let removedPrim = 0;
for (const mesh of [...doc.getRoot().listMeshes()]) {
  for (const prim of [...mesh.listPrimitives()]) {
    const mat = prim.getMaterial();
    const name = `${mat?.getName() || ''} ${mat?.getBaseColorTexture()?.getName() || ''}`;
    if (dropMat.test(name)) {
      mesh.removePrimitive(prim);
      removedPrim++;
    }
  }
}

/** Collect world-space boxes. */
function boxes() {
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    let verts = 0;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const arr = pos.getArray();
      verts += arr.length / 3;
      for (let i = 0; i < arr.length; i += 3) {
        min[0] = Math.min(min[0], arr[i]);
        min[1] = Math.min(min[1], arr[i + 1]);
        min[2] = Math.min(min[2], arr[i + 2]);
        max[0] = Math.max(max[0], arr[i]);
        max[1] = Math.max(max[1], arr[i + 1]);
        max[2] = Math.max(max[2], arr[i + 2]);
      }
    }
    const m = node.getWorldMatrix();
    let wmin = [Infinity, Infinity, Infinity];
    let wmax = [-Infinity, -Infinity, -Infinity];
    for (const x of [min[0], max[0]]) {
      for (const y of [min[1], max[1]]) {
        for (const z of [min[2], max[2]]) {
          const o = [0, 0, 0];
          for (let r = 0; r < 3; r++) o[r] = m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r];
          for (let i = 0; i < 3; i++) {
            wmin[i] = Math.min(wmin[i], o[i]);
            wmax[i] = Math.max(wmax[i], o[i]);
          }
        }
      }
    }
    out.push({
      node,
      mesh,
      name: node.getName() || mesh.getName() || '?',
      wmin,
      wmax,
      size: [wmax[0] - wmin[0], wmax[1] - wmin[1], wmax[2] - wmin[2]],
      center: [(wmin[0] + wmax[0]) / 2, (wmin[1] + wmax[1]) / 2, (wmin[2] + wmax[2]) / 2],
      verts,
    });
  }
  return out;
}

const all = boxes();
all.sort((a, b) => b.verts - a.verts);
console.log(
  'TOP',
  all.slice(0, 12).map((b) => ({
    n: b.name,
    ymin: +b.wmin[1].toFixed(2),
    ymax: +b.wmax[1].toFixed(2),
    s: b.size.map((n) => +n.toFixed(2)),
    c: b.center.map((n) => +n.toFixed(2)),
  })),
);

// Thin high slabs = broken ceiling / light planes from BSP.
const roofNodes = new Set();
for (const b of all) {
  const thin = b.size[1] < 0.45;
  const high = b.wmin[1] > 2.0;
  const flatArea = b.size[0] * b.size[2];
  if ((thin && high && flatArea > 5) || (high && thin && b.verts < 200 && flatArea > 2)) {
    roofNodes.add(b.node);
    console.log('DROP ROOF', b.name, {
      y: +b.wmin[1].toFixed(2),
      s: b.size.map((n) => +n.toFixed(2)),
    });
  }
}

for (const node of roofNodes) {
  node.setMesh(null);
}

// Brighten materials — GoldSrc lightmaps aren't applied in Three.js, so ceilings go black.
for (const mat of doc.getRoot().listMaterials()) {
  const c = mat.getBaseColorFactor();
  // Lift dark albedo so stone/ceiling stays readable without lightmaps.
  const lift = 1.55;
  mat.setBaseColorFactor([
    Math.min(1, c[0] * lift + 0.08),
    Math.min(1, c[1] * lift + 0.08),
    Math.min(1, c[2] * lift + 0.08),
    c[3],
  ]);
  mat.setEmissiveFactor([0.04, 0.04, 0.035]);
  mat.setMetallicFactor(0);
  mat.setRoughnessFactor(Math.max(0.7, mat.getRoughnessFactor() || 0.8));
}

await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }));

// Re-measure floor after cleanup for alignment report.
const after = boxes();
let gmin = [Infinity, Infinity, Infinity];
let gmax = [-Infinity, -Infinity, -Infinity];
for (const b of after) {
  for (let i = 0; i < 3; i++) {
    gmin[i] = Math.min(gmin[i], b.wmin[i]);
    gmax[i] = Math.max(gmax[i], b.wmax[i]);
  }
}
console.log('removedPrim', removedPrim, 'droppedRoofNodes', roofNodes.size);
console.log('BOUNDS', {
  gmin: gmin.map((n) => +n.toFixed(3)),
  gmax: gmax.map((n) => +n.toFixed(3)),
  size: [gmax[0] - gmin[0], gmax[1] - gmin[1], gmax[2] - gmin[2]].map((n) => +n.toFixed(3)),
});

await io.write(OUT, doc);
fs.copyFileSync(OUT, OUT.replace('.glb', '.lod1.glb'));
fs.copyFileSync(OUT, OUT.replace('.glb', '.lod2.glb'));
console.log('wrote', OUT, `${(fs.statSync(OUT).size / 1e6).toFixed(2)}MB`);

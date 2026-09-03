import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { statSync } from 'node:fs';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});

const src = 'client/public/models/npc/character.glb';
const dest = 'client/public/models/npc/humanoid.glb';
const document = await io.read(src);

const names = document.getRoot().listAnimations().map((a) => a.getName());
console.log('animations', names.length, names.slice(0, 30));

const keepRe = /idle|walk|run|locomotion/i;
for (const anim of document.getRoot().listAnimations()) {
  if (!keepRe.test(anim.getName())) anim.dispose();
}
console.log(
  'kept',
  document.getRoot().listAnimations().map((a) => a.getName()),
);

await document.transform(weld(), dedup(), prune(), quantize());
await io.write(dest, document);
console.log('bytes', statSync(dest).size);

let tris = 0;
for (const mesh of document.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    tris += idx ? idx.getCount() / 3 : 0;
  }
}
console.log('tris', Math.round(tris), 'meshes', document.getRoot().listMeshes().length);
console.log(
  'bones',
  document.getRoot().listNodes().map((n) => n.getName()).filter((n) => /hip|spine|head|arm|leg|foot|hand|neck/i.test(n)),
);

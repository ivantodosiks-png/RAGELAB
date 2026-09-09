/**
 * Bake assets/m4/M4Colt.glb → client/public/models/weapons/rifle.glb
 * (resize PBR maps + webp so the 120MB source is browser-friendly)
 */
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, resample } from '@gltf-transform/functions';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets/m4/M4Colt.glb');
const OUT = path.join(ROOT, 'client/public/models/weapons/rifle.glb');
const OUT1 = path.join(ROOT, 'client/public/models/weapons/rifle.lod1.glb');
const OUT2 = path.join(ROOT, 'client/public/models/weapons/rifle.lod2.glb');

await mkdir(path.dirname(OUT), { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
console.log('reading', SRC);
const document = await io.read(SRC);

await document.transform(
  dedup(),
  prune(),
  resample(),
  textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    resize: [1536, 1536],
  }),
);

// Keep sensible node names for runtime hooks.
for (const node of document.getRoot().listNodes()) {
  const name = (node.getName() || '').toLowerCase();
  if (name.includes('m4') || name.includes('colt')) node.setName('rifle');
}

await io.write(OUT, document);
await copyFile(OUT, OUT1);
await copyFile(OUT, OUT2);

const { statSync } = await import('node:fs');
console.log('wrote', OUT, 'bytes', statSync(OUT).size);
console.log(
  'textures',
  document
    .getRoot()
    .listTextures()
    .map((t) => [t.getName(), t.getMimeType(), t.getImage()?.byteLength]),
);
console.log(
  'anims',
  document
    .getRoot()
    .listAnimations()
    .map((a) => a.getName()),
);

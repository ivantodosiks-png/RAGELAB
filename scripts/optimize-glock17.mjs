/**
 * Compress Glock 17 GLB textures for web (resize + webp, prune).
 */
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress } from '@gltf-transform/functions';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'client/public/models/weapons/glock.glb');
const OUT = SRC;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(SRC);

await document.transform(
  dedup(),
  prune(),
  textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    resize: [1024, 1024],
  }),
);

await io.write(OUT, document);
await copyFile(OUT, path.join(ROOT, 'client/public/models/weapons/glock.lod1.glb'));
await copyFile(OUT, path.join(ROOT, 'client/public/models/weapons/glock.lod2.glb'));

const before = (await readFile(SRC)).byteLength; // already overwritten — report after
console.log('optimized glock.glb bytes', before);

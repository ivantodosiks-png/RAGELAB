/**
 * Convert a triangle OBJ into a texture-free GLB via gltf-transform.
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(HERE) === 'opt' ? path.resolve(HERE, '../..') : path.resolve(HERE, '..');
const objPath = path.join(ROOT, 'tmp-assets/flat_melee/FlatShadedMelee/OBJ/Katana.obj');
const dest = path.join(ROOT, 'tmp-assets/melee/katana.glb');

const text = await readFile(objPath, 'utf8');
const positions = [];
const indices = [];
for (const raw of text.split(/\n/)) {
  const line = raw.trim();
  if (line.startsWith('v ')) {
    const [, x, y, z] = line.split(/\s+/);
    positions.push(Number(x), Number(y), Number(z));
  } else if (line.startsWith('f ')) {
    const verts = line
      .slice(2)
      .trim()
      .split(/\s+/)
      .map((tok) => Number.parseInt(tok.split('/')[0], 10) - 1);
    for (let i = 1; i < verts.length - 1; i++) {
      indices.push(verts[0], verts[i], verts[i + 1]);
    }
  }
}

const document = new Document();
const buffer = document.createBuffer();
const posAcc = document
  .createAccessor()
  .setType('VEC3')
  .setArray(new Float32Array(positions))
  .setBuffer(buffer);
const idxAcc = document
  .createAccessor()
  .setType('SCALAR')
  .setArray(new Uint32Array(indices))
  .setBuffer(buffer);
const material = document
  .createMaterial('katana')
  .setBaseColorFactor([0.72, 0.74, 0.78, 1])
  .setMetallicFactor(0.78)
  .setRoughnessFactor(0.32);
const prim = document.createPrimitive().setAttribute('POSITION', posAcc).setIndices(idxAcc).setMaterial(material);
const mesh = document.createMesh('katana').addPrimitive(prim);
const node = document.createNode('katana').setMesh(mesh);
const scene = document.createScene('katana').addChild(node);
document.getRoot().setDefaultScene(scene);

await mkdir(path.dirname(dest), { recursive: true });
const io = new NodeIO();
await io.write(dest, document);
console.log('wrote', dest, 'verts', positions.length / 3, 'tris', indices.length / 3);

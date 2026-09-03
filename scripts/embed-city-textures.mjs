/**
 * Kenney City Kit GLBs ship with `images[].uri = "Textures/colormap.png"`.
 * The PNG was never copied next to the files in client/public, so Three.js
 * loaded untextured white MeshStandardMaterials — the "white map".
 *
 * Each kit (roads / commercial / suburban) has a different colormap, so a
 * single shared PNG cannot be dropped in city/Textures/. This script embeds
 * the matching PNG into each GLB so production / Vercel serve one self-contained
 * file per model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CITY = path.join(ROOT, 'client/public/models/city');

const COLORMAPS = {
  roads: path.join(ROOT, 'tmp-assets/city/roads/Models/GLB format/Textures/colormap.png'),
  commercial: path.join(ROOT, 'tmp-assets/city/commercial/Models/GLB format/Textures/colormap.png'),
  suburban: path.join(ROOT, 'tmp-assets/city/suburban/Models/GLB format/Textures/colormap.png'),
};

const PACK = {
  roads: [
    'road-straight',
    'road-half',
    'road-cross',
    'road-t',
    'road-side',
    'road-end',
    'road-bend',
    'road-drive',
    'road-split',
    'road-square',
    'lamp',
    'lamp-curve',
    'light-square',
    'construction-light',
    'sign',
    'sign-highway',
    'sign-highway-wide',
    'cone',
    'barrier',
  ],
  commercial: [
    'building-a',
    'building-b',
    'building-d',
    'building-g',
    'building-h',
    'building-j',
    'building-l',
    'building-n',
    'skyscraper-a',
    'skyscraper-c',
  ],
  suburban: [
    'house-c',
    'house-f',
    'house-k',
    'house-p',
    'tree-large',
    'tree-small',
    'fence',
    'fence-low',
    'planter',
    'driveway',
    'path-stones',
    'path-long',
    'parasol',
  ],
};

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const GLB_MAGIC = 0x46546c67;

function pad4(n) {
  return (n + 3) & ~3;
}

function readGlb(buf) {
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  if (jsonType !== JSON_CHUNK) throw new Error('missing JSON chunk');
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let bin = Buffer.alloc(0);
  const binOff = 20 + jsonLen;
  if (binOff + 8 <= buf.length) {
    const binLen = buf.readUInt32LE(binOff);
    const binType = buf.readUInt32LE(binOff + 4);
    if (binType === BIN_CHUNK) {
      bin = Buffer.from(buf.subarray(binOff + 8, binOff + 8 + binLen));
    }
  }
  return { json, bin };
}

function writeGlb(json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json));
  const jsonPad = pad4(jsonBuf.length);
  const jsonChunk = Buffer.alloc(jsonPad, 0x20);
  jsonBuf.copy(jsonChunk);

  const binPad = pad4(bin.length);
  const binChunk = Buffer.alloc(binPad, 0);
  bin.copy(binChunk);

  const total = 12 + 8 + jsonPad + 8 + binPad;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPad, 12);
  out.writeUInt32LE(JSON_CHUNK, 16);
  jsonChunk.copy(out, 20);
  const binStart = 20 + jsonPad;
  out.writeUInt32LE(binPad, binStart);
  out.writeUInt32LE(BIN_CHUNK, binStart + 4);
  binChunk.copy(out, binStart + 8);
  return out;
}

function embedPng(json, bin, png) {
  const external = (json.images ?? []).filter((img) => typeof img.uri === 'string');
  if (external.length === 0) return { json, bin, changed: false };

  json.buffers = json.buffers ?? [{ byteLength: bin.length }];
  json.bufferViews = json.bufferViews ?? [];

  const aligned = pad4(bin.length);
  const viewIndex = json.bufferViews.length;
  json.bufferViews.push({
    buffer: 0,
    byteOffset: aligned,
    byteLength: png.length,
  });

  const next = Buffer.alloc(aligned + png.length);
  bin.copy(next);
  png.copy(next, aligned);
  json.buffers[0].byteLength = next.length;

  for (const img of json.images) {
    if (typeof img.uri !== 'string') continue;
    delete img.uri;
    img.mimeType = 'image/png';
    img.bufferView = viewIndex;
  }

  return { json, bin: next, changed: true };
}

const packOf = new Map();
for (const [pack, names] of Object.entries(PACK)) {
  for (const name of names) packOf.set(name, pack);
}

const pngs = {};
for (const [pack, file] of Object.entries(COLORMAPS)) {
  if (!fs.existsSync(file)) throw new Error(`Missing colormap for ${pack}: ${file}`);
  pngs[pack] = fs.readFileSync(file);
}

const files = fs.readdirSync(CITY).filter((f) => f.endsWith('.glb'));
let embedded = 0;
let skipped = 0;
for (const file of files) {
  const id = file.replace(/\.glb$/i, '');
  const pack = packOf.get(id);
  if (!pack) throw new Error(`No pack mapping for ${file}`);
  const src = fs.readFileSync(path.join(CITY, file));
  const parsed = readGlb(src);
  const result = embedPng(parsed.json, parsed.bin, pngs[pack]);
  if (!result.changed) {
    skipped += 1;
    continue;
  }
  fs.writeFileSync(path.join(CITY, file), writeGlb(result.json, result.bin));
  embedded += 1;
  console.log(`embedded ${pack.padEnd(12)} ${file}`);
}

console.log(`done: ${embedded} embedded, ${skipped} already self-contained, ${files.length} total`);

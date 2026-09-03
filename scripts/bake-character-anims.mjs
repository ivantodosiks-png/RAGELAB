/**
 * Bake locomotion clips onto civilian character meshes.
 *
 * man.glb  — Ready Player Me example avatar (three.js) + RPM animation library clips
 * woman.glb — Mixamo Michelle + Idle/Walk/Run from Mixamo Soldier (mesh discarded)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '../tmp-assets/opt/node_modules/@gltf-transform/core/dist/index.modern.js';
import { ALL_EXTENSIONS } from '../tmp-assets/opt/node_modules/@gltf-transform/extensions/dist/index.modern.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'tmp-assets/humans/rpm');
const OUT = path.join(ROOT, 'client/public/models/characters');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function nodesByName(doc) {
  const map = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (name && !map.has(name)) map.set(name, node);
  }
  return map;
}

function copyAccessor(targetDoc, src, buffer) {
  const array = src.getArray();
  if (!array) throw new Error(`accessor ${src.getName()} has no array`);
  return targetDoc
    .createAccessor(src.getName())
    .setType(src.getType())
    .setNormalized(src.getNormalized())
    .setArray(new array.constructor(array))
    .setBuffer(buffer);
}

function bakeClips(avatarDoc, animDoc, rename, skipNames = new Set(['RootNode'])) {
  const lookup = nodesByName(avatarDoc);
  const buffer = avatarDoc.getRoot().listBuffers()[0];
  if (!buffer) throw new Error('avatar has no buffer');
  let copied = 0;
  let missing = 0;
  for (const srcAnim of animDoc.getRoot().listAnimations()) {
    const clipName = rename[srcAnim.getName()];
    if (!clipName) continue;
    const dstAnim = avatarDoc.createAnimation(clipName);
    for (const srcCh of srcAnim.listChannels()) {
      const srcNode = srcCh.getTargetNode();
      const bone = srcNode?.getName() ?? '';
      if (!bone || skipNames.has(bone)) continue;
      const dstNode = lookup.get(bone);
      if (!dstNode) {
        missing += 1;
        continue;
      }
      const srcSampler = srcCh.getSampler();
      if (!srcSampler?.getInput() || !srcSampler.getOutput()) continue;
      const sampler = avatarDoc
        .createAnimationSampler()
        .setInterpolation(srcSampler.getInterpolation())
        .setInput(copyAccessor(avatarDoc, srcSampler.getInput(), buffer))
        .setOutput(copyAccessor(avatarDoc, srcSampler.getOutput(), buffer));
      const channel = avatarDoc
        .createAnimationChannel()
        .setTargetPath(srcCh.getTargetPath())
        .setTargetNode(dstNode)
        .setSampler(sampler);
      dstAnim.addSampler(sampler).addChannel(channel);
      copied += 1;
    }
    if (dstAnim.listChannels().length === 0) {
      dstAnim.dispose();
    }
  }
  return { copied, missing };
}

async function bake(avatarPath, animSpecs, outName) {
  const avatar = await io.read(avatarPath);
  // Drop any clips that shipped with the mesh (samba / t-pose).
  for (const anim of avatar.getRoot().listAnimations()) anim.dispose();
  for (const spec of animSpecs) {
    const animDoc = await io.read(spec.file);
    const stats = bakeClips(avatar, animDoc, spec.rename);
    console.log(`  ${path.basename(spec.file)} → ${JSON.stringify(spec.rename)} channels=${stats.copied} missing=${stats.missing}`);
  }
  const clips = avatar.getRoot().listAnimations().map((a) => a.getName());
  const outPath = path.join(OUT, outName);
  await io.write(outPath, avatar);
  const size = fs.statSync(outPath).size;
  console.log(`wrote ${outName}  clips=[${clips.join(', ')}]  ${(size / 1024).toFixed(0)} KB`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('man.glb');
  await bake(
    path.join(SRC, 'avatars/threejs-rpm.glb'),
    [
      { file: path.join(SRC, 'anims/M_Standing_Idle_001.glb'), rename: { M_Standing_Idle_001: 'idle' } },
      { file: path.join(SRC, 'anims/M_Walk_001.glb'), rename: { M_Walk_001: 'walk' } },
      { file: path.join(SRC, 'anims/M_Walk_002.glb'), rename: { M_Walk_002: 'walking_b' } },
      { file: path.join(SRC, 'anims/M_Run_001.glb'), rename: { M_Run_001: 'run' } },
      { file: path.join(SRC, 'anims/M_Walk_Jump_001.glb'), rename: { M_Walk_Jump_001: 'jump' } },
      { file: path.join(SRC, 'anims/M_Falling_Idle_002.glb'), rename: { M_Falling_Idle_002: 'fall' } },
    ],
    'man.glb',
  );
  console.log('woman.glb');
  await bake(
    path.join(SRC, 'avatars/Michelle.glb'),
    [{ file: path.join(SRC, 'avatars/Soldier.glb'), rename: { Idle: 'idle', Walk: 'walk', Run: 'run' } }],
    'woman.glb',
  );
}

await main();

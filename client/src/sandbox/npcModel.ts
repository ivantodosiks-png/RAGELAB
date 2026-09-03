import * as THREE from 'three';
import type { NpcPartId } from './types';

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xd1a184, 0xe8beac];
const HAIR = [0x1a120b, 0x3b2a1a, 0x5c3d2e, 0xc9a227, 0x2a2a2a, 0x6b3f2a];
const SHIRT = [0x3d5a80, 0xc44536, 0x2d6a4f, 0x4a4e69, 0x774936, 0x1b4965, 0x40916c];
const PANTS = [0x1d3557, 0x2b2d42, 0x22223b, 0x3c3a32, 0x1b1b1e];
const SHOES = [0x1a1a1a, 0x3d2914, 0x2c2c34];

export interface NpcLook {
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  shoes: number;
}

export function randomNpcLook(rng: () => number): NpcLook {
  const pick = (list: number[]): number => list[Math.floor(rng() * list.length)]!;
  return {
    skin: pick(SKIN),
    hair: pick(HAIR),
    shirt: pick(SHIRT),
    pants: pick(PANTS),
    shoes: pick(SHOES),
  };
}

export interface NpcVisualPart {
  group: THREE.Group;
  mesh: THREE.Object3D;
}

/**
 * Shared geometries for every sandbox NPC. Materials are cloned per instance
 * so shirt/skin colours can vary without extra GPU programs.
 */
export class SharedNpcAssets {
  readonly head = new THREE.SphereGeometry(0.11, 14, 12);
  readonly hair = new THREE.SphereGeometry(0.115, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  readonly eye = new THREE.SphereGeometry(0.016, 8, 6);
  readonly torso = new THREE.CapsuleGeometry(0.14, 0.32, 5, 10);
  readonly pelvis = new THREE.BoxGeometry(0.3, 0.2, 0.2);
  readonly upperArm = new THREE.CapsuleGeometry(0.045, 0.22, 4, 8);
  readonly lowerArm = new THREE.CapsuleGeometry(0.038, 0.2, 4, 8);
  readonly hand = new THREE.BoxGeometry(0.08, 0.06, 0.11);
  readonly upperLeg = new THREE.CapsuleGeometry(0.07, 0.32, 4, 8);
  readonly lowerLeg = new THREE.CapsuleGeometry(0.055, 0.3, 4, 8);
  readonly foot = new THREE.BoxGeometry(0.1, 0.07, 0.22);
  readonly nose = new THREE.BoxGeometry(0.03, 0.028, 0.04);
  readonly brow = new THREE.BoxGeometry(0.04, 0.008, 0.012);
  readonly collar = new THREE.BoxGeometry(0.22, 0.05, 0.16);
  readonly belt = new THREE.BoxGeometry(0.32, 0.04, 0.22);

  readonly skin = makeMat(0xe8beac, 0.72, 0.05);
  readonly hairMat = makeMat(0x1a120b, 0.85, 0.02);
  readonly shirt = makeMat(0x3d5a80, 0.78, 0.04);
  readonly pants = makeMat(0x1d3557, 0.8, 0.03);
  readonly shoes = makeMat(0x1a1a1a, 0.55, 0.15);
  readonly eyeWhite = makeMat(0xf4f4f4, 0.4, 0.05);
  readonly eyeDark = makeMat(0x1a120c, 0.35, 0.1);

  dispose(): void {
    this.head.dispose();
    this.hair.dispose();
    this.eye.dispose();
    this.torso.dispose();
    this.pelvis.dispose();
    this.upperArm.dispose();
    this.lowerArm.dispose();
    this.hand.dispose();
    this.upperLeg.dispose();
    this.lowerLeg.dispose();
    this.foot.dispose();
    this.nose.dispose();
    this.brow.dispose();
    this.collar.dispose();
    this.belt.dispose();
    this.skin.dispose();
    this.hairMat.dispose();
    this.shirt.dispose();
    this.pants.dispose();
    this.shoes.dispose();
    this.eyeWhite.dispose();
    this.eyeDark.dispose();
  }
}

function makeMat(color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function cloneMat(src: THREE.MeshStandardMaterial, color: number): THREE.MeshStandardMaterial {
  const mat = src.clone();
  mat.color.setHex(color);
  return mat;
}

export interface BuiltNpcVisual {
  root: THREE.Group;
  parts: Record<NpcPartId, NpcVisualPart>;
  materials: THREE.MeshStandardMaterial[];
}

/** Hierarchical-looking humanoid; each part is a direct child so ragdoll can drive world pose. */
export function buildNpcVisual(assets: SharedNpcAssets, look: NpcLook): BuiltNpcVisual {
  const root = new THREE.Group();
  root.name = 'sandboxNpc';
  const materials: THREE.MeshStandardMaterial[] = [];
  const skin = cloneMat(assets.skin, look.skin);
  const hair = cloneMat(assets.hairMat, look.hair);
  const shirt = cloneMat(assets.shirt, look.shirt);
  const pants = cloneMat(assets.pants, look.pants);
  const shoes = cloneMat(assets.shoes, look.shoes);
  materials.push(skin, hair, shirt, pants, shoes);

  const parts = {} as Record<NpcPartId, NpcVisualPart>;

  const add = (
    id: NpcPartId,
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    meshOffset: [number, number, number] = [0, 0, 0],
    extra?: THREE.Object3D,
  ): void => {
    const group = new THREE.Group();
    group.name = id;
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(...meshOffset);
    mesh.frustumCulled = true;
    group.add(mesh);
    if (extra) group.add(extra);
    root.add(group);
    parts[id] = { group, mesh };
  };

  const headExtras = new THREE.Group();
  const hairMesh = new THREE.Mesh(assets.hair, hair);
  hairMesh.position.set(0, 0.04, -0.01);
  hairMesh.castShadow = true;
  const eyeL = new THREE.Mesh(assets.eye, assets.eyeWhite);
  const eyeR = new THREE.Mesh(assets.eye, assets.eyeWhite);
  const pupilL = new THREE.Mesh(assets.eye, assets.eyeDark);
  const pupilR = new THREE.Mesh(assets.eye, assets.eyeDark);
  eyeL.position.set(-0.035, 0.015, -0.09);
  eyeR.position.set(0.035, 0.015, -0.09);
  pupilL.scale.setScalar(0.55);
  pupilR.scale.setScalar(0.55);
  pupilL.position.set(-0.035, 0.015, -0.102);
  pupilR.position.set(0.035, 0.015, -0.102);
  const nose = new THREE.Mesh(assets.nose, skin);
  nose.position.set(0, -0.01, -0.11);
  const browL = new THREE.Mesh(assets.brow, hair);
  const browR = new THREE.Mesh(assets.brow, hair);
  browL.position.set(-0.035, 0.038, -0.09);
  browR.position.set(0.035, 0.038, -0.09);
  headExtras.add(hairMesh, eyeL, eyeR, pupilL, pupilR, nose, browL, browR);

  const collar = new THREE.Mesh(assets.collar, shirt);
  collar.position.set(0, 0.2, 0);
  collar.castShadow = true;
  const belt = new THREE.Mesh(assets.belt, shoes);
  belt.position.set(0, 0.08, 0);
  belt.castShadow = true;

  add('head', assets.head, skin, [0, 0, 0], headExtras);
  add('torso', assets.torso, shirt, [0, 0, 0], collar);
  add('pelvis', assets.pelvis, pants, [0, 0, 0], belt);
  add('upperArmL', assets.upperArm, shirt);
  add('lowerArmL', assets.lowerArm, skin);
  add('handL', assets.hand, skin);
  add('upperArmR', assets.upperArm, shirt);
  add('lowerArmR', assets.lowerArm, skin);
  add('handR', assets.hand, skin);
  add('upperLegL', assets.upperLeg, pants);
  add('lowerLegL', assets.lowerLeg, skin);
  add('footL', assets.foot, shoes);
  add('upperLegR', assets.upperLeg, pants);
  add('lowerLegR', assets.lowerLeg, skin);
  add('footR', assets.foot, shoes);

  return { root, parts, materials };
}

/** Rest-pose local translation of each part relative to the feet, standing, facing -Z. */
export const REST_LOCAL: Record<NpcPartId, [number, number, number]> = {
  pelvis: [0, 0.98, 0],
  torso: [0, 1.28, 0],
  head: [0, 1.58, 0],
  upperArmL: [-0.22, 1.4, 0],
  lowerArmL: [-0.22, 1.12, 0],
  handL: [-0.22, 0.88, 0],
  upperArmR: [0.22, 1.4, 0],
  lowerArmR: [0.22, 1.12, 0],
  handR: [0.22, 0.88, 0],
  upperLegL: [-0.09, 0.72, 0],
  lowerLegL: [-0.09, 0.36, 0],
  footL: [-0.09, 0.05, 0.04],
  upperLegR: [0.09, 0.72, 0],
  lowerLegR: [0.09, 0.36, 0],
  footR: [0.09, 0.05, 0.04],
};

export interface LimbPose {
  upperLegL: number;
  upperLegR: number;
  lowerLegL: number;
  lowerLegR: number;
  upperArmL: number;
  upperArmR: number;
  lowerArmL: number;
  lowerArmR: number;
  torso: number;
}

export function idlePose(): LimbPose {
  return {
    upperLegL: 0,
    upperLegR: 0,
    lowerLegL: 0.08,
    lowerLegR: 0.08,
    upperArmL: 0.12,
    upperArmR: 0.12,
    lowerArmL: 0.15,
    lowerArmR: 0.15,
    torso: 0,
  };
}

export function walkPose(phase: number, stride: number): LimbPose {
  const a = Math.sin(phase) * stride;
  const b = Math.sin(phase + Math.PI) * stride;
  return {
    upperLegL: a * 0.7,
    upperLegR: b * 0.7,
    lowerLegL: 0.12 + Math.max(0, -a) * 0.7,
    lowerLegR: 0.12 + Math.max(0, -b) * 0.7,
    upperArmL: b * 0.55,
    upperArmR: a * 0.55,
    lowerArmL: 0.2 + Math.max(0, b) * 0.25,
    lowerArmR: 0.2 + Math.max(0, a) * 0.25,
    torso: a * 0.04,
  };
}

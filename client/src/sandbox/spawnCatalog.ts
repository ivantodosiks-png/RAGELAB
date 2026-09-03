import { PROP_KINDS, isWeaponId, getWeapon, type PropKind } from '@ragelab/shared';
import { SANDBOX_WEAPON_KINDS, type SandboxWeaponKind } from '../weapons/weaponAssets';
import type { SandboxTool } from './types';

export type SpawnCategory = 'npc' | 'props' | 'fun' | 'physics' | 'interactive' | 'tools' | 'weapons';

/** NPC spawn UI is unfinished — hide the tab and reject Tool Gun NPC spawns. */
export const NPC_MENU_ENABLED = false;

export type ToolGunToolId = Extract<SandboxTool, 'delete' | 'select' | 'ragdoll' | 'grab'>;

export const PROP_SPAWN_CATEGORIES: SpawnCategory[] = ['props', 'fun', 'physics', 'interactive'];

export function isPropCategory(category: SpawnCategory): boolean {
  return category === 'props' || category === 'fun' || category === 'physics' || category === 'interactive';
}

export interface SpawnEntry {
  id: string;
  category: SpawnCategory;
  name: string;
  info: string;
  spawnable: boolean;
  swatch: number;
  glyph: string;
}

export const NPC_ENTRIES: SpawnEntry[] = [
  {
    id: 'npc:humanoid',
    category: 'npc',
    name: 'Person',
    info: 'Human NPC with walk/run and ragdoll',
    spawnable: NPC_MENU_ENABLED,
    swatch: 0x3d5a80,
    glyph: 'NPC',
  },
  {
    id: 'npc:ragdoll',
    category: 'npc',
    name: 'Ragdoll Dummy',
    info: 'Spawns already limp',
    spawnable: NPC_MENU_ENABLED,
    swatch: 0xc44536,
    glyph: 'RAG',
  },
  {
    id: 'npc:crowd',
    category: 'npc',
    name: 'Civilian',
    info: 'Same humanoid, random look',
    spawnable: NPC_MENU_ENABLED,
    swatch: 0x2d6a4f,
    glyph: 'CIV',
  },
];

interface PropMeta {
  name: string;
  info: string;
  glyph: string;
  swatch: number;
  category: Extract<SpawnCategory, 'props' | 'fun' | 'physics' | 'interactive'>;
}

const PROP_META: Record<PropKind, PropMeta> = {
  crate: { name: 'Crate', info: 'Wooden box · 24 kg', glyph: 'BOX', swatch: 0xa9793f, category: 'props' },
  barrel: { name: 'Barrel', info: 'Metal drum · 38 kg', glyph: 'DRUM', swatch: 0x37515f, category: 'props' },
  explosive_barrel: {
    name: 'Explosive Barrel',
    info: 'Unstable · 42 kg · boom',
    glyph: 'EXP',
    swatch: 0xb32d1c,
    category: 'interactive',
  },
  ball: { name: 'Ball', info: 'Bouncy sphere · 8 kg', glyph: 'BALL', swatch: 0xe8e34a, category: 'physics' },
  plank: { name: 'Plank', info: 'Long board · 11 kg', glyph: 'PLK', swatch: 0x8f6a3c, category: 'props' },
  canister: { name: 'Canister', info: 'Fuel can · 6 kg', glyph: 'CAN', swatch: 0xd9a021, category: 'props' },
  chair: { name: 'Office Chair', info: 'Spin it, shove it · 9 kg', glyph: 'SEAT', swatch: 0x51565e, category: 'interactive' },
  cardboard_box: { name: 'Cardboard Box', info: 'Stack and toss · 4 kg', glyph: 'BOX', swatch: 0xc9a36a, category: 'props' },
  trash_bin: { name: 'Trash Bin', info: 'Tip it over · 8 kg', glyph: 'BIN', swatch: 0x3d4a3a, category: 'props' },
  shopping_cart: { name: 'Shopping Cart', info: 'Rolls on wheels · 12 kg', glyph: 'CART', swatch: 0x9aa3ad, category: 'props' },
  sofa: { name: 'Sofa', info: 'Heavy couch · 38 kg', glyph: 'SOFA', swatch: 0x5a6b4a, category: 'props' },
  bucket: { name: 'Bucket', info: 'Empty pail · 2 kg', glyph: 'PAIL', swatch: 0xc45a28, category: 'props' },
  traffic_cone: { name: 'Traffic Cone', info: 'Wobbles · 3 kg', glyph: 'CONE', swatch: 0xe85d12, category: 'props' },
  road_sign: { name: 'Road Sign', info: 'Skinny and tippy · 9 kg', glyph: 'SIGN', swatch: 0xe8b423, category: 'props' },
  bricks: { name: 'Brick Stack', info: 'Dense pile · 18 kg', glyph: 'BRK', swatch: 0xa24a32, category: 'props' },
  ladder: { name: 'Ladder', info: 'Long and awkward · 10 kg', glyph: 'LAD', swatch: 0xb48a3c, category: 'props' },
  pallet: { name: 'Pallet', info: 'Flat wood base · 14 kg', glyph: 'PAL', swatch: 0x8a6a3c, category: 'props' },
  pizza_box: { name: 'Pizza Box', info: 'Light and flat · 2 kg', glyph: 'PIZ', swatch: 0xd8c38a, category: 'props' },
  frying_pan: { name: 'Frying Pan', info: 'Cast skillet · 2 kg', glyph: 'PAN', swatch: 0x2a2d32, category: 'props' },
  kettle: { name: 'Kettle', info: 'Stout teapot · 2 kg', glyph: 'KET', swatch: 0xc0c6ce, category: 'props' },
  traffic_barrel: { name: 'Hazard Drum', info: 'Orange barrel · 16 kg', glyph: 'HAZ', swatch: 0xe25b14, category: 'props' },
  stuffed_toy: { name: 'Plush Toy', info: 'Squishy buddy · 1 kg', glyph: 'TOY', swatch: 0xe07a9a, category: 'fun' },
  duck: { name: 'Rubber Duck', info: 'Squeaks on impact · 1 kg', glyph: 'DUCK', swatch: 0xf0d23a, category: 'fun' },
  chicken: { name: 'Rubber Chicken', info: 'Honks when hit · 1 kg', glyph: 'CHK', swatch: 0xf2efe4, category: 'fun' },
  watermelon: { name: 'Watermelon', info: 'Chunky fruit · 5 kg', glyph: 'MEL', swatch: 0x3d8a42, category: 'fun' },
  soda_cup: { name: 'Giant Soda', info: 'Cup and straw · 1 kg', glyph: 'SODA', swatch: 0xe8e8ea, category: 'fun' },
  toilet_paper: { name: 'Toilet Paper', info: 'Rolls forever · 0.4 kg', glyph: 'TP', swatch: 0xf4f1ea, category: 'fun' },
  toothbrush: { name: 'Giant Toothbrush', info: 'Awkward stick · 1 kg', glyph: 'BRSH', swatch: 0x4ec4e0, category: 'fun' },
  giant_dice: { name: 'Giant Die', info: 'Rolls a six maybe · 3 kg', glyph: 'DICE', swatch: 0xf5f0e6, category: 'fun' },
  balloons: { name: 'Balloon Bunch', info: 'Floats upward · 0.3 kg', glyph: 'BAL', swatch: 0xff5a7a, category: 'fun' },
  banana_peel: { name: 'Banana Peel', info: 'Almost no friction · 0.2 kg', glyph: 'PEEL', swatch: 0xf2d12b, category: 'fun' },
  whoopee: { name: 'Whoopee Cushion', info: 'You know what it does · 0.4 kg', glyph: 'WHOO', swatch: 0xc45a8a, category: 'fun' },
  donut: { name: 'Giant Donut', info: 'Frosted torus · 1 kg', glyph: 'DON', swatch: 0xd48a4a, category: 'fun' },
  wheel: { name: 'Tire', info: 'Rolls on the rim · 9 kg', glyph: 'TIRE', swatch: 0x222428, category: 'physics' },
  beach_ball: { name: 'Beach Ball', info: 'Huge bounce · 0.6 kg', glyph: 'BEACH', swatch: 0xff6b4a, category: 'physics' },
  bowling_ball: { name: 'Bowling Ball', info: 'Dense sphere · 7 kg', glyph: 'BOWL', swatch: 0x1a1c28, category: 'physics' },
  bowling_pin: { name: 'Bowling Pin', info: 'Tips easily · 2 kg', glyph: 'PIN', swatch: 0xf4f0e6, category: 'physics' },
  magnet: { name: 'Magnet', info: 'E to yank nearby junk · 5 kg', glyph: 'MAG', swatch: 0xd22b2b, category: 'physics' },
  mattress: { name: 'Mattress', info: 'Bouncy pad · 11 kg', glyph: 'MAT', swatch: 0xe8e2d2, category: 'physics' },
  hockey_puck: { name: 'Hockey Puck', info: 'Slides ice-smooth · 0.2 kg', glyph: 'PUCK', swatch: 0x141414, category: 'physics' },
  giant_spring: { name: 'Coil Spring', info: 'Boing · 3 kg', glyph: 'SPR', swatch: 0xc9ced4, category: 'physics' },
  tv: { name: 'Old TV', info: 'E to power the screen · 14 kg', glyph: 'TV', swatch: 0x2a2d32, category: 'interactive' },
  radio: { name: 'Radio', info: 'E for a tinny burst · 2 kg', glyph: 'RAD', swatch: 0xb45a28, category: 'interactive' },
  computer: { name: 'Old Computer', info: 'E toggles the CRT · 10 kg', glyph: 'PC', swatch: 0x8a9098, category: 'interactive' },
  loose_door: { name: 'Loose Door', info: 'E swings it · 18 kg', glyph: 'DOOR', swatch: 0x7a5a32, category: 'interactive' },
  extinguisher: { name: 'Extinguisher', info: 'E puffs foam · 6 kg', glyph: 'EXT', swatch: 0xc62828, category: 'interactive' },
  broom: { name: 'Broom', info: 'Spin and sweep · 2 kg', glyph: 'BRM', swatch: 0x8a6232, category: 'interactive' },
  scooter: { name: 'Scooter', info: 'Kick it along · 6 kg', glyph: 'SCOOT', swatch: 0x3aa0d8, category: 'interactive' },
  desk_lamp: { name: 'Desk Lamp', info: 'E toggles the bulb · 2 kg', glyph: 'LAMP', swatch: 0xd6c24a, category: 'interactive' },
};

export const PROP_ENTRIES: SpawnEntry[] = PROP_KINDS.map((kind) => {
  const meta = PROP_META[kind];
  return {
    id: `prop:${kind}`,
    category: meta.category,
    name: meta.name,
    info: meta.info,
    spawnable: true,
    swatch: meta.swatch,
    glyph: meta.glyph,
  };
});

export const TOOL_ENTRIES: SpawnEntry[] = [
  {
    id: 'tool:delete',
    category: 'tools',
    name: 'Delete',
    info: 'Remove NPC, prop or weapon',
    spawnable: true,
    swatch: 0xff4d3a,
    glyph: 'DEL',
  },
  {
    id: 'tool:select',
    category: 'tools',
    name: 'Select',
    info: 'Inspect an NPC',
    spawnable: true,
    swatch: 0xd6ff3d,
    glyph: 'SEL',
  },
  {
    id: 'tool:ragdoll',
    category: 'tools',
    name: 'Ragdoll',
    info: 'Knock an NPC down',
    spawnable: true,
    swatch: 0x8aaa22,
    glyph: 'RAG',
  },
  {
    id: 'tool:grab',
    category: 'tools',
    name: 'Grab',
    info: 'Pick up and throw objects',
    spawnable: true,
    swatch: 0x6fe88a,
    glyph: 'GRAB',
  },
];

const WEAPON_FALLBACK: Record<SandboxWeaponKind, { name: string; swatch: number }> = {
  pistol: { name: 'Glock 17', swatch: 0x8a9099 },
  smg: { name: 'VX-4 Ripper', swatch: 0xff7a3d },
  rifle: { name: 'AR-7 Vesper', swatch: 0x3a3f46 },
  shotgun: { name: 'BR-12 Breaker', swatch: 0x9a6b3f },
  sniper: { name: 'LR-88 Verdict', swatch: 0x6a7380 },
  melee: { name: 'Katana', swatch: 0xc9d4dc },
};

export const WEAPON_ENTRIES: SpawnEntry[] = SANDBOX_WEAPON_KINDS.map((id) => {
  const def = isWeaponId(id) ? getWeapon(id) : null;
  const fallback = WEAPON_FALLBACK[id];
  const name = def?.name ?? fallback.name;
  return {
    id: `weapon:${id}`,
    category: 'weapons' as const,
    name,
    info: isWeaponId(id) ? 'LMB spawn · E pick up into a slot' : 'LMB spawn · Grab to throw',
    spawnable: true,
    swatch: def?.visual.accentColor ?? fallback.swatch,
    glyph: name.slice(0, 4).toUpperCase(),
  };
});

export const SPAWN_CATALOG: SpawnEntry[] = [...NPC_ENTRIES, ...PROP_ENTRIES, ...TOOL_ENTRIES, ...WEAPON_ENTRIES];

export const DEFAULT_SPAWN_ENTRY = NPC_MENU_ENABLED ? NPC_ENTRIES[0]! : PROP_ENTRIES[0]!;

export function spawnEntryById(id: string): SpawnEntry | undefined {
  return SPAWN_CATALOG.find((entry) => entry.id === id);
}

export function entriesFor(category: SpawnCategory): SpawnEntry[] {
  if (category === 'npc' && !NPC_MENU_ENABLED) return [];
  return SPAWN_CATALOG.filter((entry) => entry.category === category);
}

export function npcRagdollOnSpawn(id: string): boolean {
  return id === 'npc:ragdoll';
}

export function propKindFromEntry(id: string): PropKind | null {
  if (!id.startsWith('prop:')) return null;
  const kind = id.slice(5) as PropKind;
  return PROP_KINDS.includes(kind) ? kind : null;
}

export function toolFromEntry(id: string): ToolGunToolId | null {
  if (!id.startsWith('tool:')) return null;
  const tool = id.slice(5);
  if (tool === 'delete' || tool === 'select' || tool === 'ragdoll' || tool === 'grab') return tool;
  return null;
}

export function weaponKindFromEntry(id: string): SandboxWeaponKind | null {
  if (!id.startsWith('weapon:')) return null;
  const kind = id.slice(7) as SandboxWeaponKind;
  return (SANDBOX_WEAPON_KINDS as readonly string[]).includes(kind) ? kind : null;
}

export function interactPromptFor(kind: PropKind): string {
  switch (kind) {
    case 'tv':
    case 'computer':
    case 'desk_lamp':
      return 'E  power';
    case 'radio':
      return 'E  radio';
    case 'loose_door':
      return 'E  swing';
    case 'extinguisher':
      return 'E  spray';
    case 'magnet':
      return 'E  pull junk';
    case 'chair':
    case 'ball':
    case 'beach_ball':
    case 'scooter':
    case 'shopping_cart':
    case 'wheel':
      return 'E  shove';
    default:
      return 'E  poke';
  }
}

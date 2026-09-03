import { PROP_KINDS, isWeaponId, getWeapon, type PropKind } from '@ragelab/shared';
import { SANDBOX_WEAPON_KINDS, type SandboxWeaponKind } from '../weapons/weaponAssets';
import type { SandboxTool } from './types';

export type SpawnCategory = 'npc' | 'props' | 'tools' | 'weapons';

export type ToolGunToolId = Extract<SandboxTool, 'delete' | 'select' | 'ragdoll' | 'grab'>;

export interface SpawnEntry {
  id: string;
  category: SpawnCategory;
  name: string;
  info: string;
  /** False for weapons — Tool Gun must not create them. */
  spawnable: boolean;
  swatch: number;
  glyph: string;
}

export const NPC_ENTRIES: SpawnEntry[] = [
  {
    id: 'npc:humanoid',
    category: 'npc',
    name: 'Humanoid',
    info: 'Walking ragdoll NPC',
    spawnable: true,
    swatch: 0x3d5a80,
    glyph: 'NPC',
  },
  {
    id: 'npc:ragdoll',
    category: 'npc',
    name: 'Ragdoll Dummy',
    info: 'Spawns already limp',
    spawnable: true,
    swatch: 0xc44536,
    glyph: 'RAG',
  },
  {
    id: 'npc:crowd',
    category: 'npc',
    name: 'Civilian',
    info: 'Same humanoid, random look',
    spawnable: true,
    swatch: 0x2d6a4f,
    glyph: 'CIV',
  },
];

const PROP_META: Record<PropKind, { name: string; info: string; glyph: string }> = {
  crate: { name: 'Crate', info: 'Wooden box · 24 kg', glyph: 'BOX' },
  barrel: { name: 'Barrel', info: 'Metal drum · 38 kg', glyph: 'DRUM' },
  explosive_barrel: { name: 'Explosive Barrel', info: 'Unstable · 42 kg', glyph: 'EXP' },
  ball: { name: 'Ball', info: 'Bouncy sphere · 8 kg', glyph: 'BALL' },
  plank: { name: 'Plank', info: 'Long board · 11 kg', glyph: 'PLK' },
  canister: { name: 'Canister', info: 'Fuel can · 6 kg', glyph: 'CAN' },
  chair: { name: 'Chair', info: 'Office seat · 9 kg', glyph: 'SEAT' },
};

export const PROP_ENTRIES: SpawnEntry[] = PROP_KINDS.map((kind) => {
  const meta = PROP_META[kind];
  return {
    id: `prop:${kind}`,
    category: 'props' as const,
    name: meta.name,
    info: meta.info,
    spawnable: true,
    swatch: 0xa9793f,
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
  pistol: { name: 'RL-9 Sidearm', swatch: 0x8a9099 },
  smg: { name: 'VX-4 Ripper', swatch: 0xff7a3d },
  rifle: { name: 'AR-7 Vesper', swatch: 0x3a3f46 },
  shotgun: { name: 'BR-12 Breaker', swatch: 0x9a6b3f },
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
    info: 'View only · spawn via Weapon tool',
    spawnable: false,
    swatch: def?.visual.accentColor ?? fallback.swatch,
    glyph: name.slice(0, 4).toUpperCase(),
  };
});

export const SPAWN_CATALOG: SpawnEntry[] = [...NPC_ENTRIES, ...PROP_ENTRIES, ...TOOL_ENTRIES, ...WEAPON_ENTRIES];

export const DEFAULT_SPAWN_ENTRY = NPC_ENTRIES[0]!;

export function spawnEntryById(id: string): SpawnEntry | undefined {
  return SPAWN_CATALOG.find((entry) => entry.id === id);
}

export function entriesFor(category: SpawnCategory): SpawnEntry[] {
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

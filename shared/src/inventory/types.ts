import type { WeaponId } from '../types/weapons';
import type { CaliberId } from './calibers';

export type InventoryItemType = 'magazine' | 'ammo' | 'weapon' | 'tool' | 'other';

export interface MagazineDefinition {
  id: string;
  name: string;
  caliber: CaliberId;
  capacity: number;
  compatibleWeapons: WeaponId[];
  /** Grid size for inventory UI. */
  width: number;
  height: number;
  weight: number;
}

export interface AmmoDefinition {
  id: string;
  name: string;
  caliber: CaliberId;
  /** Default Tool Gun spawn stack size. */
  defaultStack: number;
  width: number;
  height: number;
  /** Weight per round. */
  weightPerRound: number;
}

/** Runtime magazine instance — unique physical item. */
export interface MagazineInstance {
  instanceId: string;
  defId: string;
  caliber: CaliberId;
  capacity: number;
  currentAmmo: number;
  condition: number;
  compatibleWeapons: WeaponId[];
}

export interface AmmoStack {
  instanceId: string;
  defId: string;
  caliber: CaliberId;
  quantity: number;
}

export type InventoryItem =
  | { kind: 'magazine'; mag: MagazineInstance }
  | { kind: 'ammo'; ammo: AmmoStack };

export interface PlayerInventoryState {
  items: InventoryItem[];
  /** Chambered magazine instance id per weapon id. */
  chambered: Record<string, string | null>;
}

/** Approximate mag fill for HUD / ALT+T (never exact counts). */
export type MagFillLevel = 'full' | 'high' | 'medium' | 'low' | 'empty';

export function magFillLevel(current: number, capacity: number): MagFillLevel {
  if (capacity <= 0 || current <= 0) return 'empty';
  const t = current / capacity;
  if (t >= 0.95) return 'full';
  if (t >= 0.65) return 'high';
  if (t >= 0.35) return 'medium';
  return 'low';
}

export function magFillLabel(level: MagFillLevel): string {
  switch (level) {
    case 'full':
      return 'FULL';
    case 'high':
      return 'HIGH';
    case 'medium':
      return 'MEDIUM';
    case 'low':
      return 'LOW';
    case 'empty':
      return 'EMPTY';
  }
}

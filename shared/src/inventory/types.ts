import type { WeaponId } from '../types/weapons';
import type { CaliberId } from './calibers';

export type InventoryItemType = 'magazine' | 'ammo' | 'weapon' | 'tool' | 'other';

/** Physical bag / gear containers. `equipped` = chambered in a firearm (not in grid). */
export type InventoryContainerId = 'rig' | 'backpack' | 'pockets' | 'equipped';

export interface ContainerLayout {
  id: InventoryContainerId;
  label: string;
  cols: number;
  rows: number;
}

export const INVENTORY_CONTAINERS: ContainerLayout[] = [
  { id: 'rig', label: 'РАЗГРУЗКА', cols: 4, rows: 4 },
  { id: 'pockets', label: 'КАРМАНЫ', cols: 4, rows: 1 },
  { id: 'backpack', label: 'РЮКЗАК', cols: 5, rows: 5 },
];

export interface MagazineDefinition {
  id: string;
  name: string;
  caliber: CaliberId;
  capacity: number;
  compatibleWeapons: WeaponId[];
  /** Grid size (cells). */
  width: number;
  height: number;
  weight: number;
  /** Icon key for SVG/PNG assets. */
  icon: string;
}

export interface AmmoDefinition {
  id: string;
  name: string;
  caliber: CaliberId;
  defaultStack: number;
  width: number;
  height: number;
  weightPerRound: number;
  icon: string;
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
  containerId: InventoryContainerId;
  /** Grid column (0-based). Ignored when equipped. */
  gx: number;
  /** Grid row (0-based). */
  gy: number;
  /** When true, width/height are swapped for placement. */
  rotated: boolean;
}

export interface AmmoStack {
  instanceId: string;
  defId: string;
  caliber: CaliberId;
  quantity: number;
  containerId: InventoryContainerId;
  gx: number;
  gy: number;
  rotated: boolean;
}

export type InventoryItem =
  | { kind: 'magazine'; mag: MagazineInstance }
  | { kind: 'ammo'; ammo: AmmoStack };

export interface PlayerInventoryState {
  items: InventoryItem[];
  /** Chambered magazine instance id per weapon id. */
  chambered: Record<string, string | null>;
}

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

export function itemPlacement(item: InventoryItem): {
  containerId: InventoryContainerId;
  gx: number;
  gy: number;
  rotated: boolean;
  instanceId: string;
} {
  if (item.kind === 'magazine') {
    return {
      containerId: item.mag.containerId,
      gx: item.mag.gx,
      gy: item.mag.gy,
      rotated: item.mag.rotated,
      instanceId: item.mag.instanceId,
    };
  }
  return {
    containerId: item.ammo.containerId,
    gx: item.ammo.gx,
    gy: item.ammo.gy,
    rotated: item.ammo.rotated,
    instanceId: item.ammo.instanceId,
  };
}

export function setItemPlacement(
  item: InventoryItem,
  patch: Partial<{ containerId: InventoryContainerId; gx: number; gy: number; rotated: boolean }>,
): void {
  const target = item.kind === 'magazine' ? item.mag : item.ammo;
  if (patch.containerId !== undefined) target.containerId = patch.containerId;
  if (patch.gx !== undefined) target.gx = patch.gx;
  if (patch.gy !== undefined) target.gy = patch.gy;
  if (patch.rotated !== undefined) target.rotated = patch.rotated;
}

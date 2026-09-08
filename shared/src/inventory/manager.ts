import type { WeaponId } from '../types/weapons';
import { getWeapon } from '../weapons/definitions';
import {
  AMMO_DEFINITIONS,
  MAGAZINE_DEFINITIONS,
  STARTING_MAGAZINES_PER_WEAPON,
  ammoDefForCaliber,
  magazineDefForWeapon,
} from './definitions';
import type { CaliberId } from './calibers';
import {
  INVENTORY_CONTAINERS,
  itemPlacement,
  setItemPlacement,
  type AmmoStack,
  type InventoryContainerId,
  type InventoryItem,
  type MagazineInstance,
  type PlayerInventoryState,
} from './types';

let idCounter = 1;

export function nextInventoryId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function createEmptyInventory(): PlayerInventoryState {
  return { items: [], chambered: {} };
}

export function createFullMagazine(weaponId: WeaponId, capacityOverride?: number): MagazineInstance {
  const def = magazineDefForWeapon(weaponId);
  const capacity = capacityOverride ?? getWeapon(weaponId).magazineSize ?? def.capacity;
  return {
    instanceId: nextInventoryId('mag'),
    defId: def.id,
    caliber: def.caliber,
    capacity,
    currentAmmo: capacity,
    condition: 100,
    compatibleWeapons: [...def.compatibleWeapons],
    containerId: 'rig',
    gx: 0,
    gy: 0,
    rotated: false,
  };
}

export function getItemFootprint(item: InventoryItem): { w: number; h: number } {
  if (item.kind === 'magazine') {
    const def = MAGAZINE_DEFINITIONS[item.mag.defId] ?? magazineDefForWeapon(item.mag.compatibleWeapons[0] ?? 'glock');
    return item.mag.rotated ? { w: def.height, h: def.width } : { w: def.width, h: def.height };
  }
  const def = ammoDefForCaliber(item.ammo.caliber);
  return item.ammo.rotated ? { w: def.height, h: def.width } : { w: def.width, h: def.height };
}

function containerDims(id: InventoryContainerId): { cols: number; rows: number } | null {
  if (id === 'equipped') return null;
  const layout = INVENTORY_CONTAINERS.find((c) => c.id === id);
  return layout ? { cols: layout.cols, rows: layout.rows } : null;
}

export function cellsOccupied(
  gx: number,
  gy: number,
  w: number,
  h: number,
): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) cells.push({ x: gx + x, y: gy + y });
  }
  return cells;
}

function chamberedSet(inv: PlayerInventoryState): Set<string> {
  return new Set(Object.values(inv.chambered).filter(Boolean) as string[]);
}

export function canPlaceItem(
  inv: PlayerInventoryState,
  item: InventoryItem,
  containerId: InventoryContainerId,
  gx: number,
  gy: number,
  rotated: boolean,
  ignoreInstanceId?: string,
): boolean {
  if (containerId === 'equipped') return false;
  const dims = containerDims(containerId);
  if (!dims) return false;

  const probe: InventoryItem =
    item.kind === 'magazine'
      ? { kind: 'magazine', mag: { ...item.mag, rotated } }
      : { kind: 'ammo', ammo: { ...item.ammo, rotated } };
  const { w, h } = getItemFootprint(probe);
  if (gx < 0 || gy < 0 || gx + w > dims.cols || gy + h > dims.rows) return false;

  const want = new Set(cellsOccupied(gx, gy, w, h).map((c) => `${c.x},${c.y}`));
  const equipped = chamberedSet(inv);

  for (const other of inv.items) {
    const p = itemPlacement(other);
    if (p.instanceId === ignoreInstanceId) continue;
    if (p.containerId !== containerId) continue;
    if (other.kind === 'magazine' && equipped.has(other.mag.instanceId)) continue;
    const fp = getItemFootprint(other);
    for (const c of cellsOccupied(p.gx, p.gy, fp.w, fp.h)) {
      if (want.has(`${c.x},${c.y}`)) return false;
    }
  }
  return true;
}

export function findFreeSlot(
  inv: PlayerInventoryState,
  item: InventoryItem,
  preferred: InventoryContainerId[] = ['rig', 'pockets', 'backpack'],
): { containerId: InventoryContainerId; gx: number; gy: number; rotated: boolean } | null {
  const ignore = itemPlacement(item).instanceId;
  for (const containerId of preferred) {
    const dims = containerDims(containerId);
    if (!dims) continue;
    for (const rotated of [false, true] as const) {
      const probe: InventoryItem =
        item.kind === 'magazine'
          ? { kind: 'magazine', mag: { ...item.mag, rotated } }
          : { kind: 'ammo', ammo: { ...item.ammo, rotated } };
      const { w, h } = getItemFootprint(probe);
      for (let gy = 0; gy <= dims.rows - h; gy++) {
        for (let gx = 0; gx <= dims.cols - w; gx++) {
          if (canPlaceItem(inv, item, containerId, gx, gy, rotated, ignore)) {
            return { containerId, gx, gy, rotated };
          }
        }
      }
    }
  }
  return null;
}

export function moveInventoryItem(
  inv: PlayerInventoryState,
  instanceId: string,
  containerId: InventoryContainerId,
  gx: number,
  gy: number,
  rotated: boolean,
): boolean {
  const item = inv.items.find((i) => itemPlacement(i).instanceId === instanceId);
  if (!item) return false;
  if (item.kind === 'magazine' && chamberedSet(inv).has(item.mag.instanceId)) return false;
  if (!canPlaceItem(inv, item, containerId, gx, gy, rotated, instanceId)) return false;
  setItemPlacement(item, { containerId, gx, gy, rotated });
  return true;
}

export function autoPackLooseItems(inv: PlayerInventoryState): void {
  const equipped = chamberedSet(inv);
  for (const item of inv.items) {
    if (item.kind === 'magazine' && equipped.has(item.mag.instanceId)) {
      setItemPlacement(item, { containerId: 'equipped', gx: 0, gy: 0, rotated: false });
      continue;
    }
    const p = itemPlacement(item);
    if (p.containerId === 'equipped') {
      const slot = findFreeSlot(inv, item);
      if (slot) setItemPlacement(item, slot);
      continue;
    }
    if (canPlaceItem(inv, item, p.containerId, p.gx, p.gy, p.rotated, p.instanceId)) continue;
    const slot = findFreeSlot(inv, item);
    if (slot) setItemPlacement(item, slot);
  }
}

export function normalizeInventoryPlacements(inv: PlayerInventoryState): void {
  for (const item of inv.items) {
    if (item.kind === 'magazine') {
      item.mag.containerId = item.mag.containerId ?? 'rig';
      item.mag.gx = item.mag.gx ?? 0;
      item.mag.gy = item.mag.gy ?? 0;
      item.mag.rotated = Boolean(item.mag.rotated);
    } else {
      item.ammo.containerId = item.ammo.containerId ?? 'backpack';
      item.ammo.gx = item.ammo.gx ?? 0;
      item.ammo.gy = item.ammo.gy ?? 0;
      item.ammo.rotated = Boolean(item.ammo.rotated);
    }
  }
  autoPackLooseItems(inv);
}

export function grantStartingMagazines(inv: PlayerInventoryState, loadout: WeaponId[]): void {
  inv.items = inv.items.filter((i) => i.kind !== 'magazine');
  inv.chambered = {};
  for (const weaponId of loadout) {
    const mags: MagazineInstance[] = [];
    for (let i = 0; i < STARTING_MAGAZINES_PER_WEAPON; i++) {
      mags.push(createFullMagazine(weaponId));
    }
    const chambered = mags[0]!;
    chambered.containerId = 'equipped';
    chambered.gx = 0;
    chambered.gy = 0;
    inv.chambered[weaponId] = chambered.instanceId;
    inv.items.push({ kind: 'magazine', mag: chambered });

    for (let i = 1; i < mags.length; i++) {
      const mag = mags[i]!;
      const item: InventoryItem = { kind: 'magazine', mag };
      const slot = findFreeSlot(inv, item);
      if (slot) {
        mag.containerId = slot.containerId;
        mag.gx = slot.gx;
        mag.gy = slot.gy;
        mag.rotated = slot.rotated;
      } else {
        mag.containerId = 'backpack';
        mag.gx = 0;
        mag.gy = 0;
      }
      inv.items.push(item);
    }
  }
}

export function findCompatibleMagazines(
  inv: PlayerInventoryState,
  weaponId: WeaponId,
): MagazineInstance[] {
  return inv.items
    .filter((i): i is { kind: 'magazine'; mag: MagazineInstance } => i.kind === 'magazine')
    .map((i) => i.mag)
    .filter((m) => m.compatibleWeapons.includes(weaponId));
}

export function getMagazine(inv: PlayerInventoryState, instanceId: string): MagazineInstance | null {
  for (const item of inv.items) {
    if (item.kind === 'magazine' && item.mag.instanceId === instanceId) return item.mag;
  }
  return null;
}

export function getChamberedMagazine(
  inv: PlayerInventoryState,
  weaponId: WeaponId,
): MagazineInstance | null {
  const id = inv.chambered[weaponId];
  if (!id) return null;
  return getMagazine(inv, id);
}

export function pickReloadMagazine(
  inv: PlayerInventoryState,
  weaponId: WeaponId,
): MagazineInstance | null {
  const currentId = inv.chambered[weaponId];
  const candidates = findCompatibleMagazines(inv, weaponId).filter((m) => m.instanceId !== currentId);
  if (candidates.length === 0) return null;
  const nonEmpty = candidates.filter((m) => m.currentAmmo > 0);
  const pool = nonEmpty.length > 0 ? nonEmpty : candidates;
  pool.sort((a, b) => b.currentAmmo - a.currentAmmo);
  return pool[0] ?? null;
}

export function canSwapMagazine(inv: PlayerInventoryState, weaponId: WeaponId, nowOk: boolean): boolean {
  if (!nowOk) return false;
  return pickReloadMagazine(inv, weaponId) !== null;
}

export function swapMagazine(inv: PlayerInventoryState, weaponId: WeaponId): MagazineInstance | null {
  const next = pickReloadMagazine(inv, weaponId);
  if (!next) return null;
  const prevId = inv.chambered[weaponId];
  const prev = prevId ? getMagazine(inv, prevId) : null;
  if (prev) {
    const item = inv.items.find((i) => i.kind === 'magazine' && i.mag.instanceId === prev.instanceId);
    if (item) {
      // Temporarily mark as not chambered for packing search
      inv.chambered[weaponId] = next.instanceId;
      next.containerId = 'equipped';
      next.gx = 0;
      next.gy = 0;
      const slot = findFreeSlot(inv, item, ['rig', 'pockets', 'backpack']);
      if (slot) {
        prev.containerId = slot.containerId;
        prev.gx = slot.gx;
        prev.gy = slot.gy;
        prev.rotated = slot.rotated;
      } else {
        prev.containerId = 'backpack';
        prev.gx = 0;
        prev.gy = 0;
        prev.rotated = false;
      }
      return next;
    }
  }
  next.containerId = 'equipped';
  next.gx = 0;
  next.gy = 0;
  inv.chambered[weaponId] = next.instanceId;
  return next;
}

export function consumeChamberedRound(inv: PlayerInventoryState, weaponId: WeaponId): boolean {
  const mag = getChamberedMagazine(inv, weaponId);
  if (!mag || mag.currentAmmo <= 0) return false;
  mag.currentAmmo -= 1;
  return true;
}

export function syncWeaponAmmoFromMag(
  inv: PlayerInventoryState,
  weaponId: WeaponId,
): { ammoInMag: number; ammoReserve: number } {
  const chambered = getChamberedMagazine(inv, weaponId);
  const ammoInMag = chambered?.currentAmmo ?? 0;
  let ammoReserve = 0;
  for (const mag of findCompatibleMagazines(inv, weaponId)) {
    if (chambered && mag.instanceId === chambered.instanceId) continue;
    ammoReserve += 1;
  }
  return { ammoInMag, ammoReserve };
}

export function addAmmoStack(inv: PlayerInventoryState, caliber: CaliberId, quantity: number): AmmoStack {
  const def = ammoDefForCaliber(caliber);
  for (const item of inv.items) {
    if (item.kind === 'ammo' && item.ammo.caliber === caliber) {
      item.ammo.quantity += quantity;
      return item.ammo;
    }
  }
  const ammo: AmmoStack = {
    instanceId: nextInventoryId('ammo'),
    defId: def.id,
    caliber,
    quantity,
    containerId: 'backpack',
    gx: 0,
    gy: 0,
    rotated: false,
  };
  const item: InventoryItem = { kind: 'ammo', ammo };
  const slot = findFreeSlot(inv, item, ['backpack', 'pockets', 'rig']);
  if (slot) {
    ammo.containerId = slot.containerId;
    ammo.gx = slot.gx;
    ammo.gy = slot.gy;
    ammo.rotated = slot.rotated;
  }
  inv.items.push(item);
  return ammo;
}

export function cloneInventory(inv: PlayerInventoryState): PlayerInventoryState {
  return JSON.parse(JSON.stringify(inv)) as PlayerInventoryState;
}

export function listAmmoSpawnOptions(): Array<{
  id: string;
  name: string;
  caliber: CaliberId;
  amount: number;
}> {
  return Object.values(AMMO_DEFINITIONS).map((d) => ({
    id: d.id,
    name: d.name,
    caliber: d.caliber,
    amount: d.defaultStack,
  }));
}

import type { WeaponId } from '../types/weapons';
import { getWeapon } from '../weapons/definitions';
import {
  AMMO_DEFINITIONS,
  STARTING_MAGAZINES_PER_WEAPON,
  ammoDefForCaliber,
  magazineDefForWeapon,
} from './definitions';
import type { CaliberId } from './calibers';
import type {
  AmmoStack,
  MagazineInstance,
  PlayerInventoryState,
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
  };
}

export function grantStartingMagazines(
  inv: PlayerInventoryState,
  loadout: WeaponId[],
): void {
  inv.items = inv.items.filter((i) => i.kind !== 'magazine');
  inv.chambered = {};
  for (const weaponId of loadout) {
    const mags: MagazineInstance[] = [];
    for (let i = 0; i < STARTING_MAGAZINES_PER_WEAPON; i++) {
      mags.push(createFullMagazine(weaponId));
    }
    const chambered = mags[0]!;
    inv.chambered[weaponId] = chambered.instanceId;
    // Chambered mag is NOT listed as a loose inventory item.
    for (let i = 1; i < mags.length; i++) {
      inv.items.push({ kind: 'magazine', mag: mags[i]! });
    }
    // Keep chambered mag stored separately via chambered map + side map on server.
    inv.items.push({ kind: 'magazine', mag: chambered });
  }
}

/** Magazines compatible with a weapon that are in the bag (including chambered entry). */
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

/**
 * Pick next magazine for reload: prefer non-empty, then fullest, skip current chambered.
 */
export function pickReloadMagazine(
  inv: PlayerInventoryState,
  weaponId: WeaponId,
): MagazineInstance | null {
  const currentId = inv.chambered[weaponId];
  const candidates = findCompatibleMagazines(inv, weaponId).filter(
    (m) => m.instanceId !== currentId,
  );
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

/**
 * Swap chambered magazine. Returns the newly chambered mag, or null if failed.
 * Old chambered mag stays in inventory with its remaining ammo.
 */
export function swapMagazine(inv: PlayerInventoryState, weaponId: WeaponId): MagazineInstance | null {
  const next = pickReloadMagazine(inv, weaponId);
  if (!next) return null;
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
  // Snapshot "reserve" = number of spare compatible magazines (for reload availability).
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
  };
  inv.items.push({ kind: 'ammo', ammo });
  return ammo;
}

export function cloneInventory(inv: PlayerInventoryState): PlayerInventoryState {
  return JSON.parse(JSON.stringify(inv)) as PlayerInventoryState;
}

export function listAmmoSpawnOptions(): Array<{ id: string; name: string; caliber: CaliberId; amount: number }> {
  return Object.values(AMMO_DEFINITIONS).map((d) => ({
    id: d.id,
    name: d.name,
    caliber: d.caliber,
    amount: d.defaultStack,
  }));
}

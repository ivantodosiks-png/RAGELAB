import type { WeaponId } from '../types/weapons';
import type { CaliberId } from './calibers';
import type { AmmoDefinition, MagazineDefinition } from './types';

/** Primary caliber for each firearm id. */
export const WEAPON_CALIBER: Record<string, CaliberId> = {
  pistol: '50ae',
  glock: '9x19',
  magnum: '50ae',
  usp: '9x19',
  makarov: '9x19',
  smg: '9x19',
  pdw: '9x19',
  bizon: '9x19',
  rifle: '556x45',
  assault: '556x45',
  ak: '762x39',
  shotgun: '12gauge',
  autosg: '12gauge',
  saiga: '12gauge',
  sniper: '50bmg',
  dmr: '762x54r',
};

export function weaponCaliber(weaponId: WeaponId): CaliberId {
  return WEAPON_CALIBER[weaponId] ?? '9x19';
}

export const MAGAZINE_DEFINITIONS: Record<string, MagazineDefinition> = {
  mag_pistol: {
    id: 'mag_pistol',
    name: 'Deagle Magazine',
    caliber: '50ae',
    capacity: 7,
    compatibleWeapons: ['pistol', 'magnum'],
    width: 1,
    height: 1,
    weight: 0.18,
  },
  mag_glock: {
    id: 'mag_glock',
    name: 'Glock Magazine',
    caliber: '9x19',
    capacity: 17,
    compatibleWeapons: ['glock', 'usp', 'makarov'],
    width: 1,
    height: 1,
    weight: 0.14,
  },
  mag_smg: {
    id: 'mag_smg',
    name: 'SMG Magazine',
    caliber: '9x19',
    capacity: 32,
    compatibleWeapons: ['smg', 'pdw'],
    width: 1,
    height: 2,
    weight: 0.28,
  },
  mag_bizon: {
    id: 'mag_bizon',
    name: 'Bizon Helical Mag',
    caliber: '9x19',
    capacity: 64,
    compatibleWeapons: ['bizon'],
    width: 2,
    height: 2,
    weight: 0.55,
  },
  mag_rifle: {
    id: 'mag_rifle',
    name: 'STANAG Magazine',
    caliber: '556x45',
    capacity: 30,
    compatibleWeapons: ['rifle', 'assault'],
    width: 1,
    height: 2,
    weight: 0.35,
  },
  mag_ak: {
    id: 'mag_ak',
    name: 'AK Magazine',
    caliber: '762x39',
    capacity: 30,
    compatibleWeapons: ['ak'],
    width: 1,
    height: 2,
    weight: 0.4,
  },
  mag_shotgun: {
    id: 'mag_shotgun',
    name: 'Shotgun Tube / Mag',
    caliber: '12gauge',
    capacity: 6,
    compatibleWeapons: ['shotgun'],
    width: 1,
    height: 2,
    weight: 0.3,
  },
  mag_autosg: {
    id: 'mag_autosg',
    name: 'Auto-SG Magazine',
    caliber: '12gauge',
    capacity: 8,
    compatibleWeapons: ['autosg'],
    width: 1,
    height: 2,
    weight: 0.38,
  },
  mag_saiga: {
    id: 'mag_saiga',
    name: 'Saiga Magazine',
    caliber: '12gauge',
    capacity: 5,
    compatibleWeapons: ['saiga'],
    width: 1,
    height: 2,
    weight: 0.32,
  },
  mag_sniper: {
    id: 'mag_sniper',
    name: '.50 BMG Magazine',
    caliber: '50bmg',
    capacity: 5,
    compatibleWeapons: ['sniper'],
    width: 1,
    height: 2,
    weight: 0.7,
  },
  mag_dmr: {
    id: 'mag_dmr',
    name: 'DMR Magazine',
    caliber: '762x54r',
    capacity: 10,
    compatibleWeapons: ['dmr'],
    width: 1,
    height: 2,
    weight: 0.42,
  },
};

export const AMMO_DEFINITIONS: Record<string, AmmoDefinition> = {
  ammo_9x19: {
    id: 'ammo_9x19',
    name: '9×19mm',
    caliber: '9x19',
    defaultStack: 30,
    width: 1,
    height: 1,
    weightPerRound: 0.012,
  },
  ammo_545x39: {
    id: 'ammo_545x39',
    name: '5.45×39mm',
    caliber: '545x39',
    defaultStack: 30,
    width: 1,
    height: 1,
    weightPerRound: 0.011,
  },
  ammo_556x45: {
    id: 'ammo_556x45',
    name: '5.56×45mm',
    caliber: '556x45',
    defaultStack: 30,
    width: 1,
    height: 1,
    weightPerRound: 0.012,
  },
  ammo_762x39: {
    id: 'ammo_762x39',
    name: '7.62×39mm',
    caliber: '762x39',
    defaultStack: 30,
    width: 1,
    height: 1,
    weightPerRound: 0.016,
  },
  ammo_762x54r: {
    id: 'ammo_762x54r',
    name: '7.62×54R',
    caliber: '762x54r',
    defaultStack: 20,
    width: 1,
    height: 1,
    weightPerRound: 0.022,
  },
  ammo_50bmg: {
    id: 'ammo_50bmg',
    name: '.50 BMG',
    caliber: '50bmg',
    defaultStack: 10,
    width: 1,
    height: 1,
    weightPerRound: 0.12,
  },
  ammo_12gauge: {
    id: 'ammo_12gauge',
    name: '12 Gauge',
    caliber: '12gauge',
    defaultStack: 20,
    width: 1,
    height: 1,
    weightPerRound: 0.045,
  },
  ammo_50ae: {
    id: 'ammo_50ae',
    name: '.50 AE',
    caliber: '50ae',
    defaultStack: 28,
    width: 1,
    height: 1,
    weightPerRound: 0.025,
  },
};

export function magazineDefForWeapon(weaponId: WeaponId): MagazineDefinition {
  const found = Object.values(MAGAZINE_DEFINITIONS).find((d) =>
    d.compatibleWeapons.includes(weaponId),
  );
  if (found) return found;
  // Fallback generic based on caliber capacity from weapon table callers.
  return {
    id: `mag_generic_${weaponId}`,
    name: `${weaponId} Magazine`,
    caliber: weaponCaliber(weaponId),
    capacity: 30,
    compatibleWeapons: [weaponId],
    width: 1,
    height: 2,
    weight: 0.3,
  };
}

export function ammoDefForCaliber(caliber: CaliberId): AmmoDefinition {
  const found = Object.values(AMMO_DEFINITIONS).find((d) => d.caliber === caliber);
  if (found) return found;
  return {
    id: `ammo_${caliber}`,
    name: caliber,
    caliber,
    defaultStack: 30,
    width: 1,
    height: 1,
    weightPerRound: 0.012,
  };
}

export const STARTING_MAGAZINES_PER_WEAPON = 5;

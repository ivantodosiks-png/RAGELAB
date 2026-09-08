/** Extensible caliber / ammo type ids. */
export const CALIBERS = {
  '9x19': { id: '9x19', name: '9×19mm', short: '9×19' },
  '545x39': { id: '545x39', name: '5.45×39mm', short: '5.45' },
  '556x45': { id: '556x45', name: '5.56×45mm', short: '5.56' },
  '762x39': { id: '762x39', name: '7.62×39mm', short: '7.62' },
  '762x54r': { id: '762x54r', name: '7.62×54R', short: '7.62R' },
  '50bmg': { id: '50bmg', name: '.50 BMG', short: '.50' },
  '12gauge': { id: '12gauge', name: '12 Gauge', short: '12G' },
  '50ae': { id: '50ae', name: '.50 AE', short: '.50AE' },
} as const;

export type CaliberId = keyof typeof CALIBERS;

export function isCaliberId(value: string): value is CaliberId {
  return Object.prototype.hasOwnProperty.call(CALIBERS, value);
}

export function caliberName(id: CaliberId): string {
  return CALIBERS[id].name;
}

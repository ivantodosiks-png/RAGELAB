export type WeaponId = string;

export const FireMode = {
  Single: 'single',
  Auto: 'auto',
  Burst: 'burst',
  BoltAction: 'bolt',
} as const;
export type FireModeId = (typeof FireMode)[keyof typeof FireMode];

export const DamageFalloff = {
  None: 'none',
  Linear: 'linear',
} as const;
export type DamageFalloffId = (typeof DamageFalloff)[keyof typeof DamageFalloff];

export interface RecoilProfile {
  /** Vertical kick per shot, radians. */
  vertical: number;
  /** Horizontal kick per shot, radians (randomised sign). */
  horizontal: number;
  /** How fast the view returns to the pre-fire aim, 1/s. */
  recovery: number;
  /** Camera punch magnitude (visual only). */
  cameraPunch: number;
  /** View-model kickback, metres. */
  viewKick: number;
}

export interface SpreadProfile {
  /** Cone half-angle while standing still, radians. */
  base: number;
  /** Extra cone added per shot fired, radians. */
  perShot: number;
  /** Maximum cone, radians. */
  max: number;
  /** Cone decay rate, radians/s. */
  recovery: number;
  /** Multiplier applied while moving at full speed. */
  moveMultiplier: number;
  /** Multiplier applied while airborne. */
  airMultiplier: number;
  /** Multiplier applied while aiming down sights. */
  aimMultiplier: number;
  /** Multiplier applied while crouching. */
  crouchMultiplier: number;
}

export interface WeaponAudioProfile {
  /** Procedural synth preset key (see client audio engine). */
  fire: string;
  reload: string;
  /** Base pitch multiplier so each weapon reads differently. */
  pitch: number;
  /** Rolloff distance for 3d positional audio, metres. */
  maxDistance: number;
}

export interface WeaponVisualProfile {
  /** Body colour of the procedural view model. */
  color: number;
  accentColor: number;
  /** Rough view-model proportions in metres (length, height, width). */
  size: [number, number, number];
  muzzleFlashScale: number;
  tracerWidth: number;
  tracerColor: number;
  shellEjection: boolean;
  /** Screen-space resting position of the view model. */
  hipPosition: [number, number, number];
  aimPosition: [number, number, number];
}

export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  /** Inventory slot this weapon occupies by default. */
  slot: number;
  fireMode: FireModeId;
  burstCount: number;
  /** Rounds per minute. */
  rpm: number;
  /** Base damage at point blank, per pellet. */
  damage: number;
  /** Number of raycasts per trigger pull (shotguns > 1). */
  pellets: number;
  magazineSize: number;
  reserveAmmo: number;
  reloadMs: number;
  /** Empty-magazine reload, usually a bit longer. */
  reloadEmptyMs: number;
  /** Max effective range in metres; beyond this no damage is applied. */
  range: number;
  falloff: DamageFalloffId;
  /** Damage multiplier at max range when falloff is linear. */
  falloffMinMultiplier: number;
  /** Distance at which falloff starts. */
  falloffStart: number;
  /** Metres/second. 0 = instant hitscan. */
  projectileSpeed: number;
  /** How much a hit pushes physics props. */
  impactImpulse: number;
  /** NPC hitbox multipliers. Headshots on firearms should exceed 100 HP. */
  headMultiplier: number;
  chestMultiplier: number;
  bodyMultiplier: number;
  limbMultiplier: number;
  /** Movement speed multiplier while holding this weapon. */
  moveSpeedMultiplier: number;
  /** Multiplier applied while aiming down sights. */
  aimMoveSpeedMultiplier: number;
  aimFovMultiplier: number;
  aimTimeMs: number;
  /** Time to raise the weapon after a switch. */
  equipMs: number;
  recoil: RecoilProfile;
  spread: SpreadProfile;
  audio: WeaponAudioProfile;
  visual: WeaponVisualProfile;
}

/** Per-player runtime weapon state (server-authoritative). */
export interface WeaponRuntimeState {
  weaponId: WeaponId;
  ammoInMag: number;
  ammoReserve: number;
  /** Server timestamp (ms) of the last shot. */
  lastShotAt: number;
  /** Server timestamp (ms) at which an in-progress reload completes. */
  reloadEndsAt: number;
  /** Server timestamp (ms) at which the weapon becomes usable after a switch. */
  equipEndsAt: number;
  burstRemaining: number;
  /** Accumulated spread cone in radians. */
  spread: number;
  shotCounter: number;
}

export function msPerShot(def: WeaponDefinition): number {
  return 60_000 / def.rpm;
}

export function damageAtDistance(def: WeaponDefinition, dist: number): number {
  if (dist > def.range) return 0;
  if (def.falloff === DamageFalloff.None || dist <= def.falloffStart) return def.damage;
  const span = Math.max(def.range - def.falloffStart, 1e-3);
  const t = Math.min((dist - def.falloffStart) / span, 1);
  return def.damage * (1 - t * (1 - def.falloffMinMultiplier));
}

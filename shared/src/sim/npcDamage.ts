import { damageAtDistance, type WeaponDefinition } from '../types/weapons';

export const NpcHitZone = {
  Head: 'head',
  Chest: 'chest',
  Body: 'body',
  Arm: 'arm',
  Leg: 'leg',
} as const;
export type NpcHitZoneId = (typeof NpcHitZone)[keyof typeof NpcHitZone];

export const NPC_MAX_HEALTH = 100;

/** Map a ragdoll / visual part id onto a gameplay hit zone. */
export function npcZoneForPart(part: string): NpcHitZoneId {
  if (part === 'head') return NpcHitZone.Head;
  if (part === 'torso') return NpcHitZone.Chest;
  if (part === 'pelvis' || part === 'locator') return NpcHitZone.Body;
  if (part.includes('Arm') || part.includes('hand') || part.includes('Hand')) return NpcHitZone.Arm;
  return NpcHitZone.Leg;
}

export function npcZoneMultiplier(def: WeaponDefinition, zone: NpcHitZoneId): number {
  switch (zone) {
    case NpcHitZone.Head:
      return def.headMultiplier;
    case NpcHitZone.Chest:
      return def.chestMultiplier;
    case NpcHitZone.Body:
      return def.bodyMultiplier;
    default:
      return def.limbMultiplier;
  }
}

/**
 * Damage a sandbox NPC takes from one client-side hitscan.
 * Shotguns fire many pellets; a single aim ray approximates a cluster on body
 * shots and a single pellet on a precise headshot.
 */
export function npcHitDamage(def: WeaponDefinition, zone: NpcHitZoneId, distance: number): number {
  const base = damageAtDistance(def, distance);
  const pellets =
    def.pellets > 1 ? (zone === NpcHitZone.Head ? 1 : Math.max(2, Math.round(def.pellets * 0.45))) : 1;
  return base * npcZoneMultiplier(def, zone) * pellets;
}

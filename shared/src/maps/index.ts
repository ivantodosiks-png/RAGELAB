import type { MapDefinition } from '../types/map';
import { RAGEYARD } from './rageyard';
import { ARENA } from './arena';
import { HARBORLANE } from './harborlane';
import { AIMPIT } from './aimpit';

/** Registry of every playable map. Add a data file + one entry here. */
export const MAPS: Record<string, MapDefinition> = {
  [HARBORLANE.id]: HARBORLANE,
  [RAGEYARD.id]: RAGEYARD,
  [AIMPIT.id]: AIMPIT,
  [ARENA.id]: ARENA,
};

export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP_ID = HARBORLANE.id;

export function getMap(id: string): MapDefinition {
  const map = MAPS[id];
  if (!map) throw new Error(`Unknown map id: ${id}`);
  return map;
}

export function isMapId(id: unknown): id is string {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(MAPS, id);
}

export { HARBORLANE, RAGEYARD, ARENA, AIMPIT };
export * from './archetypes';

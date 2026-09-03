import type { MapDefinition } from '../types/map';
import { RAGEYARD } from './rageyard';
import { TESTBOX } from './testbox';

/** Registry of every playable map. Add a data file + one entry here. */
export const MAPS: Record<string, MapDefinition> = {
  [RAGEYARD.id]: RAGEYARD,
  [TESTBOX.id]: TESTBOX,
};

export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP_ID = RAGEYARD.id;

export function getMap(id: string): MapDefinition {
  const map = MAPS[id];
  if (!map) throw new Error(`Unknown map id: ${id}`);
  return map;
}

export function isMapId(id: unknown): id is string {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(MAPS, id);
}

export { RAGEYARD, TESTBOX };
export * from './archetypes';

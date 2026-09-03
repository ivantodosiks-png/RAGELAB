import {
  playerSpawns,
  spawnsOf,
  teamSpawns,
  type MapDefinition,
  type SpawnPointDef,
  type SpawnRole,
} from '@ragelab/shared';

/**
 * Named spawn layout for Harbor Lane and future maps.
 *
 * Player / NPC / vehicle / prop roles live on the shared MapDefinition so the
 * server, the client, and later vehicle code all read the same points.
 */
export function mapSpawns(map: MapDefinition, role: SpawnRole): SpawnPointDef[] {
  if (role === 'player') return playerSpawns(map);
  return spawnsOf(map, role);
}

export function pickMapSpawn(map: MapDefinition, role: SpawnRole, index = 0): SpawnPointDef | null {
  const list = mapSpawns(map, role);
  if (list.length === 0) return null;
  return list[index % list.length] ?? null;
}

export function pickTeamSpawn(map: MapDefinition, team: number, index = 0): SpawnPointDef | null {
  const sided = team > 0 ? teamSpawns(map, team) : [];
  const list = sided.length > 0 ? sided : playerSpawns(map);
  if (list.length === 0) return null;
  return list[index % list.length] ?? null;
}

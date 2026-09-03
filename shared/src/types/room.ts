import type { PlayerIdentity, PlayerScore } from './player';

export const GameMode = {
  Sandbox: 'sandbox',
  Deathmatch: 'deathmatch',
} as const;
export type GameModeId = (typeof GameMode)[keyof typeof GameMode];

export interface RoomSummary {
  id: string;
  name: string;
  mapId: string;
  mode: GameModeId;
  playerCount: number;
  maxPlayers: number;
  hasPassword: boolean;
  region: string;
  /** Server-reported average tick duration, useful for health display. */
  tickMs: number;
  createdAt: number;
}

export interface RoomConfig {
  name: string;
  mapId: string;
  mode: GameModeId;
  maxPlayers: number;
  password?: string;
  /** Friendly fire toggle for future team modes. */
  friendlyFire: boolean;
  /** Score needed to end a deathmatch; 0 = endless sandbox. */
  scoreLimit: number;
  timeLimitMs: number;
}

export interface RoomState {
  id: string;
  name: string;
  mapId: string;
  mode: GameModeId;
  maxPlayers: number;
  players: PlayerIdentity[];
  scores: PlayerScore[];
  /** Server time (ms since server start) at which the match ends; 0 = endless. */
  matchEndsAt: number;
}

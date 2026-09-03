import type { PlayerIdentity, PlayerScore } from './player';

export const GameMode = {
  Sandbox: 'sandbox',
  Deathmatch: 'deathmatch',
} as const;
export type GameModeId = (typeof GameMode)[keyof typeof GameMode];

export const RoomPhase = {
  Lobby: 'lobby',
  Playing: 'playing',
  Closed: 'closed',
} as const;
export type RoomPhaseId = (typeof RoomPhase)[keyof typeof RoomPhase];

export interface RoomSummary {
  id: string;
  name: string;
  mapId: string;
  mode: GameModeId;
  phase: RoomPhaseId;
  playerCount: number;
  maxPlayers: number;
  hasPassword: boolean;
  region: string;
  /** Server-reported average tick duration, useful for health display. */
  tickMs: number;
  createdAt: number;
  /**
   * Public WebSocket URL of the process hosting this room. Friends on another
   * network join here instead of their own localhost.
   */
  wsUrl?: string;
  /** Shareable 6-character lobby code. */
  joinCode?: string;
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

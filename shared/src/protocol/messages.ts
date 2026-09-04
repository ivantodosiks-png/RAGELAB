import type { GameEvent } from '../types/events';
import type { PlayerId, PlayerIdentity, PlayerScore } from '../types/player';
import type { GameModeId, RoomConfig, RoomPhaseId, RoomSummary } from '../types/room';
import type { WeaponId } from '../types/weapons';

// ── client -> server JSON payloads ──────────────────────────────────────────

export interface HelloPayload {
  /** Supabase access token. Omit for guest play (if the server allows it). */
  token?: string;
  /** Requested display name; only honoured for guests. */
  username?: string;
  /** Join this room; when omitted the server auto-matches. */
  roomId?: string;
  /** Join by shareable lobby code (alternative to roomId). */
  roomCode?: string;
  password?: string;
  /** Used when auto-matching or creating a room. */
  mapId?: string;
  /** 1 = Alpha, 2 = Bravo on duel maps. */
  team?: number;
  mode?: GameModeId;
  /** Create a new room and become its host instead of auto-matching. */
  create?: Partial<RoomConfig>;
  /** Protocol version guard. */
  protocol: number;
}

export interface SwitchWeaponPayload {
  slot: number;
}

export interface ChatPayload {
  text: string;
}

export interface CreateRoomPayload {
  config: Partial<RoomConfig>;
}

// ── server -> client JSON payloads ──────────────────────────────────────────

export interface WelcomePayload {
  protocol: number;
  playerId: PlayerId;
  /** Authenticated profile, or null for guests. */
  profile: { id: string; username: string; avatarUrl: string | null } | null;
      room: {
        id: string;
        name: string;
        mapId: string;
        mode: GameModeId;
        maxPlayers: number;
        joinCode?: string;
        host?: boolean;
        /** Public websocket for invite links (tunnel or dedicated host). */
        wsUrl?: string;
        phase: RoomPhaseId;
      };
  tickRate: number;
  snapshotRate: number;
  serverTimeMs: number;
  players: PlayerIdentity[];
  scores: PlayerScore[];
  loadout: WeaponId[];
  /** Doors that start open, and pickups already consumed. */
  worldState: {
    doorsOpen: string[];
    switchesOn: string[];
    pickupsTaken: string[];
  };
}

export interface RosterPayload {
  players: PlayerIdentity[];
  scores: PlayerScore[];
  matchEndsAt: number;
  phase?: RoomPhaseId;
  joinCode?: string;
  hostPlayerId?: number | null;
}

export interface LobbyStatePayload {
  phase: RoomPhaseId;
  joinCode: string;
  hostPlayerId: number | null;
  mapId: string;
  name: string;
  maxPlayers: number;
  players: PlayerIdentity[];
}

export interface StartMatchPayload {
  /** Reserved; start is implicit. */
  confirm?: boolean;
}

export interface EventsPayload {
  tick: number;
  events: GameEvent[];
}

export interface ErrorPayload {
  code: string;
  message: string;
  fatal: boolean;
}

export interface RoomListPayload {
  rooms: RoomSummary[];
}

export interface KickedPayload {
  reason: string;
}

/** Bumped whenever the wire format changes incompatibly. */
export const PROTOCOL_VERSION = 1;

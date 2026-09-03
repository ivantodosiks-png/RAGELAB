import type { Vec3 } from '../math';
import type { WeaponId } from './weapons';

/** Network id of a player inside a room (not the Supabase account id). */
export type PlayerId = number;

/** Bit flags packed into a single byte in snapshots. */
export const PlayerFlag = {
  Grounded: 1 << 0,
  Crouching: 1 << 1,
  Sprinting: 1 << 2,
  Firing: 1 << 3,
  Reloading: 1 << 4,
  Dead: 1 << 5,
  Aiming: 1 << 6,
  Carrying: 1 << 7,
} as const;
export type PlayerFlagKey = keyof typeof PlayerFlag;

export const AnimationState = {
  Idle: 0,
  Walk: 1,
  Run: 2,
  CrouchIdle: 3,
  CrouchWalk: 4,
  Jump: 5,
  Fall: 6,
  Dead: 7,
} as const;
export type AnimationStateId = (typeof AnimationState)[keyof typeof AnimationState];

/** The replicated part of a player. Everything here can be sent to clients. */
export interface PlayerSnapshotState {
  id: PlayerId;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  flags: number;
  health: number;
  weapon: WeaponId;
  ammoInMag: number;
  ammoReserve: number;
}

/** Slow-changing player metadata, sent on join / via roster updates. */
export interface PlayerIdentity {
  id: PlayerId;
  /** Supabase profile id, or null for guests. */
  profileId: string | null;
  username: string;
  avatarUrl: string | null;
  isGuest: boolean;
  team: number;
}

export interface PlayerScore {
  id: PlayerId;
  kills: number;
  deaths: number;
  score: number;
  pingMs: number;
}

export function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) !== 0;
}

export function animationStateFor(state: {
  flags: number;
  velocity: Vec3;
}): AnimationStateId {
  if (hasFlag(state.flags, PlayerFlag.Dead)) return AnimationState.Dead;
  const speed = Math.hypot(state.velocity.x, state.velocity.z);
  if (!hasFlag(state.flags, PlayerFlag.Grounded)) {
    return state.velocity.y > 0.5 ? AnimationState.Jump : AnimationState.Fall;
  }
  if (hasFlag(state.flags, PlayerFlag.Crouching)) {
    return speed > 0.4 ? AnimationState.CrouchWalk : AnimationState.CrouchIdle;
  }
  if (speed > 6.2) return AnimationState.Run;
  if (speed > 0.4) return AnimationState.Walk;
  return AnimationState.Idle;
}

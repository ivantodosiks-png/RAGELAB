import type { PlayerId } from './player';
import type { WeaponId } from './weapons';
import type { SurfaceId } from './map';

/**
 * Discrete, low-frequency things that happened during a tick. Batched into one
 * JSON message per snapshot so the client can drive effects, audio and UI.
 */
export type GameEvent =
  | {
      t: 'shot';
      /** Shooter. */
      p: PlayerId;
      w: WeaponId;
      /** Muzzle origin. */
      o: [number, number, number];
      /** Per-pellet directions (already spread-resolved by the server). */
      d: [number, number, number][];
      /** Hit distance per pellet, for tracer length. */
      l: number[];
    }
  | {
      t: 'impact';
      pos: [number, number, number];
      n: [number, number, number];
      s: SurfaceId;
      /** Impact strength 0..1, drives particle count. */
      f: number;
    }
  | {
      t: 'hit';
      /** Who got hit (only sent to the shooter). */
      target: PlayerId;
      dmg: number;
      head: boolean;
      lethal: boolean;
    }
  | {
      t: 'blood';
      pos: [number, number, number];
      n: [number, number, number];
    }
  | {
      t: 'damaged';
      amount: number;
      /** Direction the damage came from, for the directional indicator. */
      from: [number, number, number];
      health: number;
    }
  | {
      t: 'kill';
      killer: PlayerId | null;
      victim: PlayerId;
      w: WeaponId | 'fall' | 'explosion' | 'void' | 'crush';
      head: boolean;
    }
  | {
      t: 'death';
      victim: PlayerId;
      pos: [number, number, number];
      respawnAt: number;
    }
  | {
      t: 'respawn';
      p: PlayerId;
      pos: [number, number, number];
      yaw: number;
    }
  | { t: 'reload'; p: PlayerId; w: WeaponId; ms: number }
  | { t: 'equip'; p: PlayerId; w: WeaponId }
  | {
      t: 'explosion';
      pos: [number, number, number];
      radius: number;
    }
  | {
      t: 'propBreak';
      id: number;
      pos: [number, number, number];
      kind: string;
    }
  | { t: 'door'; id: string; open: boolean }
  | { t: 'switch'; id: string; on: boolean }
  | {
      t: 'pickup';
      id: string;
      p: PlayerId;
      kind: string;
      value: string;
      /** Server time the pickup respawns; 0 if permanent. */
      respawnAt: number;
    }
  | { t: 'pickupRespawn'; id: string }
  | { t: 'carry'; p: PlayerId; prop: number | null }
  | { t: 'jump'; p: PlayerId; pos: [number, number, number] }
  | {
      t: 'land';
      p: PlayerId;
      pos: [number, number, number];
      /** Impact speed, drives landing sound volume. */
      v: number;
    }
  | { t: 'chat'; p: PlayerId; name: string; msg: string }
  | { t: 'join'; p: PlayerId; name: string }
  | { t: 'leave'; p: PlayerId; name: string }
  | { t: 'matchEnd'; winner: PlayerId | null }
  | { t: 'matchStart' };

export type GameEventType = GameEvent['t'];

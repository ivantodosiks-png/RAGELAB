import {
  ANTICHEAT_MAX_DT_MS,
  ANTICHEAT_MAX_POSITION_DESYNC,
  ANTICHEAT_MIN_DT_MS,
  ANTICHEAT_SPEED_TOLERANCE,
  ANTICHEAT_VIOLATION_KICK_THRESHOLD,
  MAX_CHAT_LENGTH,
  SPEED_SPRINT,
  WORLD_BOUNDS_XZ,
  WORLD_CEILING_Y,
  WORLD_FLOOR_Y,
  type InputCommand,
} from '@ragelab/shared';
import { log } from '../logger';
import type { PlayerEntity } from '../game/playerEntity';

export const Violation = {
  BadInput: 'bad_input',
  ImpossibleSpeed: 'impossible_speed',
  OutOfBounds: 'out_of_bounds',
  PositionDesync: 'position_desync',
  FireRate: 'fire_rate',
  NoAmmo: 'no_ammo',
  BadWeaponSlot: 'bad_weapon_slot',
  InputFlood: 'input_flood',
  SequenceReplay: 'sequence_replay',
} as const;
export type ViolationId = (typeof Violation)[keyof typeof Violation];

/** Weight per violation kind; the sum is what triggers a kick. */
const WEIGHTS: Record<ViolationId, number> = {
  bad_input: 2,
  impossible_speed: 4,
  out_of_bounds: 6,
  position_desync: 1,
  fire_rate: 5,
  no_ammo: 5,
  bad_weapon_slot: 1,
  input_flood: 3,
  sequence_replay: 2,
};

export interface ViolationReport {
  kind: ViolationId;
  detail?: Record<string, unknown>;
}

/**
 * Records a violation and returns true when the player has crossed the kick
 * threshold. Violations decay over time so a laggy client is not punished for
 * an occasional hiccup.
 */
export function flagViolation(
  player: PlayerEntity,
  report: ViolationReport,
  nowMs: number,
): boolean {
  player.violations += WEIGHTS[report.kind] ?? 1;
  log.debug('anti-cheat violation', {
    player: player.id,
    username: player.identity.username,
    kind: report.kind,
    score: player.violations,
    ...report.detail,
  });
  if (player.violations >= ANTICHEAT_VIOLATION_KICK_THRESHOLD) {
    log.warn('anti-cheat kick', {
      player: player.id,
      username: player.identity.username,
      score: player.violations,
      lastKind: report.kind,
      nowMs,
    });
    return true;
  }
  return false;
}

/** Violation score bleeds off at ~2 points per second of clean play. */
export function decayViolations(player: PlayerEntity, dtSec: number): void {
  if (player.violations <= 0) return;
  player.violations = Math.max(0, player.violations - 2 * dtSec);
}

/**
 * Structural validation of a single input command. Rejected commands are
 * dropped rather than clamped, so a malicious client cannot use a malformed
 * packet to gain anything.
 */
export function validateInputCommand(
  command: InputCommand,
  player: PlayerEntity,
): ViolationId | null {
  if (!Number.isFinite(command.seq) || command.seq < 0) return Violation.BadInput;
  if (!Number.isFinite(command.dtMs)) return Violation.BadInput;
  if (command.dtMs < ANTICHEAT_MIN_DT_MS || command.dtMs > ANTICHEAT_MAX_DT_MS) {
    return Violation.BadInput;
  }
  if (!Number.isFinite(command.moveX) || !Number.isFinite(command.moveZ)) {
    return Violation.BadInput;
  }
  if (Math.abs(command.moveX) > 1.05 || Math.abs(command.moveZ) > 1.05) {
    return Violation.BadInput;
  }
  if (!Number.isFinite(command.yaw) || !Number.isFinite(command.pitch)) {
    return Violation.BadInput;
  }
  if (Math.abs(command.pitch) > Math.PI / 2 + 0.02) return Violation.BadInput;
  if (command.weaponSlot < 0 || command.weaponSlot > 15) return Violation.BadWeaponSlot;
  if (command.seq <= player.lastProcessedSeq) return Violation.SequenceReplay;
  return null;
}

/**
 * Post-movement sanity check. The server already owns the position, so this is
 * about catching a client that feeds inputs designed to exploit the movement
 * code rather than about correcting positions.
 */
export function validateMovementResult(
  player: PlayerEntity,
  dtSec: number,
  maxSpeed: number,
): ViolationId | null {
  const p = player.movement.position;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
    return Violation.BadInput;
  }
  if (
    Math.abs(p.x) > WORLD_BOUNDS_XZ ||
    Math.abs(p.z) > WORLD_BOUNDS_XZ ||
    p.y > WORLD_CEILING_Y ||
    p.y < WORLD_FLOOR_Y
  ) {
    return Violation.OutOfBounds;
  }

  const horizontal = Math.hypot(player.movement.velocity.x, player.movement.velocity.z);
  const ceiling = Math.max(maxSpeed, SPEED_SPRINT) * ANTICHEAT_SPEED_TOLERANCE + 8;
  if (horizontal > ceiling && dtSec > 0) return Violation.ImpossibleSpeed;

  return null;
}

/**
 * Compare the client's own idea of where it is against ours. Purely
 * informational: the server never accepts the client position, but a large
 * persistent gap is a strong cheat signal.
 */
export function checkPositionDesync(
  player: PlayerEntity,
  clientX: number,
  clientY: number,
  clientZ: number,
): ViolationId | null {
  const p = player.movement.position;
  const d = Math.hypot(clientX - p.x, clientY - p.y, clientZ - p.z);
  return d > ANTICHEAT_MAX_POSITION_DESYNC ? Violation.PositionDesync : null;
}

export function sanitizeChat(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_CHAT_LENGTH);
}

export function sanitizeUsername(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const cleaned = name.replace(/[^A-Za-z0-9_ -]/g, '').trim();
  if (cleaned.length < 3) return null;
  return cleaned.slice(0, 20);
}

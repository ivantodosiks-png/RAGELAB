import {
  INTERPOLATION_DELAY_MS,
  LAG_COMP_HISTORY_TICKS,
  LAG_COMP_MAX_REWIND_MS,
  clamp,
  type Vec3,
} from '@ragelab/shared';

interface HistoryFrame {
  tick: number;
  timeMs: number;
  /** playerId -> pose */
  poses: Map<number, { x: number; y: number; z: number; crouching: boolean; alive: boolean }>;
}

export interface RewoundPose {
  position: Vec3;
  crouching: boolean;
  alive: boolean;
}

/**
 * Ring buffer of past player poses. When a shot arrives we rewind every other
 * player to where the shooter actually saw them, which is what makes hitscan
 * feel correct at 100+ ms of latency.
 */
export class LagCompensator {
  private readonly frames: HistoryFrame[] = [];
  private cursor = 0;

  constructor(private readonly capacity = LAG_COMP_HISTORY_TICKS) {
    for (let i = 0; i < capacity; i++) {
      this.frames.push({ tick: -1, timeMs: -1, poses: new Map() });
    }
  }

  /** Record the authoritative poses for this tick. */
  record(
    tick: number,
    timeMs: number,
    players: Iterable<{
      id: number;
      movement: { position: Vec3; crouching: boolean };
      alive: boolean;
    }>,
  ): void {
    const frame = this.frames[this.cursor]!;
    frame.tick = tick;
    frame.timeMs = timeMs;
    frame.poses.clear();
    for (const p of players) {
      frame.poses.set(p.id, {
        x: p.movement.position.x,
        y: p.movement.position.y,
        z: p.movement.position.z,
        crouching: p.movement.crouching,
        alive: p.alive,
      });
    }
    this.cursor = (this.cursor + 1) % this.capacity;
  }

  /**
   * How far back to rewind for a given shooter. Half the round trip gets the
   * shot back to when it was sent; the interpolation delay accounts for the
   * client rendering remote players in the past.
   */
  rewindMsFor(pingMs: number): number {
    return clamp(pingMs * 0.5 + INTERPOLATION_DELAY_MS, 0, LAG_COMP_MAX_REWIND_MS);
  }

  /**
   * Interpolated pose of `playerId` at `timeMs`. Falls back to null when the
   * requested time is outside the recorded window.
   */
  sample(playerId: number, timeMs: number, out: RewoundPose): boolean {
    let before: HistoryFrame | null = null;
    let after: HistoryFrame | null = null;

    for (const frame of this.frames) {
      if (frame.tick < 0 || !frame.poses.has(playerId)) continue;
      if (frame.timeMs <= timeMs) {
        if (!before || frame.timeMs > before.timeMs) before = frame;
      }
      if (frame.timeMs >= timeMs) {
        if (!after || frame.timeMs < after.timeMs) after = frame;
      }
    }

    if (!before && !after) return false;
    if (!before) before = after!;
    if (!after) after = before;

    const a = before.poses.get(playerId)!;
    const b = after.poses.get(playerId)!;
    const span = after.timeMs - before.timeMs;
    const t = span > 1e-6 ? clamp((timeMs - before.timeMs) / span, 0, 1) : 0;

    out.position.x = a.x + (b.x - a.x) * t;
    out.position.y = a.y + (b.y - a.y) * t;
    out.position.z = a.z + (b.z - a.z) * t;
    out.crouching = t < 0.5 ? a.crouching : b.crouching;
    out.alive = a.alive || b.alive;
    return true;
  }

  clear(): void {
    for (const frame of this.frames) {
      frame.tick = -1;
      frame.timeMs = -1;
      frame.poses.clear();
    }
    this.cursor = 0;
  }
}

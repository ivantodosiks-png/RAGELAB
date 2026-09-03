import {
  INTERPOLATION_DELAY_MS,
  dqAngle,
  dqPos,
  dqQuat,
  dqVel,
  lerp,
  lerpAngle,
  type PlayerId,
  type Quat,
  type Vec3,
  type WorldSnapshot,
} from '@ragelab/shared';

export interface InterpolatedPlayer {
  id: PlayerId;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  flags: number;
  health: number;
  weapon: number;
  mag: number;
  reserve: number;
}

export interface InterpolatedProp {
  id: number;
  position: Vec3;
  rotation: Quat;
}

interface Sample {
  snapshot: WorldSnapshot;
  /** Local clock time (performance.now) at which this snapshot was received. */
  receivedAt: number;
}

const BUFFER_LIMIT = 32;

/**
 * Holds a short history of snapshots and reconstructs the world as it looked
 * `INTERPOLATION_DELAY_MS` ago. Remote players and props are rendered from
 * this, which trades a fixed sliver of latency for perfectly smooth motion.
 */
export class SnapshotInterpolator {
  private readonly buffer: Sample[] = [];

  readonly players = new Map<PlayerId, InterpolatedPlayer>();
  readonly props = new Map<number, InterpolatedProp>();
  readonly doors: number[] = [];

  /** Ids present in the newest snapshot; used to prune renderers. */
  readonly livePlayerIds = new Set<PlayerId>();
  readonly livePropIds = new Set<number>();

  /** How far behind the newest snapshot we are currently rendering. */
  renderDelayMs = INTERPOLATION_DELAY_MS;

  push(snapshot: WorldSnapshot, receivedAt: number): void {
    this.buffer.push({ snapshot, receivedAt });
    if (this.buffer.length > BUFFER_LIMIT) this.buffer.shift();
  }

  reset(): void {
    this.buffer.length = 0;
    this.players.clear();
    this.props.clear();
    this.doors.length = 0;
    this.livePlayerIds.clear();
    this.livePropIds.clear();
  }

  get latest(): WorldSnapshot | null {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1]!.snapshot : null;
  }

  /**
   * @param nowMs local clock (performance.now)
   * @param excludeId local player id, rendered from prediction instead
   */
  sample(nowMs: number, excludeId: PlayerId | null): void {
    if (this.buffer.length === 0) return;

    const renderTime = nowMs - this.renderDelayMs;

    // Find the pair of samples that bracket renderTime, walking from the back
    // because it is almost always the last two.
    let older: Sample | null = null;
    let newer: Sample | null = null;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const sample = this.buffer[i]!;
      if (sample.receivedAt <= renderTime) {
        older = sample;
        newer = this.buffer[i + 1] ?? null;
        break;
      }
    }

    if (!older) {
      // Render time is older than everything we have (just connected or a big
      // hitch): snap to the oldest sample rather than extrapolating wildly.
      older = this.buffer[0]!;
      newer = this.buffer[1] ?? null;
    }

    let alpha = 0;
    if (newer) {
      const span = newer.receivedAt - older.receivedAt;
      alpha = span > 0.001 ? Math.min(1, Math.max(0, (renderTime - older.receivedAt) / span)) : 0;
    }

    const from = older.snapshot;
    const to = newer ? newer.snapshot : older.snapshot;

    // Drop samples we will never need again, keeping one before `older`.
    const cutoff = this.buffer.indexOf(older) - 1;
    if (cutoff > 0) this.buffer.splice(0, cutoff);

    this.applyPlayers(from, to, alpha, excludeId);
    this.applyProps(from, to, alpha);
    this.applyDoors(from, to, alpha);
  }

  private applyPlayers(
    from: WorldSnapshot,
    to: WorldSnapshot,
    alpha: number,
    excludeId: PlayerId | null,
  ): void {
    this.livePlayerIds.clear();

    for (const [id, target] of to.players) {
      if (id === excludeId) continue;
      this.livePlayerIds.add(id);

      let entry = this.players.get(id);
      if (!entry) {
        entry = {
          id,
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          yaw: 0,
          pitch: 0,
          flags: 0,
          health: 100,
          weapon: 0,
          mag: 0,
          reserve: 0,
        };
        this.players.set(id, entry);
      }

      const start = from.players.get(id) ?? target;
      entry.position.x = lerp(dqPos(start.px), dqPos(target.px), alpha);
      entry.position.y = lerp(dqPos(start.py), dqPos(target.py), alpha);
      entry.position.z = lerp(dqPos(start.pz), dqPos(target.pz), alpha);
      entry.velocity.x = lerp(dqVel(start.vx), dqVel(target.vx), alpha);
      entry.velocity.y = lerp(dqVel(start.vy), dqVel(target.vy), alpha);
      entry.velocity.z = lerp(dqVel(start.vz), dqVel(target.vz), alpha);
      entry.yaw = lerpAngle(dqAngle(start.yaw), dqAngle(target.yaw), alpha);
      entry.pitch = lerp(dqAngle(start.pitch), dqAngle(target.pitch), alpha);
      // Discrete state always comes from the newer sample: interpolating a
      // health value or a "dead" flag makes no sense.
      entry.flags = target.flags;
      entry.health = target.health;
      entry.weapon = target.weapon;
      entry.mag = target.mag;
      entry.reserve = target.reserve;
    }

    for (const id of [...this.players.keys()]) {
      if (!this.livePlayerIds.has(id)) this.players.delete(id);
    }
  }

  private applyProps(from: WorldSnapshot, to: WorldSnapshot, alpha: number): void {
    this.livePropIds.clear();

    for (const [id, target] of to.props) {
      this.livePropIds.add(id);
      let entry = this.props.get(id);
      if (!entry) {
        entry = {
          id,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        };
        this.props.set(id, entry);
      }
      const start = from.props.get(id) ?? target;
      entry.position.x = lerp(dqPos(start.px), dqPos(target.px), alpha);
      entry.position.y = lerp(dqPos(start.py), dqPos(target.py), alpha);
      entry.position.z = lerp(dqPos(start.pz), dqPos(target.pz), alpha);
      slerpQuantQuat(entry.rotation, start, target, alpha);
    }

    for (const id of [...this.props.keys()]) {
      if (!this.livePropIds.has(id)) this.props.delete(id);
    }
  }

  private applyDoors(from: WorldSnapshot, to: WorldSnapshot, alpha: number): void {
    this.doors.length = to.doors.length;
    for (let i = 0; i < to.doors.length; i++) {
      const a = from.doors[i] ?? to.doors[i]!;
      this.doors[i] = lerp(a, to.doors[i]!, alpha) / 255;
    }
  }
}

const TMP_A: Quat = { x: 0, y: 0, z: 0, w: 1 };
const TMP_B: Quat = { x: 0, y: 0, z: 0, w: 1 };

interface QuantRotation {
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

/** Normalized-lerp of two quantized quaternions; close enough at 20 Hz. */
function slerpQuantQuat(out: Quat, a: QuantRotation, b: QuantRotation, t: number): void {
  TMP_A.x = dqQuat(a.qx);
  TMP_A.y = dqQuat(a.qy);
  TMP_A.z = dqQuat(a.qz);
  TMP_A.w = dqQuat(a.qw);
  TMP_B.x = dqQuat(b.qx);
  TMP_B.y = dqQuat(b.qy);
  TMP_B.z = dqQuat(b.qz);
  TMP_B.w = dqQuat(b.qw);

  // Take the shorter arc.
  const dot = TMP_A.x * TMP_B.x + TMP_A.y * TMP_B.y + TMP_A.z * TMP_B.z + TMP_A.w * TMP_B.w;
  const sign = dot < 0 ? -1 : 1;

  out.x = TMP_A.x + (TMP_B.x * sign - TMP_A.x) * t;
  out.y = TMP_A.y + (TMP_B.y * sign - TMP_A.y) * t;
  out.z = TMP_A.z + (TMP_B.z * sign - TMP_A.z) * t;
  out.w = TMP_A.w + (TMP_B.w * sign - TMP_A.w) * t;
  const len = Math.hypot(out.x, out.y, out.z, out.w) || 1;
  out.x /= len;
  out.y /= len;
  out.z /= len;
  out.w /= len;
}
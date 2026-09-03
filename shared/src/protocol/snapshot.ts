import { ANGLE_SCALE, POS_SCALE, QUAT_SCALE, VEL_SCALE } from '../constants';
import type { Vec3, Quat } from '../math';
import { ByteReader, ByteWriter, clampI16, clampU16, clampU8 } from './bytes';
import { Op } from './opcodes';

/**
 * Snapshots are stored in *quantized integer* form so that delta comparison is
 * exact and encoding is a straight write. Dequantization happens only in the
 * client interpolator.
 */
export interface QuantPlayer {
  id: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  flags: number;
  health: number;
  weapon: number;
  mag: number;
  reserve: number;
}

export interface QuantProp {
  id: number;
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface WorldSnapshot {
  tick: number;
  timeMs: number;
  /** Last input sequence the server processed for the receiving client. */
  ackSeq: number;
  players: Map<number, QuantPlayer>;
  props: Map<number, QuantProp>;
  /** Door open progress 0..255, indexed by door order in the map definition. */
  doors: number[];
}

const PF = {
  Pos: 1 << 0,
  Vel: 1 << 1,
  Ang: 1 << 2,
  Flags: 1 << 3,
  Health: 1 << 4,
  Ammo: 1 << 5,
  Removed: 1 << 6,
  New: 1 << 7,
} as const;

const PROPF = {
  Pos: 1 << 0,
  Rot: 1 << 1,
  Removed: 1 << 2,
  New: 1 << 3,
} as const;

const HEADER_FULL = 1 << 0;

// ── quantization helpers ────────────────────────────────────────────────────
export function qPos(v: number): number {
  return clampI16(Math.round(v * POS_SCALE));
}
export function dqPos(v: number): number {
  return v / POS_SCALE;
}
export function qVel(v: number): number {
  return clampI16(Math.round(v * VEL_SCALE));
}
export function dqVel(v: number): number {
  return v / VEL_SCALE;
}
export function qAngle(v: number): number {
  return clampI16(Math.round(v * ANGLE_SCALE));
}
export function dqAngle(v: number): number {
  return v / ANGLE_SCALE;
}
export function qQuat(v: number): number {
  return clampI16(Math.round(v * QUAT_SCALE));
}
export function dqQuat(v: number): number {
  return v / QUAT_SCALE;
}

export function dequantPosition(out: Vec3, p: QuantPlayer | QuantProp): Vec3 {
  out.x = p.px / POS_SCALE;
  out.y = p.py / POS_SCALE;
  out.z = p.pz / POS_SCALE;
  return out;
}

export function dequantQuat(out: Quat, p: QuantProp): Quat {
  out.x = p.qx / QUAT_SCALE;
  out.y = p.qy / QUAT_SCALE;
  out.z = p.qz / QUAT_SCALE;
  out.w = p.qw / QUAT_SCALE;
  const len = Math.hypot(out.x, out.y, out.z, out.w) || 1;
  out.x /= len;
  out.y /= len;
  out.z /= len;
  out.w /= len;
  return out;
}

export function createEmptySnapshot(): WorldSnapshot {
  return { tick: 0, timeMs: 0, ackSeq: 0, players: new Map(), props: new Map(), doors: [] };
}

export interface EncodeOptions {
  /** Ids this client is allowed to see this frame (interest management). */
  visiblePlayers: Set<number>;
  visibleProps: Set<number>;
  /** Ids sent in the previous snapshot to this client. */
  previousPlayers: Set<number>;
  previousProps: Set<number>;
  /** The exact snapshot we last sent this client, or null for a full update. */
  baseline: WorldSnapshot | null;
  /** Last input sequence processed for this client. */
  ackSeq: number;
}

/**
 * Delta-encode `current` against `options.baseline`. WebSocket is reliable and
 * ordered, so the previously sent snapshot is always a valid baseline.
 */
export function encodeSnapshot(
  current: WorldSnapshot,
  options: EncodeOptions,
  writer?: ByteWriter,
): Uint8Array {
  const w = writer ?? new ByteWriter(2048);
  w.reset();
  const baseline = options.baseline;

  w.u8(Op.Snapshot);
  w.u8(baseline ? 0 : HEADER_FULL);
  w.u32(current.tick >>> 0);
  w.u32(current.timeMs >>> 0);
  w.u32(options.ackSeq >>> 0);
  w.u32(baseline ? baseline.tick >>> 0 : 0);

  // ── players ──
  const playerIds: number[] = [];
  for (const id of options.visiblePlayers) playerIds.push(id);
  const removedPlayers: number[] = [];
  for (const id of options.previousPlayers) {
    if (!options.visiblePlayers.has(id)) removedPlayers.push(id);
  }

  w.u8(clampU8(playerIds.length + removedPlayers.length));

  for (const id of playerIds) {
    const cur = current.players.get(id)!;
    const base = baseline && options.previousPlayers.has(id) ? baseline.players.get(id) : undefined;
    let mask = 0;
    if (!base) {
      mask = PF.New | PF.Pos | PF.Vel | PF.Ang | PF.Flags | PF.Health | PF.Ammo;
    } else {
      if (cur.px !== base.px || cur.py !== base.py || cur.pz !== base.pz) mask |= PF.Pos;
      if (cur.vx !== base.vx || cur.vy !== base.vy || cur.vz !== base.vz) mask |= PF.Vel;
      if (cur.yaw !== base.yaw || cur.pitch !== base.pitch) mask |= PF.Ang;
      if (cur.flags !== base.flags) mask |= PF.Flags;
      if (cur.health !== base.health) mask |= PF.Health;
      if (cur.weapon !== base.weapon || cur.mag !== base.mag || cur.reserve !== base.reserve) {
        mask |= PF.Ammo;
      }
    }
    w.u16(id);
    w.u8(mask);
    if (mask & PF.Pos) {
      w.i16(cur.px);
      w.i16(cur.py);
      w.i16(cur.pz);
    }
    if (mask & PF.Vel) {
      w.i16(cur.vx);
      w.i16(cur.vy);
      w.i16(cur.vz);
    }
    if (mask & PF.Ang) {
      w.i16(cur.yaw);
      w.i16(cur.pitch);
    }
    if (mask & PF.Flags) w.u8(cur.flags);
    if (mask & PF.Health) w.u8(clampU8(cur.health));
    if (mask & PF.Ammo) {
      w.u8(cur.weapon);
      w.u8(clampU8(cur.mag));
      w.u16(clampU16(cur.reserve));
    }
  }
  for (const id of removedPlayers) {
    w.u16(id);
    w.u8(PF.Removed);
  }

  // ── props ──
  const propIds: number[] = [];
  for (const id of options.visibleProps) propIds.push(id);
  const removedProps: number[] = [];
  for (const id of options.previousProps) {
    if (!options.visibleProps.has(id)) removedProps.push(id);
  }

  const propEntries: Array<[number, number]> = [];
  for (const id of propIds) {
    const cur = current.props.get(id)!;
    const base = baseline && options.previousProps.has(id) ? baseline.props.get(id) : undefined;
    let mask = 0;
    if (!base) {
      mask = PROPF.New | PROPF.Pos | PROPF.Rot;
    } else {
      if (cur.px !== base.px || cur.py !== base.py || cur.pz !== base.pz) mask |= PROPF.Pos;
      if (
        cur.qx !== base.qx ||
        cur.qy !== base.qy ||
        cur.qz !== base.qz ||
        cur.qw !== base.qw
      ) {
        mask |= PROPF.Rot;
      }
    }
    if (mask !== 0) propEntries.push([id, mask]);
  }

  w.u16(clampU16(propEntries.length + removedProps.length));
  for (const [id, mask] of propEntries) {
    const cur = current.props.get(id)!;
    w.u16(id);
    w.u8(mask);
    if (mask & PROPF.Pos) {
      w.i16(cur.px);
      w.i16(cur.py);
      w.i16(cur.pz);
    }
    if (mask & PROPF.Rot) {
      w.i16(cur.qx);
      w.i16(cur.qy);
      w.i16(cur.qz);
      w.i16(cur.qw);
    }
  }
  for (const id of removedProps) {
    w.u16(id);
    w.u8(PROPF.Removed);
  }

  // ── doors ──
  const doorChanges: Array<[number, number]> = [];
  for (let i = 0; i < current.doors.length; i++) {
    const cur = current.doors[i]!;
    const base = baseline?.doors[i];
    if (base === undefined || base !== cur) doorChanges.push([i, cur]);
  }
  w.u8(clampU8(doorChanges.length));
  for (const [i, v] of doorChanges) {
    w.u8(i);
    w.u8(v);
  }

  return w.toUint8Array();
}

/**
 * Apply a delta snapshot on top of `baseline`, returning a fresh snapshot.
 * Entities not mentioned in the packet are carried over unchanged.
 */
export function decodeSnapshot(data: Uint8Array, baseline: WorldSnapshot | null): WorldSnapshot {
  const r = new ByteReader(data);
  r.u8(); // opcode
  const headerFlags = r.u8();
  const tick = r.u32();
  const timeMs = r.u32();
  const ackSeq = r.u32();
  r.u32(); // baseline tick (diagnostic only over a reliable transport)

  const isFull = (headerFlags & HEADER_FULL) !== 0;
  const base = isFull ? null : baseline;

  const players = new Map<number, QuantPlayer>();
  const props = new Map<number, QuantProp>();
  const doors: number[] = base ? base.doors.slice() : [];

  if (base) {
    for (const [id, p] of base.players) players.set(id, { ...p });
    for (const [id, p] of base.props) props.set(id, { ...p });
  }

  const playerCount = r.u8();
  for (let i = 0; i < playerCount; i++) {
    const id = r.u16();
    const mask = r.u8();
    if (mask & PF.Removed) {
      players.delete(id);
      continue;
    }
    let p = players.get(id);
    if (!p || mask & PF.New) {
      p = {
        id,
        px: 0,
        py: 0,
        pz: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        yaw: 0,
        pitch: 0,
        flags: 0,
        health: 100,
        weapon: 0,
        mag: 0,
        reserve: 0,
      };
      players.set(id, p);
    }
    if (mask & PF.Pos) {
      p.px = r.i16();
      p.py = r.i16();
      p.pz = r.i16();
    }
    if (mask & PF.Vel) {
      p.vx = r.i16();
      p.vy = r.i16();
      p.vz = r.i16();
    }
    if (mask & PF.Ang) {
      p.yaw = r.i16();
      p.pitch = r.i16();
    }
    if (mask & PF.Flags) p.flags = r.u8();
    if (mask & PF.Health) p.health = r.u8();
    if (mask & PF.Ammo) {
      p.weapon = r.u8();
      p.mag = r.u8();
      p.reserve = r.u16();
    }
  }

  const propCount = r.u16();
  for (let i = 0; i < propCount; i++) {
    const id = r.u16();
    const mask = r.u8();
    if (mask & PROPF.Removed) {
      props.delete(id);
      continue;
    }
    let p = props.get(id);
    if (!p || mask & PROPF.New) {
      p = { id, px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: QUAT_SCALE };
      props.set(id, p);
    }
    if (mask & PROPF.Pos) {
      p.px = r.i16();
      p.py = r.i16();
      p.pz = r.i16();
    }
    if (mask & PROPF.Rot) {
      p.qx = r.i16();
      p.qy = r.i16();
      p.qz = r.i16();
      p.qw = r.i16();
    }
  }

  const doorCount = r.u8();
  for (let i = 0; i < doorCount; i++) {
    const index = r.u8();
    const value = r.u8();
    doors[index] = value;
  }

  return { tick, timeMs, ackSeq, players, props, doors };
}

export function decodePong(data: Uint8Array): { clientTimeMs: number; serverTimeMs: number } {
  const r = new ByteReader(data);
  r.u8();
  return { clientTimeMs: r.u32(), serverTimeMs: r.u32() };
}

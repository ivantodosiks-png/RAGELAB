import {
  ANTICHEAT_MAX_DT_MS,
  ANTICHEAT_MIN_DT_MS,
  ANGLE_SCALE,
  MAX_INPUTS_PER_PACKET,
} from '../constants';
import { clamp } from '../math';
import type { InputCommand, InputPacket } from '../types/input';
import { ByteReader, ByteWriter, clampI16 } from './bytes';
import { Op } from './opcodes';

/**
 * Input packet layout:
 *   u8  op
 *   u32 ackSnapshotTick
 *   u8  count
 *   per command (13 bytes):
 *     u32 seq
 *     u8  dtMs
 *     i8  moveX  (-100..100)
 *     i8  moveZ  (-100..100)
 *     i16 yaw
 *     i16 pitch
 *     u16 buttons
 *     u8  weaponSlot
 */
const COMMAND_BYTES = 13;

export function encodeInputPacket(packet: InputPacket, writer?: ByteWriter): Uint8Array {
  const w = writer ?? new ByteWriter(8 + MAX_INPUTS_PER_PACKET * COMMAND_BYTES);
  w.reset();
  const count = Math.min(packet.commands.length, MAX_INPUTS_PER_PACKET);
  w.u8(Op.Input);
  w.u32(packet.ackSnapshotTick >>> 0);
  w.u8(count);
  for (let i = packet.commands.length - count; i < packet.commands.length; i++) {
    const c = packet.commands[i]!;
    w.u32(c.seq >>> 0);
    w.u8(clamp(Math.round(c.dtMs), ANTICHEAT_MIN_DT_MS, ANTICHEAT_MAX_DT_MS));
    w.i8(Math.round(clamp(c.moveX, -1, 1) * 100));
    w.i8(Math.round(clamp(c.moveZ, -1, 1) * 100));
    w.i16(clampI16(Math.round(c.yaw * ANGLE_SCALE)));
    w.i16(clampI16(Math.round(c.pitch * ANGLE_SCALE)));
    w.u16(c.buttons & 0xffff);
    w.u8(c.weaponSlot & 0xff);
  }
  return w.toUint8Array();
}

export function decodeInputPacket(data: Uint8Array): InputPacket {
  const r = new ByteReader(data);
  r.u8(); // opcode, already dispatched on
  const ackSnapshotTick = r.u32();
  const count = r.u8();
  if (count > MAX_INPUTS_PER_PACKET) {
    throw new RangeError(`Input packet declares ${count} commands (max ${MAX_INPUTS_PER_PACKET})`);
  }
  const commands: InputCommand[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const seq = r.u32();
    const dtMs = r.u8();
    const moveX = r.i8() / 100;
    const moveZ = r.i8() / 100;
    const yaw = r.i16() / ANGLE_SCALE;
    const pitch = r.i16() / ANGLE_SCALE;
    const buttons = r.u16();
    const weaponSlot = r.u8();
    commands[i] = { seq, dtMs, moveX, moveZ, yaw, pitch, buttons, weaponSlot };
  }
  return { ackSnapshotTick, commands };
}

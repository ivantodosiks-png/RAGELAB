import { ByteWriter } from './bytes';
import type { OpCode } from './opcodes';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

/** Pack an opcode byte followed by a UTF-8 JSON body. */
export function encodeJson(op: OpCode, payload: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(payload));
  const out = new Uint8Array(1 + body.byteLength);
  out[0] = op;
  out.set(body, 1);
  return out;
}

/** Read the JSON body of a packet whose first byte is the opcode. */
export function decodeJsonBody<T>(data: Uint8Array): T {
  const text = decoder.decode(data.subarray(1));
  return JSON.parse(text) as T;
}

export function encodePing(op: OpCode, clientTimeMs: number): Uint8Array {
  const w = new ByteWriter(8);
  w.u8(op);
  w.u32(clientTimeMs >>> 0);
  return w.toUint8Array();
}

export function encodePong(op: OpCode, clientTimeMs: number, serverTimeMs: number): Uint8Array {
  const w = new ByteWriter(12);
  w.u8(op);
  w.u32(clientTimeMs >>> 0);
  w.u32(serverTimeMs >>> 0);
  return w.toUint8Array();
}

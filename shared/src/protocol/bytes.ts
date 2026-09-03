/** Tiny growable binary writer/reader used for the hot network path. */

export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  private offset = 0;

  constructor(initialCapacity = 512) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  get length(): number {
    return this.offset;
  }

  reset(): void {
    this.offset = 0;
  }

  private ensure(bytes: number): void {
    const needed = this.offset + bytes;
    if (needed <= this.buf.byteLength) return;
    let cap = this.buf.byteLength * 2;
    while (cap < needed) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.offset, v & 0xff);
    this.offset += 1;
  }

  i8(v: number): void {
    this.ensure(1);
    this.view.setInt8(this.offset, v);
    this.offset += 1;
  }

  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.offset, v & 0xffff, true);
    this.offset += 2;
  }

  i16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.offset, v, true);
    this.offset += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.offset, v >>> 0, true);
    this.offset += 4;
  }

  f32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.offset, v, true);
    this.offset += 4;
  }

  /** Copy of the written bytes; safe to hand to a socket. */
  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.offset);
  }

  /** Zero-copy view. Only valid until the next write. */
  subarray(): Uint8Array {
    return this.buf.subarray(0, this.offset);
  }
}

export class ByteReader {
  private view: DataView;
  private offset: number;
  private end: number;

  constructor(data: ArrayBufferView) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.offset = 0;
    this.end = data.byteLength;
  }

  get remaining(): number {
    return this.end - this.offset;
  }

  get position(): number {
    return this.offset;
  }

  private need(bytes: number): void {
    if (this.offset + bytes > this.end) {
      throw new RangeError(`Malformed packet: need ${bytes} bytes, have ${this.remaining}`);
    }
  }

  u8(): number {
    this.need(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  i8(): number {
    this.need(1);
    const v = this.view.getInt8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }
}

export function clampI16(v: number): number {
  return v < -32768 ? -32768 : v > 32767 ? 32767 : v;
}

export function clampU8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

export function clampU16(v: number): number {
  return v < 0 ? 0 : v > 65535 ? 65535 : v | 0;
}

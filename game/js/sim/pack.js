// Small binary packing for checkpoints that must fit in a 16 KB room-state value.

export class Writer {
  constructor(size = 1024) {
    this.buf = new DataView(new ArrayBuffer(size));
    this.n = 0;
  }
  room(k) {
    if (this.n + k <= this.buf.byteLength) return;
    const next = new DataView(new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.n + k)));
    new Uint8Array(next.buffer).set(new Uint8Array(this.buf.buffer, 0, this.n));
    this.buf = next;
  }
  u8(v) {
    this.room(1);
    this.buf.setUint8(this.n, clampInt(v, 0, 255));
    this.n += 1;
  }
  u16(v) {
    this.room(2);
    this.buf.setUint16(this.n, clampInt(v, 0, 65535));
    this.n += 2;
  }
  i16(v) {
    this.room(2);
    this.buf.setInt16(this.n, clampInt(v, -32768, 32767));
    this.n += 2;
  }
  f32(v) {
    this.room(4);
    this.buf.setFloat32(this.n, Number.isFinite(v) ? v : 0);
    this.n += 4;
  }
  base64() {
    const bytes = new Uint8Array(this.buf.buffer, 0, this.n);
    let s = '';
    for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    return btoa(s);
  }
}

export class Reader {
  constructor(b64) {
    let bin = '';
    try {
      bin = atob(typeof b64 === 'string' ? b64 : '');
    } catch {
      bin = '';
    }
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    this.buf = new DataView(bytes.buffer);
    this.n = 0;
  }
  get left() {
    return this.buf.byteLength - this.n;
  }
  u8() {
    if (this.left < 1) return 0;
    return this.buf.getUint8(this.n++);
  }
  u16() {
    if (this.left < 2) return (this.n = this.buf.byteLength), 0;
    const v = this.buf.getUint16(this.n);
    this.n += 2;
    return v;
  }
  i16() {
    if (this.left < 2) return (this.n = this.buf.byteLength), 0;
    const v = this.buf.getInt16(this.n);
    this.n += 2;
    return v;
  }
  f32() {
    if (this.left < 4) return (this.n = this.buf.byteLength), 0;
    const v = this.buf.getFloat32(this.n);
    this.n += 4;
    return Number.isFinite(v) ? v : 0;
  }
}

function clampInt(v, lo, hi) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return 0;
  return v < lo ? lo : v > hi ? hi : v;
}

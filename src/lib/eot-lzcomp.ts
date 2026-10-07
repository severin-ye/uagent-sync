/* Adaptive Huffman / LZCOMP decoder adapted from libeot at
 * 0407abddc581d32e9871ee41535183ee1d924d85 (MPL-2.0).
 * Original sources, license and patent notice: data/libeot.
 * Returns all three decoded CTF streams, not a reconstructed installable font.
 */
import { performance } from 'node:perf_hooks';

function check(value: boolean): void { if (!value) throw Error('Invalid or oversized EOT compression'); }
type Node = { up: number; left: number; right: number; code: number; weight: number };
class Huffman {
  tree: Node[];
  symbols: number[];
  constructor(readonly count: number) {
    this.tree = Array.from({ length: count * 2 }, (_, i) => ({ up: Math.floor(i / 2), left: i * 2, right: i * 2 + 1, code: i < count ? -1 : i - count, weight: 1 }));
    this.symbols = Array.from({ length: count }, (_, i) => count + i);
    for (let i = count - 1; i >= 1; i--) this.tree[i].weight = this.tree[i * 2].weight + this.tree[i * 2 + 1].weight;
    if (count > 256 && count < 512) {
      this.update(this.symbols[256]); this.update(this.symbols[257]);
      for (let i = 0; i < 12; i++) this.update(this.symbols[count - 3]);
      for (let i = 0; i < 6; i++) this.update(this.symbols[count - 2]);
    } else for (let j = 0; j < 2; j++) for (let i = 0; i < count; i++) this.update(this.symbols[i]);
  }
  update(a: number): void {
    for (let steps = 0; a !== 1; a = this.tree[a].up) {
      check(++steps < this.count * 2);
      const weight = this.tree[a].weight; let b = a - 1;
      if (this.tree[b].weight === weight) {
        while (b > 0 && this.tree[b].weight === weight) b--;
        b++;
        if (b > 1) {
          const upa = this.tree[a].up, upb = this.tree[b].up;
          [this.tree[a], this.tree[b]] = [this.tree[b], this.tree[a]];
          this.tree[a].up = upa; this.tree[b].up = upb;
          for (const index of [a, b]) {
            const node = this.tree[index];
            if (node.code < 0) { this.tree[node.left].up = index; this.tree[node.right].up = index; }
            else this.symbols[node.code] = index;
          }
          a = b;
        }
      }
      this.tree[a].weight++;
    }
    this.tree[1].weight++;
  }
  read(bit: () => number): number {
    let a = 1;
    for (let steps = 0; this.tree[a].code < 0; steps++) {
      check(steps < this.count * 2); a = bit() ? this.tree[a].right : this.tree[a].left;
      check(a > 0 && a < this.tree.length);
    }
    const symbol = this.tree[a].code; this.update(a); return symbol;
  }
}
const PRELOAD = 7168;
function unpack(bytes: Buffer, limit: number, deadline: number): Buffer {
  let cursor = 0, ticks = 0;
  const bit = () => {
    check(cursor < bytes.length * 8);
    if ((++ticks & 1023) === 0) check(performance.now() < deadline);
    const value = bytes[cursor >> 3] >> (7 - (cursor & 7)) & 1; cursor++; return value;
  };
  const value = (bits: number) => { let result = 0; for (let i = 0; i < bits; i++) result = result * 2 + bit(); return result; };
  check(performance.now() < deadline);
  const runLength = bit(), length = value(24);
  check(length <= limit);
  let ranges = 1; while (2 ** (3 * ranges) < length) ranges++;
  const dup2 = 256 + 8 * ranges;
  const dist = new Huffman(8), len = new Huffman(8), sym = new Huffman(dup2 + 3);
  const history = Buffer.alloc(PRELOAD + length);
  let h = 0;
  for (let k = 0; k < 32; k++) for (let j = 0; j < 96; j++) { history[h++] = k; history[h++] = j; }
  for (let j = 0; j < 256; j++) for (let k = 0; k < 4; k++) history[h++] = j;
  let output = Buffer.alloc(Math.min(limit, Math.max(1, length))), out = 0;
  let state = 0, escape = 0, repeats = 0;
  const save = (byte: number, count = 1) => {
    check(out + count <= limit);
    if (out + count > output.length) {
      const next = Buffer.alloc(Math.min(limit, Math.max(out + count, output.length * 2)));
      output.copy(next, 0, 0, out); output = next;
    }
    output.fill(byte, out, out + count); out += count;
  };
  const emit = (byte: number) => {
    if ((h & 1023) === 0) check(performance.now() < deadline);
    check(h < history.length); history[h++] = byte;
    if (!runLength) save(byte);
    else if (state === 0) { escape = byte; state = 1; }
    else if (state === 1) { if (byte === escape) state = 2; else save(byte); }
    else if (state === 2) { repeats = byte; if (!byte) { save(escape); state = 1; } else state = 3; }
    else { save(byte, repeats); state = 1; }
  };
  while (h < history.length) {
    check(performance.now() < deadline);
    const symbol = sym.read(bit);
    if (symbol < 256) emit(symbol);
    else if (symbol >= dup2) emit(history[h - 2 * (symbol - dup2 + 1)]);
    else {
      const distanceRanges = Math.floor((symbol - 256) / 8) + 1;
      check(distanceRanges <= ranges);
      let bits = (symbol - 256) % 8, copy = 0;
      for (let groups = 0; ; groups++) {
        check(groups < 13); copy = copy * 4 + (bits & 3); check(copy <= length);
        if (!(bits & 4)) break; bits = len.read(bit);
      }
      copy += 2;
      let distance = 0;
      for (let j = 0; j < distanceRanges; j++) distance = distance * 8 + dist.read(bit);
      distance++; if (distance >= 512) copy++;
      const start = h - distance - copy + 1;
      check(start >= 0 && start + copy <= h && h + copy <= history.length);
      for (let j = 0; j < copy; j++) emit(history[start + j]);
    }
  }
  check(!runLength || state === 1 || (length === 0 && state === 0));
  // The compressor flushes a final partial byte, never hidden trailing bytes.
  check(bytes.length === Math.ceil(cursor / 8));
  if (cursor % 8) check((bytes.at(-1)! & ((1 << (8 - cursor % 8)) - 1)) === 0);
  return output.subarray(0, out);
}

/** Bounded decoding of EOT's MTX version 3, exposing every decompressed byte. */
export function decodeEotMtx(bytes: Buffer, limit = 100_000_000, timeoutMs = 5000): Buffer[] {
  check(Number.isSafeInteger(limit) && limit >= 0 && limit <= 100_000_000 && timeoutMs > 0);
  check(bytes.length >= 10 && bytes[0] === 3);
  const copyLimit = bytes.readUIntBE(1, 3), second = bytes.readUIntBE(4, 3), third = bytes.readUIntBE(7, 3);
  check(copyLimit > 0 && copyLimit <= limit && second >= 10 && third >= second && third <= bytes.length);
  const deadline = performance.now() + timeoutMs, decoded: Buffer[] = [];
  for (const [start, end] of [[10, second], [second, third], [third, bytes.length]]) {
    const data = unpack(bytes.subarray(start, end), limit, deadline); limit -= data.length; decoded.push(data);
  }
  const ctf = decoded[0];
  check(ctf.length >= 12 && (ctf.readUInt32BE(0) === 0x10000 || ctf.toString('ascii', 0, 4) === 'OTTO'));
  const tables = ctf.readUInt16BE(4); check(tables > 0 && tables <= 4096 && 12 + tables * 16 <= ctf.length);
  const tags = new Set<string>();
  for (let i = 0; i < tables; i++) {
    const at = 12 + i * 16, tag = ctf.toString('ascii', at, at + 4), offset = ctf.readUInt32BE(at + 8), size = ctf.readUInt32BE(at + 12);
    check(/^[\x20-\x7e]{4}$/.test(tag) && !tags.has(tag)); tags.add(tag);
    // These tables carry transformed glyph/CVT data; their TTF lengths differ.
    check(tag === 'loca' || (offset <= ctf.length && (['glyf', 'cvt ', 'hdmx', 'VDMX'].includes(tag) || offset + size <= ctf.length)));
  }
  return decoded;
}

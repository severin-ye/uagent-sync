import { brotliDecompressSync, inflateRawSync, inflateSync } from "node:zlib";
import { decodeEotMtx } from './eot-lzcomp.js';

// These limits cover a single Git-compatible file and a bounded package. They
// are storage/decoder limits, never evidence of publisher provenance or trust.
export const PLUGIN_MAX_FILE_BYTES = 100_000_000;
export const PLUGIN_MAX_TOTAL_BYTES = 512_000_000;
const DECODED_LIMIT = 100_000_000;
function requireFormat(valid: boolean): void {
  if (!valid) throw Error("Invalid runtime binary structure");
}
function range(bytes: Buffer, offset: number, length: number): void {
  requireFormat(Number.isSafeInteger(offset) && offset >= 0 && length >= 0 && offset + length <= bytes.length);
}
function leb(bytes: Buffer, cursor: { offset: number }): number {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    range(bytes, cursor.offset, 1);
    const next = bytes[cursor.offset++];
    requireFormat(i !== 4 || next < 16);
    value += (next & 127) * 2 ** (7 * i);
    if (!(next & 128)) return value;
  }
  throw Error("Invalid runtime binary structure");
}
function wasm(bytes: Buffer): void {
  requireFormat(bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])));
  const cursor = { offset: 8 };
  const seen = new Set<number>();
  while (cursor.offset < bytes.length) {
    const section = bytes[cursor.offset++];
    requireFormat(section <= 13 && (!section || !seen.has(section)));
    if (section) seen.add(section);
    const length = leb(bytes, cursor);
    range(bytes, cursor.offset, length);
    cursor.offset += length;
  }
}
function pe(bytes: Buffer): void {
  range(bytes, 0, 64);
  requireFormat(bytes.toString("ascii", 0, 2) === "MZ");
  const offset = bytes.readUInt32LE(60);
  range(bytes, offset, 24);
  requireFormat(bytes.toString("binary", offset, offset + 4) === "PE\0\0");
  const sections = bytes.readUInt16LE(offset + 6), optional = bytes.readUInt16LE(offset + 20);
  requireFormat(sections > 0 && sections <= 96 && optional >= 96);
  range(bytes, offset + 24, optional + sections * 40);
  const magic = bytes.readUInt16LE(offset + 24);
  requireFormat(magic === 0x10b || magic === 0x20b);
  for (let i = 0; i < sections; i++) {
    const section = offset + 24 + optional + i * 40;
    range(bytes, bytes.readUInt32LE(section + 20), bytes.readUInt32LE(section + 16));
  }
}
function sfnt(bytes: Buffer): void {
  range(bytes, 0, 12);
  requireFormat(bytes.readUInt32BE(0) === 0x10000 || bytes.toString("ascii", 0, 4) === "OTTO");
  const count = bytes.readUInt16BE(4);
  requireFormat(count > 0 && count <= 4096);
  range(bytes, 12, count * 16);
  for (let i = 0; i < count; i++) {
    const entry = 12 + i * 16;
    range(bytes, bytes.readUInt32BE(entry + 8), bytes.readUInt32BE(entry + 12));
  }
}
function font(bytes: Buffer, extension: string): Buffer[] {
  if (extension === "ttf" || extension === "otf") { sfnt(bytes); return [bytes]; }
  const woff2 = extension === "woff2", header = woff2 ? 48 : 44;
  range(bytes, 0, header);
  requireFormat(bytes.toString("ascii", 0, 4) === (woff2 ? "wOF2" : "wOFF") && bytes.readUInt32BE(8) === bytes.length);
  requireFormat(bytes.readUInt32BE(4) === 0x10000 || bytes.toString("ascii", 4, 8) === "OTTO");
  const count = bytes.readUInt16BE(12), decodedSize = bytes.readUInt32BE(16);
  requireFormat(count > 0 && count <= 4096 && bytes.readUInt16BE(14) === 0 && decodedSize <= DECODED_LIMIT);
  const decoded: Buffer[] = [bytes];
  if (!woff2) {
    range(bytes, header, count * 20);
    let total = 0;
    for (let i = 0; i < count; i++) {
      const entry = header + i * 20, offset = bytes.readUInt32BE(entry + 4), size = bytes.readUInt32BE(entry + 8), original = bytes.readUInt32BE(entry + 12);
      requireFormat(size <= original && (total += original) <= DECODED_LIMIT);
      range(bytes, offset, size);
      const data = size === original ? bytes.subarray(offset, offset + size) : inflateSync(bytes.subarray(offset, offset + size), { maxOutputLength: original });
      requireFormat(data.length === original); decoded.push(data);
    }
  } else {
    const cursor = { offset: header };
    const base128 = () => {
      let value = 0;
      for (let i = 0; i < 5; i++) {
        range(bytes, cursor.offset, 1); const next = bytes[cursor.offset++];
        requireFormat(!(i === 0 && next === 0x80)); value = value * 128 + (next & 127);
        requireFormat(value <= 0xffffffff);
        if (!(next & 128)) return value;
      }
      throw Error("Invalid runtime binary structure");
    };
    let decodedLength = 0;
    for (let i = 0; i < count; i++) {
      range(bytes, cursor.offset, 1); const flags = bytes[cursor.offset++], tag = flags & 63, transform = flags >> 6;
      let custom = "";
      if (tag === 63) { range(bytes, cursor.offset, 4); custom = bytes.toString("ascii", cursor.offset, cursor.offset + 4); cursor.offset += 4; }
      const original = base128();
      const glyph = tag === 10 || tag === 11 || custom === "glyf" || custom === "loca";
      const transformed = glyph ? transform !== 3 : transform !== 0;
      decodedLength += transformed ? base128() : original;
      requireFormat(decodedLength <= DECODED_LIMIT);
    }
    const compressed = bytes.readUInt32BE(20); range(bytes, cursor.offset, compressed);
    const data = brotliDecompressSync(bytes.subarray(cursor.offset, cursor.offset + compressed), { maxOutputLength: DECODED_LIMIT });
    requireFormat(data.length === decodedLength); decoded.push(data);
  }
  const metadata = woff2 ? 28 : 24;
  const metadataOffset = bytes.readUInt32BE(metadata), metadataLength = bytes.readUInt32BE(metadata + 4), metadataOriginal = bytes.readUInt32BE(metadata + 8);
  if (metadataOffset || metadataLength || metadataOriginal) {
    requireFormat(metadataOffset > 0 && metadataLength > 0 && metadataOriginal > 0 && metadataOriginal <= DECODED_LIMIT);
    range(bytes, metadataOffset, metadataLength);
    const compressed = bytes.subarray(metadataOffset, metadataOffset + metadataLength);
    const data = woff2 ? brotliDecompressSync(compressed, { maxOutputLength: metadataOriginal }) : inflateSync(compressed, { maxOutputLength: metadataOriginal });
    requireFormat(data.length === metadataOriginal && decoded.slice(1).reduce((total, b) => total + b.length, data.length) <= DECODED_LIMIT);
    decoded.push(data);
  }
  return decoded;
}
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function embeddedEot(bytes: Buffer, budget: { remaining: number }): Buffer[] {
  // W3C EOT 3.3. MTX compression is decoded; XOR and EUDC payloads are refused.
  range(bytes, 0, 80);
  const fontSize = bytes.readUInt32LE(4), flags = bytes.readUInt32LE(12);
  requireFormat(bytes.readUInt32LE(0) === bytes.length && bytes.readUInt32LE(8) === 0x20002
    && bytes.readUInt16LE(34) === 0x504c && !(flags & ~0xd5) && fontSize > 0 && fontSize <= DECODED_LIMIT);
  for (let offset = 64; offset < 80; offset += 4) requireFormat(bytes.readUInt32LE(offset) === 0);
  let cursor = 80;
  const string = () => {
    range(bytes, cursor, 4);
    requireFormat(bytes.readUInt16LE(cursor) === 0);
    const size = bytes.readUInt16LE(cursor + 2); requireFormat(size % 2 === 0);
    cursor += 4; range(bytes, cursor, size);
    const data = bytes.subarray(cursor, cursor + size); cursor += size;
    new TextDecoder('utf-16le', { fatal: true }).decode(data);
    return data;
  };
  for (let i = 0; i < 4; i++) string();
  const root = string();
  range(bytes, cursor, 20);
  const checksum = (root.reduce((sum, byte) => sum + byte, 0) ^ 0x50475342) >>> 0;
  requireFormat(bytes.readUInt32LE(cursor) === checksum
    && bytes.readUInt16LE(cursor + 8) === 0 && bytes.readUInt16LE(cursor + 10) === 0
    && bytes.readUInt32LE(cursor + 12) === 0 && bytes.readUInt32LE(cursor + 16) === 0);
  cursor += 20;
  requireFormat(cursor + fontSize === bytes.length);
  const data = bytes.subarray(cursor);
  if (!(flags & 4)) { sfnt(data); return [bytes, data]; }
  const streams = decodeEotMtx(data, budget.remaining);
  budget.remaining -= streams.reduce((total, stream) => total + stream.length, 0);
  return [bytes, ...streams];
}
function wordFontKeys(table: Buffer | undefined, relationships: Buffer | undefined): Map<string, Buffer> {
  requireFormat(!!table && !!relationships && table.length <= 2_000_000 && relationships.length <= 2_000_000);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const t = decoder.decode(table), r = decoder.decode(relationships);
  // This bounded subset reads metadata only, with no entity expansion, network,
  // XML comments/CDATA interpretation, alternate key guesses or font installation.
  requireFormat(!/<!/.test(t + r));
  const attributes = (tag: string) => {
    const attrs = new Map<string, string>();
    for (const match of tag.matchAll(/\s([\w:]+)\s*=\s*(["'])([^"'<>]*)\2/g)) {
      requireFormat(!attrs.has(match[1])); attrs.set(match[1], match[3]);
    }
    return attrs;
  };
  const keys = new Map<string, Buffer>(), targets = new Map<string, string>();
  for (const match of t.matchAll(/<w:embed(?:Regular|Bold|Italic|BoldItalic)\b[^<>]*\/>/g)) {
    const attrs = attributes(match[0]), id = attrs.get('r:id'), key = attrs.get('w:fontKey');
    requireFormat(!!id && /^[\w.-]+$/.test(id) && !keys.has(id) && !!key && /^\{[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\}$/i.test(key));
    keys.set(id!, Buffer.from(key!.replace(/[{}-]/g, ''), 'hex').reverse());
  }
  for (const match of r.matchAll(/<Relationship\b[^<>]*\/>/g)) {
    const attrs = attributes(match[0]);
    if (!/^(?:http:\/\/schemas.openxmlformats.org\/officeDocument\/2006|http:\/\/purl.oclc.org\/ooxml\/officeDocument)\/relationships\/font$/.test(attrs.get('Type') ?? '')) continue;
    const id = attrs.get('Id'), target = attrs.get('Target');
    requireFormat(!!id && !targets.has(id) && !!target && /^fonts\/[^/\\&:]+\.odttf$/.test(target) && !attrs.has('TargetMode'));
    targets.set(id!, target!);
  }
  const result = new Map<string, Buffer>();
  for (const [id, key] of keys) {
    const target = targets.get(id); requireFormat(!!target && !result.has('word/' + target));
    result.set('word/' + target, key);
  }
  return result;
}
function workbook(bytes: Buffer, kind = 'xlsx', budget = { remaining: DECODED_LIMIT }, depth = 0): Buffer[] {
  // Parse the central directory and each local member; never extract to disk.
  // ZIP64, encryption, symlink metadata, and opaque embedded objects are refused.
  requireFormat(depth <= 2);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  requireFormat(end >= 0);
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  requireFormat(bytes.readUInt32LE(end + 4) === 0 && bytes.readUInt16LE(end + 8) === count && count > 0 && count <= 4000 && start + size === end);
  const decoded: Buffer[] = [bytes], names = new Set<string>(); let cursor = start;
  const wordMetadata = new Map<string, Buffer>(), obfuscated: Array<{name: string; data: Buffer}> = [];
  for (let i = 0; i < count; i++) {
    range(bytes, cursor, 46); requireFormat(bytes.readUInt32LE(cursor) === 0x02014b50);
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), packed = bytes.readUInt32LE(cursor + 20), unpacked = bytes.readUInt32LE(cursor + 24);
    const length = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32), local = bytes.readUInt32LE(cursor + 42);
    range(bytes, cursor + 46, length + extra + comment);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + length));
    requireFormat(!names.has(name.toLowerCase()) && !name.includes("\\") && !name.startsWith("/") && !name.includes(":") && !name.split("/").some(p => p === ".." || p === ".") && !/[\x00-\x1f]/.test(name));
    names.add(name.toLowerCase());
    requireFormat(!(flags & ~0x808) && (method === 0 || method === 8) && (bytes.readUInt32LE(cursor + 38) >>> 16 & 0xf000) !== 0xa000 && unpacked <= budget.remaining);
    budget.remaining -= unpacked;
    const image = /\.(?:png|jpe?g|gif|webp)$/i.test(name);
    const embeddedFont = kind === 'pptx' && /^ppt\/fonts\/[^/]+\.fntdata$/.test(name);
    const documentFont = kind === 'docx' && /^word\/fonts\/[^/]+\.(?:ttf|otf)$/.test(name);
    const obfuscatedFont = kind === 'docx' && /^word\/fonts\/[^/]+\.odttf$/.test(name);
    const prefix = kind === 'pptx' ? 'ppt' : kind === 'docx' ? 'word' : 'xl';
    const embeddedWorkbook = new RegExp(`^${prefix}/embeddings/[^/]+\\.xlsx$`).test(name);
    requireFormat(/(?:\.xml|\.rels)$/.test(name) || name.endsWith("/") || image || embeddedFont || documentFont || obfuscatedFont || embeddedWorkbook);
    range(bytes, local, 30); requireFormat(bytes.readUInt32LE(local) === 0x04034b50 && bytes.readUInt16LE(local + 6) === flags && bytes.readUInt16LE(local + 8) === method);
    const localName = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28), dataStart = local + 30 + localName + localExtra;
    range(bytes, local + 30, localName + localExtra); range(bytes, dataStart, packed);
    requireFormat(bytes.subarray(local + 30, local + 30 + localName).equals(bytes.subarray(cursor + 46, cursor + 46 + length)) && dataStart + packed <= start);
    const data = method === 0 ? bytes.subarray(dataStart, dataStart + packed) : inflateRawSync(bytes.subarray(dataStart, dataStart + packed), { maxOutputLength: Math.max(1, unpacked) });
    requireFormat(data.length === unpacked && crc32(data) === bytes.readUInt32LE(cursor + 16));
    if (image) {
      const valid = /\.png$/i.test(name) ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : /\.jpe?g$/i.test(name) ? data.length >= 4 && data[0] === 255 && data[1] === 216 && data.at(-2) === 255 && data.at(-1) === 217
        : /\.gif$/i.test(name) ? /GIF8[79]a/.test(data.subarray(0, 6).toString('ascii'))
        : data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
      requireFormat(valid);
    } else if (embeddedFont) decoded.push(...embeddedEot(data, budget));
    else if (documentFont) sfnt(data);
    else if (obfuscatedFont) obfuscated.push({ name, data });
    else if (embeddedWorkbook) decoded.push(...workbook(data, 'xlsx', budget, depth + 1));
    else new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (!embeddedFont && !embeddedWorkbook) decoded.push(data);
    if (kind === 'docx' && ['word/fontTable.xml', 'word/_rels/fontTable.xml.rels'].includes(name)) wordMetadata.set(name, data);
    cursor += 46 + length + extra + comment;
  }
  const main = kind === 'docx' ? 'word/document.xml' : kind === 'pptx' ? 'ppt/presentation.xml' : 'xl/workbook.xml';
  requireFormat(cursor === end && names.has("[content_types].xml") && names.has(main));
  if (obfuscated.some(file => file.data.length)) {
    const keys = wordFontKeys(wordMetadata.get('word/fontTable.xml'), wordMetadata.get('word/_rels/fontTable.xml.rels'));
    for (const { name, data } of obfuscated) {
      // Empty unused font parts have no hidden payload. Nonempty parts require
      // the exact package relationship and ECMA-376 17.8.1 reversed GUID key.
      if (!data.length) continue;
      const key = keys.get(name); requireFormat(!!key && data.length >= 32 && data.length <= budget.remaining);
      budget.remaining -= data.length;
      const original = Buffer.from(data);
      for (let i = 0; i < 32; i++) original[i] ^= key![i % 16];
      sfnt(original); decoded.push(original);
    }
  }
  return decoded;
}
/** Returns scan inputs only for explicitly supported and structurally valid formats. */
export function pluginRuntimeScanBuffers(relative: string, bytes: Buffer): Buffer[] | undefined {
  try {
    if (/\.wasm\.br$/i.test(relative)) {
      const data = brotliDecompressSync(bytes, { maxOutputLength: DECODED_LIMIT }); wasm(data); return [bytes, data];
    }
    if (/\.wasm$/i.test(relative)) { wasm(bytes); return [bytes]; }
    if (/\.exe$/i.test(relative)) { pe(bytes); return [bytes]; }
    const extension = relative.match(/\.(woff2?|ttf|otf)$/i)?.[1].toLowerCase();
    if (extension) return font(bytes, extension);
    const office = relative.match(/\.(xlsx|docx|pptx)$/i)?.[1].toLowerCase();
    if (office) return workbook(bytes, office);
    return undefined;
  } catch { throw Error("Invalid or oversized runtime binary content refused"); }
}

import { it } from "node:test";
import assert from "node:assert/strict";
import { brotliCompressSync, deflateRawSync } from "node:zlib";
import { pluginRuntimeScanBuffers } from "../src/lib/plugin-runtime-content.js";
import { decodeEotMtx } from '../src/lib/eot-lzcomp.js';

function pe() {
  const bytes = Buffer.alloc(512); bytes.write("MZ"); bytes.writeUInt32LE(64, 60);
  bytes.write("PE\0\0", 64, "binary"); bytes.writeUInt16LE(0x8664, 68); bytes.writeUInt16LE(1, 70);
  bytes.writeUInt16LE(112, 84); bytes.writeUInt16LE(0x20b, 88);
  bytes.writeUInt32LE(64, 216); bytes.writeUInt32LE(256, 220); return bytes;
}
function woff2() {
  const data = Buffer.from("ordinary font data"), compressed = brotliCompressSync(data), bytes = Buffer.alloc(50 + compressed.length);
  bytes.write("wOF2"); bytes.writeUInt32BE(0x10000, 4); bytes.writeUInt32BE(bytes.length, 8);
  bytes.writeUInt16BE(1, 12); bytes.writeUInt32BE(64, 16); bytes.writeUInt32BE(compressed.length, 20);
  bytes[48] = 0; bytes[49] = data.length; compressed.copy(bytes, 50); return bytes;
}
function zip(entries: Array<[string, string | Buffer]>) {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name), data = Buffer.from(text), packed = deflateRawSync(data), l = Buffer.alloc(30), c = Buffer.alloc(46);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    l.writeUInt32LE(0x04034b50); l.writeUInt16LE(8, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(packed.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(8, 10); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    c.writeUInt32LE(crc, 16);
    locals.push(l, n, packed); central.push(c, n); offset += l.length + n.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
it("accepts bounded PE, WOFF2 and XLSX structures without running their content", () => {
  for (const [name, bytes] of [["host.exe", pe()], ["font.woff2", woff2()], ["template.xlsx", zip([["[Content_Types].xml", "<Types/>"], ["xl/workbook.xml", "<workbook/>"]])]] as const) {
    const scan = pluginRuntimeScanBuffers(name, bytes)!;
    assert.deepEqual(scan[0], bytes); assert.ok(scan.length >= 1);
  }
});
function eot() {
  const font = Buffer.alloc(48); font.writeUInt32BE(0x10000); font.writeUInt16BE(1, 4);
  font.write('name', 12); font.writeUInt32BE(28, 20); font.writeUInt32BE(20, 24);
  font.write('scan-font-marker', 28);
  const header = Buffer.alloc(120); header.writeUInt32LE(header.length + font.length);
  header.writeUInt32LE(font.length, 4); header.writeUInt32LE(0x20002, 8); header.writeUInt16LE(0x504c, 34);
  header.writeUInt32LE(0x50475342, 100);
  return Buffer.concat([header, font]);
}
const xlsx = (extra: Array<[string, string | Buffer]> = []) => zip([["[Content_Types].xml", "<Types/>"], ["xl/workbook.xml", "<workbook/>"], ...extra]);
const pptx = (extra: Array<[string, string | Buffer]> = []) => zip([["[Content_Types].xml", "<Types/>"], ["ppt/presentation.xml", "<presentation/>"], ...extra]);
it('validates and scans uncompressed DOCX font tables while rejecting disguised fonts', () => {
  const font = eot().subarray(120);
  const docx = (b: Buffer) => zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', '<document/>'], ['word/fonts/example.ttf', b]]);
  assert.ok(pluginRuntimeScanBuffers('reference.docx', docx(font))!.some(b => b.equals(font)));
  assert.throws(() => pluginRuntimeScanBuffers('reference.docx', docx(Buffer.from('opaque'))), /refused/);
});
it('decodes DOCX obfuscated fonts through unique local font relationships', () => {
  const font = eot().subarray(120), key = '001B70DC-AA60-4AD5-90EC-18A0948E1EAE';
  const encoded = Buffer.from(font), reversed = Buffer.from(key.replaceAll('-', ''), 'hex').reverse();
  for (let i = 0; i < 32; i++) encoded[i] ^= reversed[i % 16];
  const table = `<w:fonts><w:font><w:embedRegular r:id="rId1" w:fontKey="{${key}}"/></w:font></w:fonts>`;
  const relationships = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font1.odttf"/></Relationships>';
  const docx = (t = table, r = relationships, b = encoded) => zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', '<document/>'], ['word/fontTable.xml', t], ['word/_rels/fontTable.xml.rels', r], ['word/fonts/font1.odttf', b], ['word/fonts/unused.odttf', Buffer.alloc(0)]]);
  assert.ok(pluginRuntimeScanBuffers('reference.docx', docx())!.some(b => b.equals(font)));
  for (const [t, r, b] of [[table.replace(key, 'invalid'), relationships, encoded], [table, relationships.replace('fonts/font1', '../font1'), encoded], [table, relationships.replace('/>', ' TargetMode="External"/>'), encoded], [table, relationships, encoded.subarray(0, 20)], [table.replace('</w:fonts>', table + '</w:fonts>'), relationships, encoded]] as const) {
    assert.throws(() => pluginRuntimeScanBuffers('reference.docx', docx(t, r, b)), /refused/);
  }
});
it("scans validated EOT font bytes and nested XLSX XML in a presentation", () => {
  const font = eot(), embedded = xlsx([["xl/sharedStrings.xml", "<s>embedded-scan-marker</s>"]]);
  const scan = pluginRuntimeScanBuffers("reference.pptx", pptx([["ppt/fonts/font1.fntdata", font], ["ppt/embeddings/chart.xlsx", embedded]]))!;
  assert.ok(scan.some(b => b.equals(font))); assert.ok(scan.some(b => b.equals(font.subarray(120))));
  assert.ok(scan.some(b => b.toString() === "<s>embedded-scan-marker</s>"));
});
it("rejects unsupported, truncated or inconsistent EOT structures", () => {
  for (const mutate of [
    (b: Buffer) => b.writeUInt32LE(4, 12), (b: Buffer) => b.writeUInt32LE(0x10000000, 12),
    (b: Buffer) => b.writeUInt32LE(0x20001, 8), (b: Buffer) => b.writeUInt32LE(1, 4),
    (b: Buffer) => b.writeUInt16LE(65534, 82), (b: Buffer) => b.writeUInt16LE(1, 80),
    (b: Buffer) => b.writeUInt16LE(2, 110), (b: Buffer) => b.writeUInt32LE(1, 116),
    (b: Buffer) => b.writeUInt32BE(10000, 140), (b: Buffer) => b.writeUInt32LE(1, 100),
  ]) {
    const bytes = eot(); mutate(bytes);
    assert.throws(() => pluginRuntimeScanBuffers("reference.pptx", pptx([["ppt/fonts/font1.fntdata", bytes]])), /refused/);
  }
});
it("refuses nested opaque objects, disguised workbooks and excessive Office nesting", () => {
  for (const embedded of [Buffer.from('MZ'), xlsx([["xl/vbaProject.bin", "opaque"]]), xlsx([["xl/embeddings/object.bin", "opaque"]])]) {
    assert.throws(() => pluginRuntimeScanBuffers("reference.pptx", pptx([["ppt/embeddings/chart.xlsx", embedded]])), /refused/);
  }
  assert.throws(() => pluginRuntimeScanBuffers("reference.pptx", pptx([["other/chart.xlsx", xlsx()]])), /refused/);
  const level3 = xlsx([["xl/embeddings/third.xlsx", xlsx()]]), level2 = xlsx([["xl/embeddings/second.xlsx", level3]]);
  assert.throws(() => pluginRuntimeScanBuffers("reference.pptx", pptx([["ppt/embeddings/first.xlsx", level2]])), /refused/);
});
it("shares one decoded byte budget across outer and nested Office members", () => {
  const large = Buffer.alloc(51_000_000, 32), nested = xlsx([["xl/sharedStrings.xml", large]]);
  assert.throws(() => pluginRuntimeScanBuffers("reference.pptx", pptx([["ppt/slides/slide1.xml", large], ["ppt/embeddings/chart.xlsx", nested]])), /refused/);
});
it("rejects disguised binary, malformed brotli, truncated section ranges and opaque ZIP members", () => {
  for (const name of ["host.exe", "font.woff2", "template.xlsx", "runtime.wasm", "runtime.wasm.br"]) {
    assert.throws(() => pluginRuntimeScanBuffers(name, Buffer.from("ordinary text")), /refused/);
  }
  const invalid = pe(); invalid.writeUInt32LE(1000, 220);
  assert.throws(() => pluginRuntimeScanBuffers("host.exe", invalid), /refused/);
  assert.throws(() => pluginRuntimeScanBuffers("runtime.wasm", Buffer.from([0,97,115,109,1,0,0,0,1,20])), /refused/);
  assert.throws(() => pluginRuntimeScanBuffers("template.xlsx", zip([["[Content_Types].xml", "<Types/>"], ["xl/workbook.xml", "<workbook/>"], ["xl/secret.bin", "private"]])), /refused/);
  const font = woff2(); font.writeUInt32BE(100_000_001, 16);
  assert.throws(() => pluginRuntimeScanBuffers("font.woff2", font), /refused/);
});
it("makes decoded compressed member text available to the unchanged secret scanner", () => {
  const text = 'password="very-private-password"', encoded = Buffer.from(text), section = Buffer.concat([Buffer.from([0,97,115,109,1,0,0,0,0, encoded.length]), encoded]);
  assert.ok(pluginRuntimeScanBuffers("runtime.wasm.br", brotliCompressSync(section))!.some(b => b.includes(encoded)));
  assert.ok(pluginRuntimeScanBuffers("template.xlsx", zip([["[Content_Types].xml", "<Types/>"], ["xl/workbook.xml", `<workbook>${text}</workbook>`]]))!.some(b => b.includes(encoded)));
});
it("accepts ordinary Office templates and exposes every XML member for scanning", () => {
  for (const [name, main] of [["reference.docx", "word/document.xml"], ["reference.pptx", "ppt/presentation.xml"]]) {
    const text = '<document>password="very-private-password"</document>';
    const bytes = zip([["[Content_Types].xml", "<Types/>"], [main, text]]);
    assert(pluginRuntimeScanBuffers(name, bytes)?.some(member => member.toString().includes('very-private-password')));
    assert.throws(() => pluginRuntimeScanBuffers(name, zip([["[Content_Types].xml", "<Types/>"], [main, text], ["embedded/object.bin", "opaque"]])), /refused/);
  }
});
it("decodes compressed font metadata rather than allowing it to conceal text", () => {
  const font = woff2(), text = Buffer.from('password="very-private-password"'), metadata = brotliCompressSync(text);
  const bytes = Buffer.concat([font, metadata]); bytes.writeUInt32BE(bytes.length, 8);
  bytes.writeUInt32BE(font.length, 28); bytes.writeUInt32BE(metadata.length, 32); bytes.writeUInt32BE(text.length, 36);
  assert.ok(pluginRuntimeScanBuffers("font.woff2", bytes)!.some(b => b.equals(text)));
  bytes.writeUInt32BE(100_000_001, 36);
  assert.throws(() => pluginRuntimeScanBuffers("font.woff2", bytes), /refused/);
});
it("accepts a nonzero EUDC code page when no EUDC payload is present", () => {
  const bytes = eot(); bytes.writeUInt32LE(10000, 104);
  assert.ok(pluginRuntimeScanBuffers("reference.pptx", pptx([["ppt/fonts/font1.fntdata", bytes]])));
});
// Literal-only LZCOMP fixture generated from the pinned libeot adaptive Huffman
// encoder rules. No real font or user cache content is shipped in the test.
const mtxFixture = () => Buffer.from('AwAQAAAASQAAYwAAJAbDhObLFxxxxSERL5EQCEIOYyktVUrxZxHJ0lFRr+0FmROkGULB6thEVdHuEdelVqT9ASISI7uzMzKqqAAAC8M8O0FAu7pCxiAPw5MQEsAWHx44/HywAAALQ7xCj746EMYgQxo0QEcASlZ0o/HUAA==', 'base64');
function compressedEot() {
  const mtx = mtxFixture(), header = Buffer.from(eot().subarray(0, 120));
  header.writeUInt32LE(120 + mtx.length); header.writeUInt32LE(mtx.length, 4);
  header.writeUInt32LE(4, 12); header.writeUInt32LE(10000, 104);
  return Buffer.concat([header, mtx]);
}
it('decodes every compressed EOT stream and exposes compressed secrets to scanning', () => {
  const decoded = decodeEotMtx(mtxFixture());
  assert.equal(decoded.length, 3);
  assert.ok(decoded[0].includes(Buffer.from('password="very-private-password"')));
  assert.equal(decoded[1].toString(), 'secondary-stream-marker');
  assert.equal(decoded[2].toString(), 'tertiary-stream-marker');
  const scan = pluginRuntimeScanBuffers('reference.pptx', pptx([['ppt/fonts/test.fntdata', compressedEot()]]))!;
  assert.ok(decoded.every(stream => scan.some(buffer => buffer.equals(stream))));
});
it('refuses bad compression offsets, truncated Huffman data, hidden tails, limits and timeout', () => {
  for (const mutate of [
    (b: Buffer) => { b[0] = 2; }, (b: Buffer) => b.writeUIntBE(9, 4, 3),
    (b: Buffer) => b.writeUIntBE(b.length + 1, 7, 3),
    (b: Buffer) => b.writeUIntBE(0xffffff, 1, 3),
    (b: Buffer) => b.fill(255, 10, 14),
  ]) {
    const data = mtxFixture(); mutate(data); assert.throws(() => decodeEotMtx(data, 4096));
  }
  assert.throws(() => decodeEotMtx(mtxFixture().subarray(0, -1)));
  assert.throws(() => decodeEotMtx(Buffer.concat([mtxFixture(), Buffer.from([0])])));
  assert.throws(() => decodeEotMtx(mtxFixture(), 4095));
  // Four LZ bytes expand to 255 RLE bytes; the compressed length is not a cap.
  assert.throws(() => decodeEotMtx(Buffer.from('AwAAAQAAEgAAFoAAAgKFyQLAAAAAAAAAAAA=', 'base64'), 100));
  assert.throws(() => decodeEotMtx(mtxFixture(), 4096, 0.000001));
  for (const offset of [108, 110, 112, 116]) {
    const data = compressedEot(); data[offset] = 1;
    assert.throws(() => pluginRuntimeScanBuffers('reference.pptx', pptx([['ppt/fonts/test.fntdata', data]])), /refused/);
  }
});

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { parseWorkspaceStateArtifact, serializeWorkspaceStateArtifact, decodeWorkspaceStateStorage } from '../src/artifacts/workspace-state-codec.js';

const state = { schemaVersion: 3, targetAgent: 'codex', timestamp: 'fixture', platform: 'windows', hostname: 'fixture', tombstones: [], envVars: [], submodules: [], skills: [], skillSources: [], windowsFixPaths: [] };
function envelope(value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value));
  return { artifactEncoding: 'workspace-state-gzip-v1', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), base64: gzipSync(bytes).toString('base64') };
}
it('keeps ordinary state bytes unchanged and round-trips compressed state through the existing parser', () => {
  assert.equal(serializeWorkspaceStateArtifact(state), JSON.stringify(state, null, 2) + '\n');
  assert.deepEqual(parseWorkspaceStateArtifact(envelope(state)), parseWorkspaceStateArtifact(state));
  assert.deepEqual(decodeWorkspaceStateStorage(JSON.stringify(envelope(state))), state);
});
it('refuses compressed-state tampering, noncanonical data, oversized declarations and invalid inner schema', () => {
  for (const mutate of [
    (e: ReturnType<typeof envelope>) => { e.sha256 = '0'.repeat(64); },
    (e: ReturnType<typeof envelope>) => { e.bytes++; },
    (e: ReturnType<typeof envelope>) => { e.bytes = 1; },
    (e: ReturnType<typeof envelope>) => { e.bytes = 512_000_001; },
    (e: ReturnType<typeof envelope>) => { e.base64 += '\n'; },
    (e: ReturnType<typeof envelope>) => { e.base64 = '!!!!'; },
  ]) { const e = envelope(state); mutate(e); assert.throws(() => parseWorkspaceStateArtifact(e), /compressed|storage/i); }
  assert.throws(() => parseWorkspaceStateArtifact(envelope({ ...state, targetAgent: 'unknown' })), /artifact/i);
  assert.throws(() => parseWorkspaceStateArtifact({ ...envelope(state), artifactEncoding: 'unknown' }), /storage/i);
});
it('compresses a state exceeding the Git file cap without dropping payload bytes', () => {
  const original = { ...state, content: ' '.repeat(100_000_000) };
  const serialized = serializeWorkspaceStateArtifact(original);
  assert.ok(Buffer.byteLength(serialized) < 100_000_000);
  assert.equal(JSON.parse(serialized).artifactEncoding, 'workspace-state-gzip-v1');
  const recovered = parseWorkspaceStateArtifact(serialized);
  assert.equal(recovered.content, original.content);
});

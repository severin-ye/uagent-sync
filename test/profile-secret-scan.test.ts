import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProfileContentSafe } from '../src/lib/profile-secret-scan.js';
test('source environment references are portable but literal tokens remain blocked', () => {
  assert.doesNotThrow(() => assertProfileContentSafe('    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")', 'fixture.py'));
  assert.doesNotThrow(() => assertProfileContentSafe('const token = process.env.GITHUB_TOKEN;', 'fixture.ts'));
  assert.doesNotThrow(() => assertProfileContentSafe("client.create(api_key=os.environ.get('API_KEY'),", 'fixture.py'));
  assert.throws(() => assertProfileContentSafe('api_key=os.getenv("API_KEY"), token="literal-secret-value"', 'fixture.py'), /Secret/);
  assert.throws(() => assertProfileContentSafe('token = os.getenv("TOKEN") or "literal-fallback-value"', 'fixture.py'), /Secret/);
  assert.doesNotThrow(() => assertProfileContentSafe('ApiKey = Environment.GetEnvironmentVariable("API_KEY")', 'fixture.cs'));
  assert.doesNotThrow(() => assertProfileContentSafe('"ghp_your_github_token"', 'example.md'));
  assert.throws(() => assertProfileContentSafe('"ghp_your_github_tokenX123"', 'fixture'), /Secret/);
  assert.throws(() => assertProfileContentSafe('token = "super-secret-actual-value"', 'fixture'), /Secret/);
  assert.throws(() => assertProfileContentSafe('token = os.getenv("TOKEN") or "sk-' + 'A'.repeat(30) + '"', 'fixture'), /Secret/);
});

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimeDevelopmentExclusions } from '../src/lib/plugin-capture-scope.js';

const roots: string[] = [];
it('excludes nested development directories unless a runtime reference requires them', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, 'mcp/test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mcp/test/contract.mjs'), 'ordinary test');
  assert.equal(runtimeDevelopmentExclusions(root)('mcp/test/contract.mjs'), true);
  fs.writeFileSync(path.join(root, 'dist/plugin.js'), "import '../mcp/test/contract.mjs';");
  assert.equal(runtimeDevelopmentExclusions(root)('mcp/test/contract.mjs'), false);
});
it('preserves relative runtime directory imports and their transitive source', () => {
  const root = fixture({ main: 'dist/plugin.cjs', files: ['dist'] });
  fs.writeFileSync(path.join(root, 'dist/plugin.cjs'), "require('../mcp/tests');");
  fs.mkdirSync(path.join(root, 'mcp/tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mcp/tests/index.js'), "require('../../src/required.ts');");
  const excluded = runtimeDevelopmentExclusions(root);
  assert.equal(excluded('mcp/tests/index.js'), false);
  assert.equal(excluded('src/required.ts'), false);
});
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
it('retains Python hook relative workers and transitive runtime directories', () => {
  const root = fixture();
  for (const dir of ['.codex-plugin', 'hooks', 'mcp/tests', 'src/runtime']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, '.codex-plugin/plugin.json'), JSON.stringify({ hooks: './hooks/run.py' }));
  fs.writeFileSync(path.join(root, 'hooks/run.py'), "worker = Path(__file__).parent / '../mcp/tests/worker.py'\nsubprocess.run([sys.executable, str(worker)])");
  fs.writeFileSync(path.join(root, 'mcp/tests/worker.py'), "runtime = Path(__file__).parent / '../../src/runtime'\n");
  fs.writeFileSync(path.join(root, 'src/runtime/worker.py'), 'ordinary runtime');
  const excluded = runtimeDevelopmentExclusions(root);
  assert.equal(excluded('mcp/tests/worker.py'), false);
  assert.equal(excluded('src/runtime/worker.py'), false);
});
function fixture(pkg: object = { main: 'dist/plugin.js', files: ['dist', 'skills'] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-runtime-scope-')); roots.push(root);
  for (const file of ['dist/plugin.js', 'src/development.ts', 'src/required.ts', 'src/transitive.ts', 'skills/hello/SKILL.md']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'ordinary runtime content');
  }
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  return root;
}
it('excludes src only when explicit package files and compiled main establish development scope', () => {
  const root = fixture();
  assert.equal(runtimeDevelopmentExclusions(root)('src/development.ts'), true);
  for (const pkg of [{ main: 'dist/plugin.js' }, { files: ['dist'] }, { main: 'src/required.ts', files: ['dist'] }, { main: 'dist/plugin.js', files: ['dist', 'src'] }, { main: 'dist/plugin.js', files: ['*'] }]) {
    assert.equal(runtimeDevelopmentExclusions(fixture(pkg))('src/development.ts'), false, JSON.stringify(pkg));
  }
});
it('preserves manifest and runtime source references together with transitive source dependencies', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, '.codex-plugin'));
  fs.writeFileSync(path.join(root, '.codex-plugin/plugin.json'), JSON.stringify({ hooks: './src/required.ts' }));
  fs.writeFileSync(path.join(root, 'src/required.ts'), "import './transitive.ts';");
  let excluded = runtimeDevelopmentExclusions(root);
  assert.equal(excluded('src/required.ts'), false); assert.equal(excluded('src/transitive.ts'), false);
  assert.equal(excluded('src/development.ts'), true);
  fs.rmSync(path.join(root, '.codex-plugin/plugin.json'));
  fs.writeFileSync(path.join(root, 'dist/plugin.js'), "import '../src/required.ts';");
  excluded = runtimeDevelopmentExclusions(root);
  assert.equal(excluded('src/required.ts'), false); assert.equal(excluded('src/transitive.ts'), false);
});
it('preserves package entrypoints and skill document references into src', () => {
  const root = fixture({ main: 'dist/plugin.js', files: ['dist', 'skills'], bin: { helper: 'src/required.ts' } });
  fs.writeFileSync(path.join(root, 'skills/hello/SKILL.md'), '[Required helper](../../src/transitive.ts)');
  const excluded = runtimeDevelopmentExclusions(root);
  assert.equal(excluded('src/required.ts'), false); assert.equal(excluded('src/transitive.ts'), false);
  assert.equal(excluded('src/development.ts'), true);
});
it('follows dependencies from a declared source directory and extensionless runtime imports', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, '.codex-plugin'));
  fs.mkdirSync(path.join(root, 'src/runtime'));
  fs.writeFileSync(path.join(root, '.codex-plugin/plugin.json'), JSON.stringify({ hooks: './src/runtime' }));
  fs.writeFileSync(path.join(root, 'src/runtime/hook.ts'), "import '../required';");
  fs.writeFileSync(path.join(root, 'src/required.ts'), "import './transitive.ts';");
  const excluded = runtimeDevelopmentExclusions(root);
  assert.equal(excluded('src/required.ts'), false); assert.equal(excluded('src/transitive.ts'), false);
  assert.equal(excluded('src/development.ts'), true);
});

import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { prepareCrystallize } from "../src/lib/crystallize.js";
import { scanForSecrets } from "../src/lib/secret-scan.js";

// Artificial credentials only. The old scanner skipped the complete marker line.
const marker = "<YOUR_API_KEY>";
const unsafe = marker + " sk-" + "UPGRADE_SYNTHETIC_".repeat(3);
const entry = { type: "cli-tool" as const, name: "upgrade-fixture", source: "fixture@1",
  installCommand: "fixture install", status: "success" as const, notes: "fixture", pitfalls: [] };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const statePath = "state/workspace-state.json";
const logPath = "state/install-log.json";
const journalPath = "state/crystallize-operation.json";
const guidePath = "guide/SYNC-GUIDE.md";

function fixture(t: TestContext) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "crystal-upgrade-"));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  const home = path.join(workspaceRoot, "home");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  t.mock.method(os, "homedir", () => home);
  let processCalls = 0;
  for (const method of ["execSync", "spawnSync"] as const) {
    t.mock.method(childProcess, method, () => { processCalls++; throw new Error("Unexpected external process"); });
  }
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const root = path.join(workspaceRoot, "usync-dotfiles");
  const input = { workspaceRoot, targetAgent: "codex" as const, entry };
  const eventKey = hash(JSON.stringify({ payload: JSON.stringify({ targetAgent: "codex", entry }), eventId: "", resumeEntryId: "" }));
  const snapshot = { timestamp: "2026-09-01T00:00:00Z", platform: "windows", hostname: "fixture",
    targetAgent: "codex", completeness: "complete", agents: { codex: { plugins: [], skills: [], mcp: [], config: {} } },
    envVars: [], submodules: [], skills: [], skillSources: [], windowsFixPaths: [] };
  const log = { version: "1.0", lastUpdated: snapshot.timestamp, entries: [{ ...entry, id: "legacy-entry",
    timestamp: snapshot.timestamp, platform: "windows", crystallizeEventKey: eventKey }] };
  const journal = { version: 1, eventKey, entryId: "legacy-entry", snapshot,
    artifacts: {} as Record<string, string> };
  const write = (relative: string, text: string) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const save = (overrides: Record<string, string> = {}) => {
    const contents = { [statePath]: JSON.stringify(snapshot, null, 2), [logPath]: JSON.stringify(log, null, 2),
      [guidePath]: "# Legacy safe guide\n", ...overrides };
    for (const [relative, text] of Object.entries(contents)) { write(relative, text); journal.artifacts[relative] = hash(text); }
    write(journalPath, JSON.stringify(journal, null, 2));
  };
  const bytes = (): Record<string, string> => {
    const result: Record<string, string> = {};
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isDirectory()) walk(file);
        else result[path.relative(root, file)] = fs.readFileSync(file).toString("base64");
      }
    };
    walk(root); return result;
  };
  return { input, journal, log, save, write, bytes, processCalls: () => processCalls };
}

test("upgrade fixture was accepted by the legacy marker guard and rejected by current scanning", () => {
  assert.match(unsafe, /<hidden>|<YOUR_[A-Z0-9_]+>/);
  assert.ok(scanForSecrets(unsafe).some(item => item.rule === "known-token-prefix"));
});

for (const location of ["snapshot", "journal", "state", "guide", "log", "extra-artifact"] as const) {
  test(`upgrade retry rejects a legacy credential in ${location} before any mutation or process`, t => {
    const f = fixture(t);
    const overrides: Record<string, string> = {};
    if (location === "snapshot") {
      overrides[statePath] = JSON.stringify(f.journal.snapshot, null, 2);
      Object.assign(f.journal.snapshot, { historicalNote: unsafe });
    }
    if (location === "journal") Object.assign(f.journal, { historicalNote: unsafe });
    if (location === "state") overrides[statePath] = JSON.stringify({ historicalNote: unsafe });
    if (location === "guide") overrides[guidePath] = "# Legacy guide\n" + unsafe;
    if (location === "log") f.log.entries[0].notes = unsafe;
    if (location === "extra-artifact") overrides["know-how/legacy.md"] = unsafe;
    f.save(overrides);
    const before = f.bytes();
    assert.throws(() => prepareCrystallize(f.input), /Secret scan blocked/);
    assert.deepEqual(f.bytes(), before);
    assert.equal(f.processCalls(), 0);
  });
}

test("safe legacy retry reuses byte-identical artifacts and its original entry", t => {
  const f = fixture(t);
  f.save({ [guidePath]: "# Placeholder-only guide\n" + marker });
  const before = f.bytes();
  const result = prepareCrystallize(f.input);
  assert.equal(result.reused, true);
  assert.equal(result.entryId, "legacy-entry");
  assert.deepEqual(f.bytes(), before);
  assert.equal(f.processCalls(), 0);
});

test("new event rejects unsafe existing history before journal or log mutation", t => {
  const f = fixture(t);
  f.log.entries[0].notes = unsafe;
  f.write(logPath, JSON.stringify(f.log, null, 2));
  const before = f.bytes();
  assert.throws(() => prepareCrystallize({ ...f.input, eventId: "new-event" }), /Secret scan blocked/);
  assert.deepEqual(f.bytes(), before);
  assert.equal(f.processCalls(), 0);
});

test("new event rejects unsafe old journal without replacing the old event", t => {
  const f = fixture(t);
  Object.assign(f.journal, { historicalNote: unsafe });
  f.save();
  const before = f.bytes();
  assert.throws(() => prepareCrystallize({ ...f.input, eventId: "new-event" }), /Secret scan blocked/);
  assert.deepEqual(f.bytes(), before);
  assert.equal(f.processCalls(), 0);
});

for (const notes of [unsafe, marker]) {
  test(`new event ${notes === unsafe ? "refuses mixed credential" : "accepts placeholder-only input"}`, t => {
    const f = fixture(t);
    const input = { ...f.input, entry: { ...entry, notes }, eventId: "new-event" };
    if (notes === unsafe) {
      const before = f.bytes();
      assert.throws(() => prepareCrystallize(input), /Secret scan blocked/);
      assert.deepEqual(f.bytes(), before);
    } else {
      const result = prepareCrystallize(input);
      assert.equal(result.reused, false);
      assert.equal(prepareCrystallize(input).entryId, result.entryId);
      assert.equal(prepareCrystallize(input).reused, true);
    }
    assert.equal(f.processCalls(), 0);
  });
}

const malformedManifests: Array<[string, (valid: Record<string, string>) => unknown]> = [
  ["null", () => null],
  ["array", () => []],
  ["string", () => "manifest"],
  ["boolean", () => false],
  ["number", () => 1],
  ["empty record", () => ({})],
  ...[statePath, logPath, guidePath].map(relative => [
    `missing ${relative}`, (valid: Record<string, string>) => {
      const partial = { ...valid };
      delete partial[relative];
      return partial;
    },
  ] as [string, (valid: Record<string, string>) => unknown]),
  ["non-hex digest", valid => ({ ...valid, [guidePath]: "z".repeat(64) })],
  ["short digest", valid => ({ ...valid, [guidePath]: "a".repeat(63) })],
  ["non-string digest", valid => ({ ...valid, [guidePath]: 42 })],
];

for (const [label, corrupt] of malformedManifests) {
  for (const eventId of [undefined, "new-event"]) {
    test(`${eventId ? "new event" : "retry"} rejects ${label} artifact manifest before mutation or process`, t => {
      const f = fixture(t);
      f.save();
      f.write(journalPath, JSON.stringify({ ...f.journal, artifacts: corrupt(f.journal.artifacts) }, null, 2));
      const before = f.bytes();
      assert.throws(() => prepareCrystallize({ ...f.input, eventId }), /Invalid crystallize artifact manifest/);
      assert.deepEqual(f.bytes(), before);
      assert.equal(f.processCalls(), 0);
    });
  }
}

test("safe Windows artifact paths remain reusable without mutation or process", t => {
  const f = fixture(t);
  f.save();
  const artifacts = Object.fromEntries(Object.entries(f.journal.artifacts).map(([relative, digest]) => [relative.replaceAll("/", "\\"), digest]));
  f.write(journalPath, JSON.stringify({ ...f.journal, artifacts }, null, 2));
  const before = f.bytes();
  assert.equal(prepareCrystallize(f.input).reused, true);
  assert.deepEqual(f.bytes(), before);
  assert.equal(f.processCalls(), 0);
});

test("interrupted preparation without an artifact manifest resumes and seals mandatory outputs", t => {
  const f = fixture(t);
  f.save();
  const { artifacts: _artifacts, ...incomplete } = f.journal;
  f.write(journalPath, JSON.stringify(incomplete, null, 2));
  const result = prepareCrystallize(f.input);
  assert.equal(result.entryId, "legacy-entry");
  for (const relative of [statePath, logPath, guidePath]) {
    assert.ok(result.artifactPaths.some(item => item.replaceAll("\\", "/") === relative));
  }
  const prepared = f.bytes();
  assert.equal(prepareCrystallize(f.input).reused, true);
  assert.deepEqual(f.bytes(), prepared);
  assert.equal(f.processCalls(), 0);
});

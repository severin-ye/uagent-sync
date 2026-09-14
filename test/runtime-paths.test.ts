import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadKnownMcps } from "../src/lib/guide.js";
import { OpencodeSyncPlugin } from "../src/plugin.js";

test("bundled MCP data resolves without a workspace copy on supported runtimes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-paths-"));
  try { assert.ok(Object.keys(loadKnownMcps(root).mcpServers).length > 0); }
  finally { fs.rmSync(root, {recursive: true, force: true}); }
});
test("plugin config locates bundled skills and is idempotent on supported runtimes", async () => {
  const plugin = await OpencodeSyncPlugin({} as never);
  const cfg: any = {};
  await plugin.config!(cfg);
  await plugin.config!(cfg);
  assert.equal(cfg.skills.paths.length, 1);
  assert.ok(fs.existsSync(path.join(cfg.skills.paths[0], "uagent-sync-backup", "SKILL.md")));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("subcommand help never performs export or changes saved state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usync-cli-help-"));
  try {
    const home = path.join(root, "home");
    const state = path.join(root, "usync-dotfiles", "state", "workspace-state.json");
    fs.mkdirSync(home);
    fs.mkdirSync(path.dirname(state), { recursive: true });
    fs.writeFileSync(path.join(root, ".gitmodules"), "");
    fs.writeFileSync(state, "Existing user state\n");
    for (const flag of ["--help", "-h"]) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL("../src/cli.ts", import.meta.url)), "export", flag], {
        env: { ...process.env, NODE_OPTIONS: "--import tsx", HOME: home, USERPROFILE: home, OPENCODE_SYNC_WORKSPACE_ROOT: root, UAGENT_SYNC_LANG: "en" }, encoding: "utf8", timeout: 20_000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(state, "utf8"), "Existing user state\n");
      assert.doesNotMatch(result.stdout, /Exported:/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

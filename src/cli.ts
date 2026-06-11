#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import {
  exportSystemState, importSystemState, diffState, resolveWorkspaceRoot, run,
  type WorkspaceState,
} from "./sync.js";

function log(msg: string) { console.error(`[opencode-sync] ${msg}`); }

function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  if (!command) { console.log("Usage: node dist/cli.js <export|import|diff|push|pull> [options]"); process.exit(1); }
  const workspaceRoot = resolveWorkspaceRoot();
  const stateRel = "opencode-dotfiles/state/workspace-state.json";
  const stateFile = path.join(workspaceRoot, stateRel);

  switch (command) {
    case "export": {
      const out = args[0] || stateFile;
      const state = exportSystemState(workspaceRoot);
      fs.writeFileSync(out, JSON.stringify(state, null, 2));
      log(`Exported: ${out}`);
      log(`  Submodules: ${state.submodules.length}`);
      log(`  Skills: ${state.skills.length}`);
      break;
    }
    case "import": {
      const src = args.find(a => !a.startsWith("-")) || stateFile;
      const state = JSON.parse(fs.readFileSync(src, "utf-8")) as WorkspaceState;
      const result = importSystemState(workspaceRoot, state);
      for (const msg of result.messages) log(msg);
      break;
    }
    case "diff": {
      const src = args.find(a => !a.startsWith("-")) || stateFile;
      const current = exportSystemState(workspaceRoot);
      const saved = JSON.parse(fs.readFileSync(src, "utf-8")) as WorkspaceState;
      const diffs = diffState(current, saved);
      diffs.length === 0 ? log("No differences") : diffs.forEach(d => log(d));
      break;
    }
    case "push": {
      const state = exportSystemState(workspaceRoot);
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      log("Exported state");
      const msgIdx = args.indexOf("--message") + 1 || args.indexOf("-m") + 1;
      const commitMsg = msgIdx > 0 ? args[msgIdx] : `Update workspace state ${new Date().toISOString().slice(0, 19)}`;
      const tmpFile = path.join(workspaceRoot, "opencode-dotfiles", "state", ".commit-msg.tmp");
      fs.writeFileSync(tmpFile, commitMsg, "utf-8");
      run(`git add ${stateRel}`, workspaceRoot);
      const commit = run(`git commit -F "${tmpFile}"`, workspaceRoot);
      if (commit.code !== 0) log(`Commit: ${commit.stderr || "nothing to commit"}`);
      try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
      run("git push", workspaceRoot);
      log("Pushed to remote");
      break;
    }
    case "pull": {
      run("git pull", workspaceRoot);
      if (!fs.existsSync(stateFile)) { log(`No ${stateRel} found after pull`); process.exit(0); }
      const state = JSON.parse(fs.readFileSync(stateFile, "utf-8")) as WorkspaceState;
      const result = importSystemState(workspaceRoot, state);
      for (const msg of result.messages) log(msg);
      break;
    }
    default: console.error(`Unknown command: ${command}`); process.exit(1);
  }
}

main();

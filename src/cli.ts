#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import {
  exportSystemState, importSystemState, diffState, resolveWorkspaceRoot, run,
  type WorkspaceState,
} from "./sync.js";
import { updateExtensions, archiveUpdateReport, type UpdateComponent, type UpdateProgress } from "./lib/update.js";

function log(msg: string) { console.error(`[opencode-sync] ${msg}`); }

const ICON: Record<string, string> = { ok: "✅", warning: "⚠️", error: "❌", skipped: "⏭️" };

function formatProgress(ev: UpdateProgress): string {
  switch (ev.type) {
    case "plan":
      return `计划更新 ${ev.steps.length} 步:\n${ev.steps.map((s, i) => `  ${i + 1}. ${s.name} — ${s.command}${s.cwd ? ` (in ${s.cwd})` : ""}`).join("\n")}`;
    case "step-start":
      return `▶ [${ev.index}/${ev.total}] ${ev.name} — ${ev.command}${ev.cwd ? ` (in ${ev.cwd})` : ""}`;
    case "output":
      return `    ${ev.line}`;
    case "step-end": {
      const ver = ev.versionBefore && ev.versionAfter && ev.versionBefore !== ev.versionAfter
        ? `\n    ${ev.versionBefore} → ${ev.versionAfter}` : "";
      return `${ICON[ev.status]} ${ev.name} (${Math.round(ev.durationMs / 1000)}s)${ver}`;
    }
    case "done":
      return `完成: ${ev.summary.ok} ok / ${ev.summary.warning} warning / ${ev.summary.error} error / ${ev.summary.skipped} skipped`;
  }
}

function parseComponents(raw: string | undefined): UpdateComponent[] | undefined {
  if (!raw) return undefined;
  const known = new Set<UpdateComponent>(["opencode", "plugins", "skills", "mcp", "sync", "config-deps"]);
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean) as UpdateComponent[];
  const invalid = parts.filter((p) => !known.has(p));
  if (invalid.length > 0) {
    console.error(`Unknown component(s): ${invalid.join(", ")}. Valid: ${[...known].join(", ")}`);
    process.exit(1);
  }
  return parts;
}

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  if (!command) { console.log("Usage: node dist/cli.js <export|import|diff|push|pull|update> [options]"); process.exit(1); }
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
    case "update": {
      const compIdx = args.indexOf("--components");
      const components = parseComponents(compIdx >= 0 ? args[compIdx + 1] : undefined);
      const dryRun = args.includes("--dry-run");
      console.log(dryRun ? "[dry-run] 仅预览，不执行任何命令" : "开始更新 opencode 生态组件…");
      const report = await updateExtensions({ components, dryRun, onProgress: (ev) => console.log(formatProgress(ev)) });
      const reportFile = archiveUpdateReport(workspaceRoot, report);
      console.log(`\n完整报告已存档: ${reportFile}`);
      process.exit(report.summary.error > 0 ? 1 : 0);
    }
    case "changelog": {
      // 打印最新更新报告中的变更证据，供分类归档（agent 生成 CHANGELOG-extensions.md）
      const reportsDir = path.join(workspaceRoot, "opencode-dotfiles", "state", "update-reports");
      const latest = path.join(reportsDir, "update-report.json");
      if (!fs.existsSync(latest)) { console.error("No update report found. Run: node dist/cli.js update"); process.exit(1); }
      const report = JSON.parse(fs.readFileSync(latest, "utf-8")) as import("./lib/update.js").UpdateReport;
      console.log(`报告时间: ${report.timestamp}（dry-run: ${report.dryRun}）`);
      for (const s of report.steps) {
        const ver = s.versionBefore && s.versionAfter && s.versionBefore !== s.versionAfter
          ? ` ${s.versionBefore} → ${s.versionAfter}` : "";
        console.log(`\n## ${s.name}${ver} [${s.status}]`);
        if (s.evidence && s.evidence.length > 0) {
          for (const e of s.evidence) console.log(`  - ${e}`);
        } else {
          console.log("  （无变更证据）");
        }
      }
      break;
    }
    default: console.error(`Unknown command: ${command}`); process.exit(1);
  }
}

main();

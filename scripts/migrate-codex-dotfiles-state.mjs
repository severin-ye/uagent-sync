import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dotfilesRoot = path.resolve(process.argv[2] ?? "");
const homeDir = path.resolve(process.argv[3] ?? os.homedir());
if (!dotfilesRoot || !fs.existsSync(dotfilesRoot)) throw new Error("Usage: node scripts/migrate-codex-dotfiles-state.mjs <dotfiles-root> [home-dir]");

const skillsManifestPath = path.join(dotfilesRoot, "agents", "codex", "manifests", "skills.json");
const skillLockPath = path.join(homeDir, ".agents", ".skill-lock.json");
const selected = JSON.parse(fs.readFileSync(skillsManifestPath, "utf-8"));
const lock = JSON.parse(fs.readFileSync(skillLockPath, "utf-8")).skills ?? {};
const explicitSources = { "agent-reach": "https://github.com/Panniantong/Agent-Reach.git" };
const explicitlyDeletedSkills = new Set(["agent-browser", "brand-extract"]);
const skills = [];
const missing = [];
for (const entry of selected) {
  const name = entry.id ?? entry.name;
  if (explicitlyDeletedSkills.has(name)) continue;
  const locked = lock[name];
  const source = locked?.sourceUrl ?? locked?.source ?? explicitSources[name] ?? entry.source;
  if (!source) { missing.push(name); continue; }
  skills.push({ kind: "skill", id: name, source, path: locked?.skillPath ?? entry.path ?? "SKILL.md", version: locked?.skillFolderHash ?? entry.version });
}

const tombstones = [
  { kind: "mcp", id: "codebase-memory-mcp", deletedAt: "2026-08-23T00:00:00.000Z", reason: "Explicitly and permanently removed by user" },
  { kind: "mcp", id: "gpt-dotfiles-sync", deletedAt: "2026-08-14T12:40:25.650Z", reason: "Retired; superseded by uagent-sync v2" },
  { kind: "skill", id: "agent-browser", deletedAt: "2026-08-23T00:00:00.000Z", reason: "Stale manifest entry; no installed SKILL.md or trusted source" },
  { kind: "skill", id: "brand-extract", deletedAt: "2026-08-23T00:00:00.000Z", reason: "Stale manifest entry; no installed SKILL.md or trusted source" },
];
const state = {
  schemaVersion: 2, targetAgent: "codex", completeness: missing.length ? "partial" : "complete",
  timestamp: new Date().toISOString(), platform: "windows", hostname: "<source-machine>",
  sourceMachine: { username: "<redacted>", homePathIncluded: false },
  agents: { codex: {
    plugins: [{ kind: "plugin", id: "uagent-sync", source: "https://github.com/severin-ye/uagent-sync", version: "2.1.0", config: { marketplace: "uagent-sync" } }],
    skills,
    mcp: [{ kind: "mcp", id: "node_repl", source: "codex-runtime", config: { managedBy: "codex-runtime" } }],
    config: { configFile: ".codex/config.toml", mergePolicy: "preserve-existing", secretValuesIncluded: false },
  } },
  tombstones, secretRequirements: [], envVars: [], submodules: [], skills: skills.map((item) => item.id),
  skillSources: [...new Set(skills.map((item) => item.source))], windowsFixPaths: [], missingSources: missing,
};
const output = path.join(dotfilesRoot, "state", "workspace-state.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(state, null, 2)}\n`);
fs.writeFileSync(path.join(dotfilesRoot, "state", "extension-tombstones.json"), `${JSON.stringify(tombstones, null, 2)}\n`);
fs.writeFileSync(skillsManifestPath, `${JSON.stringify(skills, null, 2)}\n`);
fs.writeFileSync(path.join(dotfilesRoot, "agents", "codex", "manifests", "mcp.json"), `${JSON.stringify(state.agents.codex.mcp, null, 2)}\n`);
fs.writeFileSync(path.join(dotfilesRoot, "agents", "codex", "manifests", "plugins.json"), `${JSON.stringify(state.agents.codex.plugins, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: missing.length === 0, output, skillCount: skills.length, missing })}\n`);
if (missing.length) process.exitCode = 1;

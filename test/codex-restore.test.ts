import { describe, it } from "node:test";
import * as assert from "node:assert";
import { restoreCodexExtensions } from "../dist/lib/codex-restore.js";

describe("Codex extension restoration", () => {
  it("restores only selected portable entries and applies tombstones first", () => {
    const commands: string[][] = [];
    const result = restoreCodexExtensions({
      targetAgent: "codex",
      selected: [
        { kind: "skill", id: "portable", source: "https://github.com/acme/skills.git", path: "skills/portable/SKILL.md", version: "abc123" },
        { kind: "mcp", id: "node_repl", source: "npm:@openai/node-repl-mcp", config: { command: "npx", args: ["-y", "@openai/node-repl-mcp"] } },
        { kind: "mcp", id: "codebase-memory-mcp", source: "https://example.invalid/stale" },
      ],
      installed: [],
      tombstones: [{ kind: "mcp", id: "codebase-memory-mcp", deletedAt: "2026-08-23T00:00:00Z" }],
      execute: (file, args) => { commands.push([file, ...args]); return { code: 0, stdout: "", stderr: "" }; },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(commands.some((item) => item.join(" ").includes("skills add https://github.com/acme/skills.git")));
    assert.ok(commands.some((item) => item.join(" ").includes("codex mcp add node_repl -- npx -y @openai/node-repl-mcp")));
    assert.ok(commands.some((item) => item.join(" ") === "codex mcp remove codebase-memory-mcp"));
    assert.ok(!commands.some((item) => item.join(" ").includes("example.invalid")));
  });

  it("reports missing sources and secret-bearing MCP configuration as errors", () => {
    const result = restoreCodexExtensions({
      targetAgent: "codex",
      selected: [
        { kind: "skill", id: "orphan" },
        { kind: "mcp", id: "unsafe", source: "npm:unsafe", config: { command: "unsafe", env: { TOKEN: "real-value" } } },
        { kind: "mcp", id: "needs-local-env", source: "npm:needs-local-env", config: { command: "needs-local-env", envVars: ["LOCAL_MCP_TOKEN"] } },
      ],
      installed: [], tombstones: [],
      execute: () => ({ code: 0, stdout: "", stderr: "" }),
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.includes("orphan")));
    assert.ok(result.errors.some((item) => item.includes("unsafe")));
    assert.ok(result.errors.some((item) => item.includes("LOCAL_MCP_TOKEN")));
  });

  it("restores a remote MCP bearer token by environment-variable name only", () => {
    const commands: string[][] = [];
    const result = restoreCodexExtensions({
      targetAgent: "codex",
      selected: [{ kind: "mcp", id: "remote", source: "https://mcp.example.invalid", config: { url: "https://mcp.example.invalid", bearerTokenEnvVar: "REMOTE_MCP_TOKEN" } }],
      installed: [], tombstones: [],
      execute: (file, args) => { commands.push([file, ...args]); return { code: 0, stdout: "", stderr: "" }; },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(commands.some((command) => command.join(" ") === "codex mcp add remote --url https://mcp.example.invalid --bearer-token-env-var REMOTE_MCP_TOKEN"));
  });

  it("treats an unconfirmed tombstone removal as a required error", () => {
    const result = restoreCodexExtensions({
      targetAgent: "codex", selected: [], installed: [],
      tombstones: [{ kind: "mcp", id: "codebase-memory-mcp", deletedAt: "2026-08-23T00:00:00Z" }],
      execute: () => ({ code: 1, stdout: "", stderr: "permission denied" }),
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.includes("codebase-memory-mcp")));
  });
});

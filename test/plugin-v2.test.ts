import { test } from "node:test";
import assert from "node:assert/strict";
import { tool } from "@opencode-ai/plugin";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import legacyPlugin from "../dist/plugin.js";
import plugin from "../dist/plugin-v2/index.js";

test("v2 registers the existing tools and packaged skills without executing a tool", async () => {
  const tools: any[] = [];
  const skills: any[] = [];
  await plugin.setup({
    tool: { transform: async (apply: any) => apply({ add: (item: any) => tools.push(item) }) },
    skill: { transform: async (apply: any) => apply({ add: (item: any) => skills.push(item) }) },
  });
  const legacy = await legacyPlugin({} as any);
  assert.deepEqual(tools.map(x => x.name).sort(), Object.keys(legacy.tool!).sort());
  assert.equal(tools.length, 16);
  for (const entry of tools) {
    const schema = tool.schema.object(legacy.tool![entry.name].args);
    assert.deepEqual(entry.input, tool.schema.toJSONSchema(schema, { io: "input" }));
    assert.equal(entry.input.type, "object");
  }
  const packagedSkills = fs.readdirSync(new URL("../skills/", import.meta.url)).filter(name => name.startsWith("uagent-sync-"));
  assert.deepEqual(skills.map(s => s.id).sort(), packagedSkills.sort());
  assert.ok(skills.every(s => s.id.startsWith("uagent-sync-") && s.path.endsWith("SKILL.md") && s.content));
});

test("v2 validates input and maps legacy output without changing business behavior", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-plugin-v2-"));
  const previousWorkspace = process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
  t.after(() => {
    if (previousWorkspace === undefined) delete process.env.OPENCODE_SYNC_WORKSPACE_ROOT;
    else process.env.OPENCODE_SYNC_WORKSPACE_ROOT = previousWorkspace;
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(workspace, ".gitmodules"), "");
  process.env.OPENCODE_SYNC_WORKSPACE_ROOT = workspace;
  const tools: any[] = [];
  await plugin.setup({
    tool: { transform: async (apply: any) => apply({ add: (item: any) => tools.push(item) }) },
    skill: { transform: async () => {} },
  });
  const diff = tools.find(x => x.name === "opencode_sync_diff");
  await assert.rejects(() => diff.execute({}), /source/);
  const changelog = tools.find(x => x.name === "opencode_sync_changelog");
  const result = await changelog.execute({ reportPath: path.join(workspace, "missing-report.json") });
  assert.match(result.content, /^No update report found:/);
  assert.equal(result.title, "opencode-sync");
});

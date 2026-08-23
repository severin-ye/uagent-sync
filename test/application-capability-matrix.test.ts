import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { exportWorkspace } from "../src/application/export-workspace.js";
import { importWorkspace } from "../src/application/import-workspace.js";
import { pullWorkspace } from "../src/application/pull-workspace.js";
import { pushWorkspace } from "../src/application/push-workspace.js";
import { setupWorkspace } from "../src/application/setup-workspace.js";
import { updateWorkspace } from "../src/application/update-workspace.js";
import { verifyWorkspace } from "../src/application/verify-workspace.js";
import type { TargetAgent, WorkspaceState, WorkspaceStateV3 } from "../src/lib/types.js";

const operations = ["verify", "export", "import", "setup", "update", "push", "pull"] as const;
const targets = ["codex", "opencode", "dsh", "all"] as const satisfies readonly TargetAgent[];

function state(targetAgent: TargetAgent): WorkspaceStateV3 {
  return {
    schemaVersion: 3, timestamp: "2026-08-23T00:00:00.000Z", platform: "win32", hostname: "fixture", targetAgent,
    submodules: [], skills: [], envVars: [], agents: {}, tombstones: [],
  } as WorkspaceStateV3;
}

describe("Application operation x target capability gate", () => {
  test("publishes the complete 7 operations x 4 targets matrix", async () => {
    const module = await import("../src/application/workspace-operation-capabilities.js").catch(() => null) as null | {
      preflightWorkspaceOperation?: (operation: typeof operations[number], target: TargetAgent) => { supported: boolean; error?: string };
    };
    assert.ok(module?.preflightWorkspaceOperation, "a shared operation capability gate must exist");
    for (const operation of operations) for (const target of targets) {
      const capability = module.preflightWorkspaceOperation(operation, target);
      assert.equal(capability.supported, target === "codex" || target === "opencode", `${operation}/${target}`);
      if (!capability.supported) assert.match(capability.error ?? "", new RegExp(`unsupported.*${operation}.*targetAgent=${target}`, "i"));
    }
  });

  test("every unsupported operation fails closed before invoking any dependency", async () => {
    for (const targetAgent of ["dsh", "all"] as const) for (const operation of operations) {
      let calls = 0;
      const count = <T>(value: T): T => { calls += 1; return value; };
      const fileSystem = {
        exists: () => count(true), joinPath: (...parts: string[]) => count(parts.join("/")),
        readText: () => count(JSON.stringify(state(targetAgent))), writeText: () => { count(undefined); },
      };
      const git = { run: () => count({ code: 0, stdout: "", stderr: "" }), probeStagedChanges: () => count({ code: 0, stdout: "", stderr: "" }) };
      let failed = false;
      try {
        switch (operation) {
          case "verify": failed = !verifyWorkspace({ workspaceRoot: "C:/workspace", targetAgent, verifier: () => count([]) }).ok; break;
          case "export": exportWorkspace({ workspaceRoot: "C:/workspace", outputPath: "state.json", targetAgent }, { fileSystem, exportState: () => count(state(targetAgent) as unknown as WorkspaceState), assertNoSecrets: () => { count(undefined); } }); break;
          case "import": failed = !(importWorkspace({ workspaceRoot: "C:/workspace", targetAgent, artifact: state(targetAgent) }, { parseArtifact: () => count(state(targetAgent)), importState: () => count({ success: true, messages: [] }), exportState: () => count(state(targetAgent) as unknown as WorkspaceState), diffState: () => count([]) }) as unknown as { ok: boolean }).ok; break;
          case "setup": failed = !setupWorkspace({ workspaceRoot: "C:/workspace", targetAgent }, { setup: () => count([]) }).ok; break;
          case "update": failed = !(await updateWorkspace({ workspaceRoot: "C:/workspace", targetAgent, onProgress: () => { count(undefined); } }, { update: async () => count({ timestamp: "now", dryRun: true, targetAgent, components: [], steps: [], summary: { ok: 0, warning: 0, error: 0, skipped: 0 }, text: "" }) })).ok; break;
          case "push": failed = !pushWorkspace({ workspaceRoot: "C:/workspace", targetAgent }, { fileSystem, git, exportState: () => count(state(targetAgent) as unknown as WorkspaceState), assertNoSecrets: () => { count(undefined); } }).ok; break;
          case "pull": failed = !pullWorkspace({ workspaceRoot: "C:/workspace", targetAgent }, { fileSystem, git, parseArtifact: () => count(state(targetAgent)), importState: () => count({ success: true, messages: [] }), exportState: () => count(state(targetAgent) as unknown as WorkspaceState), diffState: () => count([]) }).ok; break;
        }
      } catch (error) {
        failed = true;
        assert.match(error instanceof Error ? error.message : String(error), new RegExp(`unsupported.*${operation}.*targetAgent=${targetAgent}`, "i"));
      }
      assert.equal(failed, true, `${operation}/${targetAgent} must fail closed`);
      assert.equal(calls, 0, `${operation}/${targetAgent} must not invoke dependencies`);
    }
  });
});

import type { TargetAgent } from "../../lib/types.js";

type JsonObject = Record<string, unknown>;

const TARGET_AGENTS = new Set<TargetAgent>(["codex", "opencode", "dsh", "all"]);

function inferTargetAgent(input: JsonObject): TargetAgent {
  if (TARGET_AGENTS.has(input.targetAgent as TargetAgent)) return input.targetAgent as TargetAgent;

  if (input.agents && typeof input.agents === "object" && !Array.isArray(input.agents)) {
    const present = ["codex", "opencode", "dsh"].filter((id) => id in (input.agents as JsonObject));
    if (present.length === 1) return present[0] as Exclude<TargetAgent, "all">;
    if (present.length > 1) return "all";
  }

  return "opencode";
}

export function migrateWorkspaceStateV2ToV3(input: JsonObject): JsonObject {
  return {
    ...input,
    schemaVersion: 3,
    targetAgent: inferTargetAgent(input),
  };
}

import type { AgentAdapter } from "../../ports/agent-adapter.js";
import { scanCodex } from "../../lib/adapters/codex.js";

export const codexAdapter = {
  id: "codex",
  scan: scanCodex,
} satisfies AgentAdapter;

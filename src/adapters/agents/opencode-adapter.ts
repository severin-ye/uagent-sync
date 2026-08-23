import type { AgentAdapter } from "../../ports/agent-adapter.js";
import { scanOpenCode } from "../../lib/adapters/opencode.js";

export const opencodeAdapter = {
  id: "opencode",
  scan: scanOpenCode,
} satisfies AgentAdapter;

import type { AgentAdapter } from "../../ports/agent-adapter.js";
import { scanDeepSeek } from "../../lib/adapters/deepseek.js";

export const deepseekAdapter = {
  id: "deepseek",
  scan: scanDeepSeek,
} satisfies AgentAdapter;

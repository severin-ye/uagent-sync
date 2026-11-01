import { z } from "zod";

/** Structural v1 tool contract. OpenCode consumes the definition directly;
 * its SDK constructor is identity-only, so no host SDK runtime is needed. */
export interface ToolContext {
  sessionID: string;
  messageID: string;
  agent: string;
  directory: string;
  worktree: string;
  abort: AbortSignal;
  metadata(input: { title?: string; metadata?: Record<string, unknown> }): void;
  ask(input: { permission: string; patterns: string[]; always: string[]; metadata: Record<string, unknown> }): Promise<void>;
}
export type ToolResult = string | {
  title?: string;
  output: string;
  metadata?: Record<string, unknown>;
  attachments?: Array<{ type: "file"; mime: string; url: string; filename?: string }>;
};
export function tool<Args extends z.ZodRawShape>(input: {
  description: string;
  args: Args;
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<ToolResult>;
}) {
  return input;
}
export namespace tool {
  export const schema = z;
}

/** Erased shape for enumerating heterogeneous definitions at the v2 boundary. */
export interface ToolDefinition {
  description: string;
  args: z.ZodRawShape;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export interface PluginHooks {
  config?(config: { skills?: { paths?: string[] } }): Promise<void>;
  tool?: Record<string, ToolDefinition>;
}
/** The factory does not depend on host input; keep optional host options accepted. */
export type Plugin = (input: unknown, options?: Record<string, unknown>) => Promise<PluginHooks>;

import * as crypto from "node:crypto";
import type { ActionValue, AgentId, ImplementationAction } from "./types.js";

export interface SingleAgentAnalysisContext {
  mode: "single_agent";
  agent: AgentId;
}

export interface CrossAgentAnalysisContext {
  mode: "cross_agent";
  from: AgentId;
  to: AgentId;
}

export type AnalysisContext = SingleAgentAnalysisContext | CrossAgentAnalysisContext;
export type AnalysisContextInput = Partial<SingleAgentAnalysisContext & CrossAgentAnalysisContext> & Record<string, unknown>;

const AGENTS = new Set<AgentId>(["codex", "opencode", "deepseek"]);

function agentId(value: unknown): AgentId | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return AGENTS.has(normalized as AgentId) ? normalized as AgentId : undefined;
}

function modeOf(value: unknown): unknown {
  if (value === "single-agent") return "single_agent";
  if (value === "cross-agent") return "cross_agent";
  return value;
}

/** Parse and validate an explicit analysis scope. */
export function parseAnalysisContext(input: unknown): AnalysisContext {
  if (!input || typeof input !== "object") throw new Error("scope_required");
  const value = input as Record<string, unknown>;
  const mode = modeOf(value.mode);

  if (mode === "single_agent") {
    const agent = agentId(value.agent ?? value.from);
    if (!agent) throw new Error("scope_required");
    const to = agentId(value.to);
    if (to && agent === to) throw new Error("same_agent");
    return { mode, agent };
  }

  if (mode === "cross_agent") {
    const from = agentId(value.from ?? value.source);
    const to = agentId(value.to ?? value.target);
    if (!from || !to) throw new Error("scope_required");
    if (from === to) throw new Error("same_agent");
    return { mode, from, to };
  }

  throw new Error("scope_required");
}

export function contextKey(contextInput: AnalysisContext | unknown): string {
  const context = parseAnalysisContext(contextInput);
  return context.mode === "single_agent" ? `single_agent:${context.agent}` : `cross_agent:${context.from}:${context.to}`;
}

export function contextHash(context: AnalysisContext): string {
  return crypto.createHash("sha256").update(contextKey(context)).digest("hex");
}

const SINGLE_CODEX_ACTIONS: ActionValue[] = ["keep_enabled", "disable_in_agent", "defer"];
const SINGLE_READ_ONLY_ACTIONS: ActionValue[] = ["keep_enabled", "defer"];
const CROSS_AGENT_ACTIONS: ActionValue[] = ["migrate_source", "reuse_target", "keep_both", "defer"];

/** Return the one action vocabulary used by scan, preview, and public helpers. */
export function actionForContext(contextInput: AnalysisContext | unknown, implementationId: string): ImplementationAction {
  const context = parseAnalysisContext(contextInput);
  const allowed = context.mode === "cross_agent"
    ? CROSS_AGENT_ACTIONS
    : context.agent === "codex" ? SINGLE_CODEX_ACTIONS : SINGLE_READ_ONLY_ACTIONS;
  return { implementationId, recommendation: "defer", allowed: [...allowed] };
}

/** Compatibility export: all non-disable decisions available across contexts. */
export const BASE_ACTIONS: ActionValue[] = ["migrate_source", "reuse_target", "keep_both", "defer"];
export type ContextAction = ImplementationAction;

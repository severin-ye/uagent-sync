import * as fs from "node:fs";
import * as path from "node:path";
import type { InitState, InitType } from "./types.js";

const INIT_STATE_RELATIVE = "opencode-dotfiles/state/init-state.json";

export function emptyInitState(): InitState {
  return { initialized: false, initType: "backup", workspaceName: "", githubUrl: "", githubRepoPrivate: true, completedSteps: {}, firstInitAt: "", lastInitAt: "" };
}

export function readInitState(workspaceRoot: string): InitState {
  const statePath = path.join(workspaceRoot, INIT_STATE_RELATIVE);
  if (!fs.existsSync(statePath)) return emptyInitState();
  try { return JSON.parse(fs.readFileSync(statePath, "utf-8")) as InitState; }
  catch { return emptyInitState(); }
}

export function writeInitState(workspaceRoot: string, state: InitState): void {
  const statePath = path.join(workspaceRoot, INIT_STATE_RELATIVE);
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.lastInitAt = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function markStepCompleted(workspaceRoot: string, step: string, extra?: Partial<InitState>): InitState {
  const state = readInitState(workspaceRoot);
  if (!state.firstInitAt) state.firstInitAt = new Date().toISOString();
  state.completedSteps[step] = true;
  if (extra) Object.assign(state, extra);
  writeInitState(workspaceRoot, state);
  return state;
}

export function pendingSteps(state: InitState): string[] {
  const allSteps = ["workspace_detected", "workspace_confirmed", "gh_authenticated", "repo_created", "api_keys_generated", "dependencies_installed", "state_exported", "guide_generated", "state_pushed"];
  return allSteps.filter(s => !state.completedSteps[s]);
}

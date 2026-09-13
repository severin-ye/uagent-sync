import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { exportSystemState } from "./state.js";
import { generateSyncGuide } from "./guide.js";
import { appendInstallEntry } from "./log.js";
import { assertNoSecrets } from "./secret-scan.js";
import { DOTFILES_DIR } from "./dotfiles.js";
import type { InstallEntry, InstallLog, TargetAgent, WorkspaceState } from "./types.js";

type EntryInput = Omit<InstallEntry, "id" | "timestamp" | "platform">;
interface Journal {
  version: 1;
  eventKey: string;
  entryId?: string;
  snapshot: WorkspaceState;
  guideBaseline?: Record<string, string>;
  artifacts?: Record<string, string>;
}

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function guideFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (relative: string): void => {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) return;
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`Refusing linked output path: ${relative}`);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) walk(path.join(relative, name));
    else if (relative !== "guide" && relative !== "know-how") files[relative] = digest(fs.readFileSync(file, "utf8"));
  };
  walk("guide");
  walk("know-how");
  return files;
}

function atomicJson(file: string, value: unknown): void {
  const text = JSON.stringify(value, null, 2);
  assertNoSecrets(text, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

/** Prepare artifacts once per installation event; Git delivery can then resume independently. */
export function prepareCrystallize(input: {
  workspaceRoot: string; targetAgent: TargetAgent; entry: EntryInput;
  eventId?: string; resumeEntryId?: string;
}): { entryId: string; state: WorkspaceState; stateFile: string; guidePath: string; reused: boolean; artifactPaths: string[] } {
  const { workspaceRoot, targetAgent, entry } = input;
  if (targetAgent !== "codex" && targetAgent !== "opencode") throw new Error(`Crystallize does not support target ${targetAgent}`);
  const root = path.join(workspaceRoot, DOTFILES_DIR);
  const logFile = path.join(root, "state/install-log.json");
  const stateFile = path.join(root, "state/workspace-state.json");
  const journalFile = path.join(root, "state/crystallize-operation.json");
  const guidePath = path.join(root, "guide/SYNC-GUIDE.md");
  // Do not use the permissive legacy log reader: a malformed history must never be replaced.
  const log = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, "utf8")) as InstallLog : { entries: [] };
  if (!Array.isArray(log.entries) || log.entries.some(item => !item || typeof item.id !== "string")) throw new Error(`Invalid installation history: ${logFile}`);
  const payload = JSON.stringify({ targetAgent, entry });
  assertNoSecrets(payload, logFile);
  const eventKey = digest(JSON.stringify({ payload, eventId: input.eventId ?? "", resumeEntryId: input.resumeEntryId ?? "" }));
  let existing = log.entries.find(item => (item as InstallEntry & { crystallizeEventKey?: string }).crystallizeEventKey === eventKey);
  if (input.resumeEntryId) {
    existing = log.entries.find(item => item.id === input.resumeEntryId);
    if (!existing || existing.type !== entry.type || existing.name !== entry.name || existing.source !== entry.source || existing.status !== entry.status) {
      throw new Error("Resume entry must exist and match the installation type, name, source and status");
    }
  }
  let journal: Journal | undefined;
  if (fs.existsSync(journalFile)) {
    const saved = JSON.parse(fs.readFileSync(journalFile, "utf8")) as Journal;
    if (saved.version !== 1 || typeof saved.eventKey !== "string" || !saved.snapshot) throw new Error("Invalid crystallize operation journal");
    if (saved.eventKey === eventKey) journal = saved;
  }
  if (journal?.artifacts && existing && journal.entryId === existing.id) {
    for (const [relative, hash] of Object.entries(journal.artifacts)) {
      const file = path.resolve(root, relative);
      if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file) || digest(fs.readFileSync(file, "utf8")) !== hash) {
        throw new Error(`Crystallize retry refused: prepared artifact changed: ${relative}. Preserve/reconcile it before retrying, or use a new --event-id.`);
      }
    }
    return { entryId: existing.id, state: journal.snapshot, stateFile, guidePath, reused: true, artifactPaths: [...Object.keys(journal.artifacts), "state/crystallize-operation.json"] };
  }
  // Validate the full requested snapshot before recording success for the installation.
  journal ??= { version: 1, eventKey, snapshot: exportSystemState(workspaceRoot, { targetAgent }), guideBaseline: guideFiles(root) };
  assertNoSecrets(JSON.stringify(journal.snapshot), stateFile);
  atomicJson(journalFile, journal);
  let entryId = existing?.id;
  try {
    if (!entryId) {
      const installed = appendInstallEntry(workspaceRoot, { ...entry, crystallizeEventKey: eventKey } as EntryInput);
      entryId = installed.id;
    }
    journal.entryId = entryId;
    atomicJson(journalFile, journal);
    generateSyncGuide(workspaceRoot, journal.snapshot);
    atomicJson(stateFile, journal.snapshot);
    const artifacts: Record<string, string> = {};
    const capture = (relative: string): void => {
      const file = path.join(root, relative);
      if (fs.lstatSync(file).isDirectory()) {
        for (const name of fs.readdirSync(file)) capture(path.join(relative, name));
      } else {
        const content = fs.readFileSync(file, "utf8");
        assertNoSecrets(content, file);
        artifacts[relative] = digest(content);
      }
    };
    const generated = guideFiles(root);
    for (const [relative, hash] of Object.entries(generated)) {
      if (journal.guideBaseline?.[relative] !== hash || relative.replaceAll("\\", "/") === "guide/SYNC-GUIDE.md") capture(relative);
    }
    capture("state/workspace-state.json");
    capture("state/install-log.json");
    journal.artifacts = artifacts;
    atomicJson(journalFile, journal);
    return { entryId, state: journal.snapshot, stateFile, guidePath, reused: Boolean(existing), artifactPaths: [...Object.keys(artifacts), "state/crystallize-operation.json"] };
  } catch (error) {
    throw new Error(`Crystallize incomplete (partial artifacts); installation entry ${entryId ?? "not written"}. Retry the same command to resume. ${error instanceof Error ? error.message : String(error)}`);
  }
}

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parse } from "smol-toml";
import type { ExtensionRef } from "./types.js";
import { executeTrustedCommand, type CommandResult } from "./codex-restore.js";
import { scanForSecrets } from "./secret-scan.js";
import { parser as pythonParser } from "@lezer/python";
import { parser as javascriptParser } from "@lezer/javascript";
import { redactString } from "./redact.js";
import { normalizeExtensionSource } from "./recovery-manifest.js";

export interface CodexPluginFile {
  path: string;
  base64: string;
  sha256: string;
}
export interface CodexPluginSnapshot {
  schemaVersion: 1;
  selector: string;
  version: string;
  files: CodexPluginFile[];
  digest: string;
  sourceFiles?: CodexPluginFile[];
  expectedSkills: string[];
  hasHooks: boolean;
  hasMcp: boolean;
  exclusions: string[];
  remaining: string[];
}
export type TrustedExecutor = (
  file: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => CommandResult;
export interface CodexPluginSkill {
  name: string;
  path: string;
  pluginId?: string;
  enabled: boolean;
}
export interface CodexPluginSkillError {
  path?: string;
  pluginId?: string;
  message?: string;
}
export interface CodexPluginProbeResult {
  skills: CodexPluginSkill[];
  errors: CodexPluginSkillError[];
}
export type CodexPluginProbe = (options: {
  homeDir: string;
  cwd: string;
}) => CodexPluginProbeResult;
export interface CodexPluginVerification {
  ok: boolean;
  selector: string;
  errors: string[];
  warnings: string[];
  evidence: {
    installed: boolean;
    version: boolean;
    enabled: boolean;
    content: boolean | null;
    skills: boolean | null;
  };
  remaining: string[];
}
export interface CodexPluginOptions {
  homeDir: string;
  execute?: TrustedExecutor;
  probe?: CodexPluginProbe;
  stateDirectory?: string;
}
const MAX_FILES = 4000,
  MAX_FILE_BYTES = 8 * 1024 * 1024,
  MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const safe = (value: unknown) =>
  redactString(String(value))
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .slice(0, 300);
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
function canonicalPath(value: string): string {
  const ordinary = value.startsWith("\\\\?\\UNC\\")
    ? `\\\\${value.slice(8)}`
    : value.startsWith("\\\\?\\")
      ? value.slice(4)
      : value;
  const resolved = path.resolve(ordinary);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function checkExistingAncestors(directory: string): void {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const piece of absolute
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, piece);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw Error("Directory link refused");
  }
}
function readReceipt(file: string): Record<string, unknown> {
  checkExistingAncestors(path.dirname(file));
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink > 1 ||
    stat.size > 1024 * 1024
  )
    throw Error("Receipt link or invalid file refused");
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!object(parsed)) throw Error("Invalid receipt");
  return parsed;
}
function writeReceipt(file: string, value: Record<string, unknown>): void {
  assertSafeDirectory(path.dirname(file));
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1)
      throw Error("Receipt link refused");
  }
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}
function envFor(homeDir: string): NodeJS.ProcessEnv {
  return { ...process.env, CODEX_HOME: path.join(homeDir, ".codex") };
}
function name(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) ||
    value === "." ||
    value === ".."
  )
    throw Error("Invalid plugin identity");
  return value;
}
export function pluginIdentity(plugin: ExtensionRef): string {
  return `${plugin.id}${typeof plugin.config?.marketplace === "string" ? `@${plugin.config.marketplace}` : ""}`;
}
function identityParts(selector: string): { id: string; market?: string } {
  const parts = selector.split("@");
  if (parts.length > 2) throw Error("Invalid plugin selector");
  return {
    id: name(parts[0]),
    market: parts[1] === undefined ? undefined : name(parts[1]),
  };
}
function versionName(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/.test(value)
  )
    throw Error("Invalid plugin version");
  checkedPath(value);
  return value;
}
function checkedPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.includes(":") ||
    value.startsWith("/") ||
    value
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          /[\x00-\x1f<>"|?*]/.test(p) ||
          /[. ]$/.test(p) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      )
  )
    throw Error("Unsafe snapshot path");
  return value;
}
function credentialPath(relative: string): boolean {
  return relative
    .split("/")
    .some((p) =>
      /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.git-credentials|auth\.json|credentials?(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx))$/i.test(
        p,
      ),
    );
}
function checkedBytes(file: CodexPluginFile): Buffer {
  checkedPath(file.path);
  if (credentialPath(file.path)) throw Error("Credential file refused");
  if (
    typeof file.base64 !== "string" ||
    file.base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
    file.base64.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(file.base64)
  )
    throw Error("Invalid snapshot base64");
  const bytes = Buffer.from(file.base64, "base64");
  // Buffer's decoder is permissive. A canonical round trip validates padding
  // and pad bits without a repeated regex group that overflows on large files.
  if (bytes.toString("base64") !== file.base64)
    throw Error("Invalid snapshot base64");
  if (bytes.length > MAX_FILE_BYTES || digest(bytes) !== file.sha256)
    throw Error("Snapshot file hash mismatch");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    if (!recognizedImage(file.path, bytes))
      throw Error("Unknown binary or non UTF-8 content refused");
    text = bytes.toString("latin1");
  }
  if (text.includes("\0") && !recognizedImage(file.path, bytes))
    throw Error("Unknown binary or non UTF-8 content refused");
  if (
    scanForSecrets(text).some(finding => finding.rule !== "sensitive-assignment") ||
    scanForSecrets(secretScanText(file.path, text)).length ||
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
  )
    throw Error("Secret content refused");
  return bytes;
}
function secretScanText(relative: string, text: string): string {
  if (!/\.(?:[cm]?js|[cm]?ts|jsx|tsx|py)$/i.test(relative)) return text;
  // Parsing can only resolve assignment false positives. Keep the original
  // scanner result for every other file without constructing a syntax tree.
  if (!scanForSecrets(text).some(finding => finding.rule === "sensitive-assignment")) return text;
  // Parse without executing plugin code. Every literal/comment remains under
  // scanning, including template strings and regex literals. A parse error
  // disables all exemptions rather than guessing whether text is executable.
  const parser = /\.py$/i.test(relative)
    ? pythonParser
    : javascriptParser.configure({ dialect: "ts jsx" });
  const code = new Uint8Array(text.length).fill(1);
  const edits: Array<{ from: number; to: number; value: string }> = [];
  let invalid = false;
  parser.parse(text).iterate({ enter(node) {
    if (node.type.isError) {
      // Python's grammar requires a yield operand although Python permits
      // bare yield. Recognize only this empty missing-operand node, without
      // altering source bytes or waiving any other parse error.
      const bareYield = /\.py$/i.test(relative) && node.from === node.to &&
        node.node.parent?.name === "YieldStatement" &&
        text.slice(node.node.parent.from, node.node.parent.to).trim() === "yield";
      if (!bareYield) invalid = true;
    }
    if (/String|Comment|RegExp/.test(node.name)) {
      code.fill(0, node.from, node.to);
      if (/String/.test(node.name)) {
        const parent = node.node.parent;
        const propertyKey = parent?.name === "Property" && parent.firstChild?.from === node.from ||
          parent?.name === "DictionaryExpression" && node.node.nextSibling?.name === ":";
        if (propertyKey) {
          // Literal field names are syntax, but assignments embedded inside
          // such names are still scanned as literal text.
          if (!scanForSecrets(text.slice(node.from, node.to)).length) code.fill(1, node.from, node.to);
        } else {
          // Do not join a word at the end of a literal to a ternary/operator
          // outside it. Keep the literal itself untouched and fully scanned.
          edits.push({ from: node.to, to: node.to, value: "\0" });
        }
      }
      return false;
    }
  } });
  if (invalid) return text;
  const expressionPrefix = /\b(api[_-]?key|token|secret|password|authorization)["']?\s*([=:])\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/gi;
  for (const match of text.matchAll(expressionPrefix)) {
    const offset = match.index;
    if (code.subarray(offset, offset + match[0].length).every(value => value === 1))
      edits.push({ from: offset, to: offset + match[0].length, value: `${match[1]}${match[2]}<hidden>` });
  }
  let result = "", cursor = 0;
  for (const edit of edits.sort((a, b) => a.from - b.from || a.to - b.to)) {
    if (edit.from < cursor) continue;
    result += text.slice(cursor, edit.from) + edit.value;
    cursor = edit.to;
  }
  return result + text.slice(cursor);
}
function recognizedImage(relative: string, bytes: Buffer): boolean {
  const extension = path.extname(relative).toLowerCase();
  if (extension === ".png")
    return (
      bytes.length >= 8 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  if (extension === ".jpg" || extension === ".jpeg")
    return (
      bytes.length >= 4 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[bytes.length - 2] === 255 &&
      bytes[bytes.length - 1] === 217
    );
  if (extension === ".gif")
    return (
      bytes.length >= 6 &&
      /GIF8[79]a/.test(bytes.subarray(0, 6).toString("ascii"))
    );
  if (extension === ".webp")
    return (
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    );
  return false;
}
function fileDigest(files: CodexPluginFile[]): string {
  return digest(
    files
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path, "en"))
      .map((f) => `${f.path}\0${f.sha256}\n`)
      .join(""),
  );
}
function validateFiles(files: unknown): asserts files is CodexPluginFile[] {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES)
    throw Error("Snapshot file count out of bounds");
  const paths = new Set<string>();
  let total = 0;
  for (const raw of files) {
    if (!object(raw)) throw Error("Invalid snapshot file");
    const f = raw as unknown as CodexPluginFile;
    checkedPath(f.path);
    const key = f.path.toLowerCase();
    if (paths.has(key)) throw Error("Duplicate or case collision path");
    paths.add(key);
    total += checkedBytes(f).length;
    if (total > MAX_TOTAL_BYTES)
      throw Error("Snapshot total size out of bounds");
  }
  for (const f of files) {
    const parts = f.path.toLowerCase().split("/");
    for (let i = 1; i < parts.length; i++)
      if (paths.has(parts.slice(0, i).join("/")))
        throw Error("File directory path collision");
  }
}
function manifest(files: CodexPluginFile[]): Record<string, unknown> {
  const file = files.find((f) => f.path === ".codex-plugin/plugin.json");
  if (!file) throw Error("Missing Codex plugin manifest");
  let m: unknown;
  try {
    m = JSON.parse(checkedBytes(file).toString("utf8"));
  } catch {
    throw Error("Invalid plugin manifest");
  }
  if (!object(m)) throw Error("Invalid plugin manifest");
  return m;
}
function metadata(files: CodexPluginFile[]): {
  expectedSkills: string[];
  hasHooks: boolean;
  hasMcp: boolean;
} {
  const m = manifest(files);
  const roots = (
    Array.isArray(m.skills)
      ? m.skills
      : typeof m.skills === "string"
        ? [m.skills]
        : ["skills"]
  ).map((s) => {
    if (typeof s !== "string") throw Error("Invalid manifest skills");
    return checkedPath(s.replace(/^\.\//, "").replace(/\/$/, ""));
  });
  return {
    expectedSkills: files
      .filter(
        (f) =>
          f.path.endsWith("/SKILL.md") &&
          roots.some((r) => f.path.startsWith(`${r}/`)),
      )
      .map((f) => f.path)
      .sort(),
    hasHooks:
      Boolean(m.hooks) || files.some((f) => f.path.startsWith("hooks/")),
    hasMcp:
      Boolean(m.mcpServers) ||
      files.some((f) => /^(?:\.mcp\.json|mcp\.json)$/.test(f.path)),
  };
}
export function validateCodexPluginSnapshot(
  value: unknown,
): asserts value is CodexPluginSnapshot {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    typeof value.selector !== "string" ||
    typeof value.version !== "string"
  )
    throw Error("Invalid plugin snapshot");
  const snap = value as unknown as CodexPluginSnapshot;
  const { id } = identityParts(snap.selector);
  versionName(snap.version);
  validateFiles(snap.files);
  if (fileDigest(snap.files) !== snap.digest)
    throw Error("Snapshot aggregate digest mismatch");
  const m = manifest(snap.files);
  if (m.name !== id || m.version !== snap.version)
    throw Error("Manifest identity/version mismatch");
  runtimeDependencies(snap.files);
  if (snap.sourceFiles !== undefined) {
    validateFiles(snap.sourceFiles);
    const source = manifest(snap.sourceFiles);
    if (source.name !== id) throw Error("Source manifest identity mismatch");
  }
  const meta = metadata(snap.files);
  if (
    !Array.isArray(snap.expectedSkills) ||
    JSON.stringify(meta.expectedSkills) !==
      JSON.stringify(snap.expectedSkills) ||
    snap.hasHooks !== meta.hasHooks ||
    snap.hasMcp !== meta.hasMcp
  )
    throw Error("Snapshot components mismatch");
  if (
    !Array.isArray(snap.exclusions) ||
    !Array.isArray(snap.remaining) ||
    [...snap.exclusions, ...snap.remaining].some(
      (x) => typeof x !== "string" || x.length > 500,
    )
  )
    throw Error("Invalid snapshot limitations");
}
function readFiles(root: string): {
  files: CodexPluginFile[];
  exclusions: string[];
} {
  checkExistingAncestors(path.dirname(root));
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw Error("Plugin root link or invalid directory");
  const files: CodexPluginFile[] = [],
    exclusions: string[] = [];
  let total = 0;
  const walk = (directory: string, relative: string) => {
    for (const entry of fs.readdirSync(directory).sort()) {
      const rel = relative ? `${relative}/${entry}` : entry;
      checkedPath(rel);
      const full = path.join(directory, entry),
        stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw Error("Plugin link refused");
      if (
        entry === ".git" ||
        entry === "node_modules" ||
        entry === "__pycache__" ||
        entry.endsWith(".pyc")
      ) {
        exclusions.push(rel);
        continue;
      }
      if (stat.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!stat.isFile() || stat.nlink > 1)
        throw Error("Special file or hard link refused");
      if (
        stat.size > MAX_FILE_BYTES ||
        files.length >= MAX_FILES ||
        (total += stat.size) > MAX_TOTAL_BYTES
      )
        throw Error("Plugin size out of bounds");
      const bytes = fs.readFileSync(full);
      const file = {
        path: rel,
        base64: bytes.toString("base64"),
        sha256: digest(bytes),
      };
      checkedBytes(file);
      files.push(file);
    }
  };
  walk(root, "");
  validateFiles(files);
  return { files, exclusions };
}
export function captureCodexPluginSnapshot(
  plugin: ExtensionRef,
): CodexPluginSnapshot {
  const installed = plugin.config?.installedPath;
  if (typeof installed !== "string") throw Error("No verified installed path");
  const data = readFiles(installed);
  const m = manifest(data.files);
  const snap: CodexPluginSnapshot = {
    schemaVersion: 1,
    selector: pluginIdentity(plugin),
    version: String(m.version),
    files: data.files,
    digest: fileDigest(data.files),
    ...metadata(data.files),
    exclusions: data.exclusions,
    remaining: [],
  };
  if (plugin.version && plugin.version !== snap.version)
    throw Error("Installed manifest version mismatch");
  const source = plugin.config?.sourcePath;
  if (
    typeof source === "string" &&
    path.resolve(source) !== path.resolve(installed) &&
    fs.existsSync(source)
  ) {
    try {
      const sourceData = readFiles(source);
      if (manifest(sourceData.files).name !== identityParts(snap.selector).id)
        throw Error("Source manifest identity mismatch");
      snap.sourceFiles = sourceData.files;
      snap.exclusions.push(...sourceData.exclusions.map((s) => `source/${s}`));
    } catch (error) {
      snap.remaining.push(`Source archive unavailable: ${safe(error instanceof Error ? error.message : error)}`);
    }
  } else if (typeof source === "string" && !fs.existsSync(source)) {
    snap.remaining.push("Source archive unavailable: source directory is not accessible");
  }
  validateCodexPluginSnapshot(snap);
  return snap;
}
export function readCodexPluginInventory(
  homeDir: string,
  execute: TrustedExecutor = executeTrustedCommand,
): ExtensionRef[] {
  const run = execute("codex", ["plugin", "list", "--json"], {
    env: envFor(homeDir),
    timeoutMs: 30_000,
  });
  if (run.code !== 0)
    throw Error(
      `Codex plugin inventory failed: ${safe(run.errorType ?? run.stderr)}`,
    );
  if (run.stdout.length > 8 * 1024 * 1024)
    throw Error("Codex plugin inventory output too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    throw Error("Codex plugin inventory invalid JSON protocol");
  }
  if (!object(parsed) || !Array.isArray(parsed.installed))
    throw Error("Codex plugin inventory invalid protocol");
  return parsed.installed.map((raw) => {
    if (
      !object(raw) ||
      raw.installed !== true ||
      typeof raw.pluginId !== "string" ||
      typeof raw.version !== "string" ||
      typeof raw.enabled !== "boolean"
    )
      throw Error("Codex plugin inventory invalid record");
    const { id, market } = identityParts(raw.pluginId);
    if (!market || raw.name !== id || raw.marketplaceName !== market)
      throw Error("Codex plugin inventory identity mismatch");
    versionName(raw.version);
    const marketSource = object(raw.marketplaceSource)
      ? raw.marketplaceSource
      : {};
    const src = object(raw.source) ? raw.source : {};
    const installedPath = path.join(
      homeDir,
      ".codex",
      "plugins",
      "cache",
      market,
      id,
      raw.version,
    );
    const config: Record<string, unknown> = {
      installationVerified: true,
      marketplace: market,
      sourceType: marketSource.sourceType,
      installedPath,
    };
    if (typeof src.path === "string") {
      for (const catalogPath of [
        path.join(src.path, ".agents", "plugins", "marketplace.json"),
        path.join(src.path, ".claude-plugin", "marketplace.json"),
      ]) {
        try {
          const marketplace = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
          const entry = marketplace.plugins?.find(
            (p: unknown) => object(p) && p.name === id,
          );
          const reference =
            entry && object(entry.source) && entry.source.source === "local"
              ? entry.source.path
              : entry?.source;
          if (typeof reference === "string") {
            const candidate = path.resolve(src.path, reference);
            if (
              fs.existsSync(
                path.join(candidate, ".codex-plugin", "plugin.json"),
              )
            )
              config.sourcePath = candidate;
          }
          if (config.sourcePath) break;
        } catch {
          /* source optional; never scan a marketplace root as a plugin */
        }
      }
      if (
        !config.sourcePath &&
        fs.existsSync(path.join(src.path, ".codex-plugin", "plugin.json"))
      )
        config.sourcePath = src.path;
    }
    let source =
      typeof marketSource.source === "string" ? marketSource.source : undefined;
    {
      const state = path.join(
        homeDir,
        ".codex",
        "uagent-sync",
        "plugin-recovery",
      );
      const receiptPath = path.join(
        state,
        digest(raw.pluginId).slice(0, 24),
        "accepted.json",
      );
      let receipt: Record<string, unknown> | undefined;
      try {
        receipt = readReceipt(receiptPath);
      } catch (error) {
        if (fs.existsSync(receiptPath))
          throw Error("Invalid plugin recovery receipt");
      }
      if (receipt) {
        const marketReference =
          typeof receipt.marketplaceSource === "string"
            ? receipt.marketplaceSource
            : receipt.catalogRoot;
        if (
          receipt.selector === raw.pluginId &&
          typeof marketReference === "string" &&
          source &&
          canonicalPath(source) === canonicalPath(marketReference) &&
          canonicalPath(marketReference).startsWith(
            canonicalPath(state) + path.sep,
          )
        ) {
          source = typeof receipt.source === "string" ? receipt.source : source;
          config.sourceType = receipt.sourceType;
        }
        if (
          receipt.selector === raw.pluginId &&
          typeof receipt.sourceDigest === "string" &&
          /^[a-f0-9]{64}$/.test(receipt.sourceDigest)
        ) {
          const archive = path.join(
            state,
            digest(raw.pluginId).slice(0, 24),
            "sources",
            receipt.sourceDigest,
          );
          const archived = readFiles(archive);
          if (manifest(archived.files).name !== id)
            throw Error("Managed source archive identity mismatch");
          config.sourceModified =
            fileDigest(archived.files) !== receipt.sourceDigest;
          config.sourcePath = archive;
        }
      }
    }
    return {
      kind: "plugin",
      id,
      version: raw.version,
      enabled: raw.enabled,
      source,
      config,
    };
  });
}

// A fresh app-server performs protocol discovery only: no model request, Hook execution or trust changes.
const probeRunner = String.raw`const {spawn}=require('node:child_process');const exe=process.argv[1],args=JSON.parse(process.argv[2]);let out='',err='',done=false;const child=spawn(exe,args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});const finish=(v)=>{if(done)return;done=true;clearTimeout(timer);try{child.kill()}catch{};process.stdout.write(JSON.stringify(v));};const timer=setTimeout(()=>finish({error:'app-server timeout'}),20000);child.on('error',()=>finish({error:'app-server launch failed'}));child.on('exit',()=>{if(!done)finish({error:'app-server exited before skills response'})});child.stderr.on('data',b=>{err+=b;if(err.length>1048576)finish({error:'app-server output limit'})});child.stdout.on('data',b=>{out+=b;if(out.length>8388608)return finish({error:'app-server output limit'});let i;while((i=out.indexOf('\n'))>=0){const line=out.slice(0,i);out=out.slice(i+1);if(!line.trim())continue;let m;try{m=JSON.parse(line)}catch{return finish({error:'app-server invalid protocol'})}if(m.id===1){if(m.error)return finish({error:'app-server initialize failed'});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');child.stdin.write(JSON.stringify({id:2,method:'skills/list',params:{cwds:[process.argv[3]],forceReload:true}})+'\n');}if(m.id===2){if(m.error)return finish({error:'app-server skills discovery failed'});finish({result:m.result});}}});child.stdin.write(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'uagent-sync',version:'1'},capabilities:{experimentalApi:true}}})+'\n');`;
export function probeCodexPluginSkills(options: {
  homeDir: string;
  cwd: string;
}): CodexPluginProbeResult {
  let executable = "codex",
    args = ["app-server"];
  const env = envFor(options.homeDir);
  if (process.platform === "win32") {
    const shim =
      env.UAGENT_SYNC_CODEX_CMD ??
      (env.APPDATA ? path.join(env.APPDATA, "npm", "codex.cmd") : "");
    if (
      !path.isAbsolute(shim) ||
      !shim.endsWith(".cmd") ||
      /[\\/]WindowsApps[\\/]/i.test(shim) ||
      !fs.existsSync(shim)
    )
      throw Error("No trusted Codex CLI for app-server");
    const cli = path.join(
      path.dirname(shim),
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    if (!fs.existsSync(cli)) throw Error("No trusted Codex Node entry");
    executable = process.execPath;
    args = [cli, ...args];
  }
  const run = spawnSync(
    process.execPath,
    ["-e", probeRunner, executable, JSON.stringify(args), options.cwd],
    {
      env,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 25_000,
      maxBuffer: 9 * 1024 * 1024,
    },
  );
  if (run.error || run.status !== 0)
    throw Error("Codex app-server probe failed");
  let result: unknown;
  try {
    result = JSON.parse(run.stdout);
  } catch {
    throw Error("Codex app-server probe invalid protocol");
  }
  if (
    !object(result) ||
    result.error ||
    !object(result.result) ||
    !Array.isArray(result.result.data)
  )
    throw Error(
      `Codex app-server probe failed: ${safe(object(result) ? result.error : "protocol")}`,
    );
  const skills: CodexPluginSkill[] = [],
    errors: CodexPluginSkillError[] = [];
  for (const entry of result.result.data) {
    if (
      !object(entry) ||
      !Array.isArray(entry.skills) ||
      !Array.isArray(entry.errors)
    )
      throw Error("Codex Skill discovery invalid protocol");
    for (const skill of entry.skills) {
      if (
        !object(skill) ||
        typeof skill.name !== "string" ||
        typeof skill.path !== "string" ||
        typeof skill.enabled !== "boolean"
      )
        throw Error("Codex Skill invalid protocol");
      skills.push(skill as unknown as CodexPluginSkill);
    }
    for (const error of entry.errors) {
      if (!object(error)) throw Error("Codex Skill error invalid protocol");
      errors.push(error as unknown as CodexPluginSkillError);
    }
  }
  return { skills, errors };
}
function verification(plugin: ExtensionRef): CodexPluginVerification {
  return {
    ok: false,
    selector: pluginIdentity(plugin),
    errors: [],
    warnings: [],
    evidence: {
      installed: false,
      version: false,
      enabled: false,
      content: null,
      skills: null,
    },
    remaining: [],
  };
}
export function verifyCodexPlugin(
  plugin: ExtensionRef,
  options: CodexPluginOptions,
): CodexPluginVerification {
  const result = verification(plugin);
  try {
    const inventory = readCodexPluginInventory(
      options.homeDir,
      options.execute,
    );
    const selected = inventory.filter(
      (p) =>
        pluginIdentity(p).toLowerCase() === result.selector.toLowerCase() ||
        (!plugin.config?.marketplace &&
          p.id.toLowerCase() === plugin.id.toLowerCase()),
    );
    if (selected.length !== 1)
      throw Error("Selected plugin missing or ambiguous");
    const actual = selected[0];
    result.evidence.installed = true;
    result.evidence.version =
      !plugin.version || actual.version === plugin.version;
    if (!result.evidence.version)
      result.errors.push("Installed plugin version mismatch");
    result.evidence.enabled =
      plugin.enabled === undefined || actual.enabled === plugin.enabled;
    if (!result.evidence.enabled)
      result.errors.push("Installed plugin enabled state mismatch");
    let expected: string[] = [];
    let components: Pick<CodexPluginSnapshot, "hasHooks" | "hasMcp">;
    if (plugin.pluginSnapshot) {
      validateCodexPluginSnapshot(plugin.pluginSnapshot);
      const snap = captureCodexPluginSnapshot({
        ...actual,
        config: { ...actual.config, sourcePath: undefined },
      });
      result.evidence.content = snap.digest === plugin.pluginSnapshot.digest;
      if (!result.evidence.content)
        result.errors.push("Installed plugin content digest mismatch");
      expected = plugin.pluginSnapshot.expectedSkills;
      components = plugin.pluginSnapshot;
      result.remaining.push(...plugin.pluginSnapshot.remaining);
    } else {
      try {
        const current = captureCodexPluginSnapshot({
          ...actual,
          config: { ...actual.config, sourcePath: undefined },
        });
        expected = current.expectedSkills;
        components = current;
      } catch {
        throw Error("Installed plugin manifest/content cannot be inspected");
      }
      result.remaining.push(
        "No snapshot: fixed content equality is not verified",
      );
    }
    if (components.hasHooks)
      result.remaining.push(
        "Hook execution and required host trust are not verified",
      );
    if (components.hasMcp)
      result.remaining.push(
        "MCP authentication and business behavior are not verified",
      );
    for (const dependency of runtimeDependencies(
      readFiles(String(actual.config!.installedPath)).files,
    )) {
      if (
        !fs.existsSync(
          path.join(
            String(actual.config!.installedPath),
            "node_modules",
            dependency,
            "package.json",
          ),
        )
      )
        result.errors.push(
          `Installed runtime dependency unavailable: ${dependency}`,
        );
    }
    if (actual.enabled) {
      const discovered = (options.probe ?? probeCodexPluginSkills)({
        homeDir: options.homeDir,
        cwd: options.homeDir,
      });
      const installedPath = String(actual.config!.installedPath);
      const relevant = discovered.skills.filter(
        (s) =>
          s.pluginId?.toLowerCase() === pluginIdentity(actual).toLowerCase(),
      );
      const failures = discovered.errors.filter(
        (e) =>
          e.pluginId?.toLowerCase() === pluginIdentity(actual).toLowerCase() ||
          (typeof e.path === "string" &&
            (path.resolve(e.path) === installedPath ||
              path.resolve(e.path).startsWith(installedPath + path.sep))),
      );
      result.evidence.skills =
        failures.length === 0 &&
        expected.every((relative) =>
          relevant.some(
            (s) =>
              s.enabled &&
              path.resolve(s.path) === path.resolve(installedPath, relative),
          ),
        );
      if (!result.evidence.skills)
        result.errors.push(
          "Selected plugin Skill discovery incomplete or failed",
        );
    } else
      result.remaining.push(
        "Disabled plugin: Skill loading intentionally not requested",
      );
  } catch (error) {
    result.errors.push(safe(error instanceof Error ? error.message : error));
  }
  result.ok = result.errors.length === 0;
  return result;
}

function assertSafeDirectory(root: string): void {
  const absolute = path.resolve(root);
  let current = path.parse(absolute).root;
  for (const piece of absolute
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, piece);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw Error("Destination link or non-directory refused");
    } else fs.mkdirSync(current);
  }
}
function expand(files: CodexPluginFile[], root: string): void {
  assertSafeDirectory(root);
  for (const file of files) {
    const output = path.join(root, file.path);
    assertSafeDirectory(path.dirname(output));
    if (fs.existsSync(output)) {
      if (
        fs.lstatSync(output).isSymbolicLink() ||
        digest(fs.readFileSync(output)) !== file.sha256
      )
        throw Error("Immutable archive conflict");
    } else fs.writeFileSync(output, checkedBytes(file), { flag: "wx" });
  }
}
// A local rollback copy is never a portable snapshot. Keep refused old bytes on
// this device while still rejecting links, special files and unbounded trees.
function backupInstalledPlugin(source: string, destination: string): void {
  checkExistingAncestors(source);
  const files: { relative: string; bytes: Buffer }[] = [];
  let total = 0;
  const collect = (directory: string, relative: string) => {
    for (const entry of fs.readdirSync(directory).sort()) {
      const rel = relative ? `${relative}/${entry}` : entry;
      checkedPath(rel);
      const full = path.join(directory, entry), stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw Error("Rollback plugin link refused");
      // Dependencies are rebuilt from the retained lockfile when rolling back;
      // the Codex installer may remove the original version cache.
      if ([".git", "node_modules", "__pycache__"].includes(entry) || entry.endsWith(".pyc")) continue;
      if (stat.isDirectory()) { collect(full, rel); continue; }
      if (!stat.isFile() || stat.nlink > 1) throw Error("Rollback special file or hard link refused");
      if (stat.size > MAX_FILE_BYTES || files.length >= MAX_FILES || (total += stat.size) > MAX_TOTAL_BYTES) throw Error("Rollback plugin size out of bounds");
      files.push({ relative: rel, bytes: fs.readFileSync(full) });
    }
  };
  collect(source, "");
  if (fs.existsSync(destination)) throw Error("Rollback destination already exists");
  assertSafeDirectory(destination);
  for (const file of files) {
    const output = path.join(destination, file.relative);
    assertSafeDirectory(path.dirname(output));
    fs.writeFileSync(output, file.bytes, { flag: "wx", mode: 0o600 });
  }
}
function checkDestinationAncestors(destination: string): void {
  const absolute = path.resolve(destination);
  let current = path.parse(absolute).root;
  for (const piece of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, piece);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error("Destination cache link or non-directory refused");
  }
}
function setEnabled(homeDir: string, selector: string, enabled: boolean): void {
  const config = path.join(homeDir, ".codex", "config.toml");
  assertSafeDirectory(path.dirname(config));
  if (
    fs.existsSync(config) &&
    (!fs.lstatSync(config).isFile() ||
      fs.lstatSync(config).isSymbolicLink() ||
      fs.lstatSync(config).nlink > 1)
  )
    throw Error("Config link refused");
  const old = fs.existsSync(config) ? fs.readFileSync(config, "utf8") : "";
  const parsed = parse(old);
  const plugins = object(parsed.plugins) ? parsed.plugins : {};
  const oldValue = plugins[selector];
  if (object(oldValue) && oldValue.enabled === enabled) return;
  const heading = `[plugins.${JSON.stringify(selector)}]`;
  const headings = /^\s*\[([^\n]+)\]\s*(?:#.*)?$/gm;
  let match: RegExpExecArray | null,
    start = -1,
    end = old.length;
  while ((match = headings.exec(old))) {
    if (start >= 0) {
      end = match.index;
      break;
    }
    try {
      const section = parse(`${match[0]}\n__usync_probe=true\n`);
      if (object(section.plugins) && object(section.plugins[selector]))
        start = match.index + match[0].length;
    } catch {
      /* other TOML tables */
    }
  }
  let next: string;
  if (start >= 0) {
    const body = old.slice(start, end);
    next =
      old.slice(0, start) +
      (/^\s*enabled\s*=/m.test(body)
        ? body.replace(
            /^(\s*enabled\s*=\s*)(true|false)(\s*(?:#.*)?)$/m,
            `$1${enabled}$3`,
          )
        : `\nenabled = ${enabled}${body}`) +
      old.slice(end);
  } else
    next = `${old}${old.endsWith("\n") || !old ? "" : "\n"}${heading}\nenabled = ${enabled}\n`;
  parse(next);
  assertSafeDirectory(path.dirname(config));
  fs.writeFileSync(config, next, "utf8");
}
function prepareOwnedMarketplace(
  state: string,
  market: string,
  id: string,
  snap: CodexPluginSnapshot,
  configured: unknown,
): string | undefined {
  const root = path.join(
    state,
    "marketplaces",
    digest(market).slice(0, 24),
    "catalog",
  );
  if (
    configured !== undefined &&
    (!object(configured) ||
      configured.source_type !== "local" ||
      typeof configured.source !== "string" ||
      canonicalPath(configured.source) !== canonicalPath(root))
  )
    return undefined;
  const catalogFile = path.join(root, ".agents", "plugins", "marketplace.json"),
    markerFile = path.join(root, ".uagent-sync-catalog.json");
  let entries: Record<string, unknown>[] = [];
  if (fs.existsSync(catalogFile)) {
    const marker = readReceipt(markerFile),
      catalog = readReceipt(catalogFile);
    if (
      marker.marketplace !== market ||
      marker.digest !== digest(fs.readFileSync(catalogFile)) ||
      catalog.name !== market ||
      !Array.isArray(catalog.plugins)
    )
      throw Error("Owned marketplace content conflict");
    entries = catalog.plugins.map((entry: unknown) => {
      if (
        !object(entry) ||
        typeof entry.name !== "string" ||
        !object(entry.source) ||
        entry.source.source !== "local" ||
        typeof entry.source.path !== "string"
      )
        throw Error("Invalid owned marketplace entry");
      const pluginId = name(entry.name),
        prefix = `./plugins/${pluginId}/`,
        source = entry.source.path;
      if (
        !source.startsWith(prefix) ||
        !/^[a-f0-9]{64}$/.test(source.slice(prefix.length))
      )
        throw Error("Invalid owned marketplace path");
      const files = readFiles(path.join(root, source)).files;
      if (
        fileDigest(files) !== source.slice(prefix.length) ||
        manifest(files).name !== pluginId
      )
        throw Error("Owned marketplace plugin content conflict");
      return entry;
    });
  } else if (fs.existsSync(markerFile))
    throw Error("Owned marketplace catalog missing");
  expand(snap.files, path.join(root, "plugins", id, snap.digest));
  entries = entries.filter((entry) => entry.name !== id);
  entries.push({
    name: id,
    version: snap.version,
    source: { source: "local", path: `./plugins/${id}/${snap.digest}` },
  });
  entries.sort((a, b) => String(a.name).localeCompare(String(b.name), "en"));
  const catalog = { name: market, plugins: entries };
  writeReceipt(catalogFile, catalog);
  writeReceipt(markerFile, {
    marketplace: market,
    digest: digest(JSON.stringify(catalog)),
  });
  return root;
}
export function restoreCodexPlugin(
  plugin: ExtensionRef,
  options: CodexPluginOptions,
): CodexPluginVerification {
  const result = verification(plugin),
    execute = options.execute ?? executeTrustedCommand;
  try {
    const snap = plugin.pluginSnapshot;
    if (snap) {
      validateCodexPluginSnapshot(snap);
      if (
        snap.selector !== pluginIdentity(plugin) ||
        (plugin.version && plugin.version !== snap.version)
      )
        throw Error("Recovery snapshot identity/version mismatch");
    }
    if (plugin.config?.managedBy === "codex-runtime") {
      const verified = verifyCodexPlugin(plugin, options);
      verified.remaining.push("Host-managed plugin: installation and enabled-state changes require the Codex host");
      return verified;
    }
    const inventory = readCodexPluginInventory(options.homeDir, execute);
    const candidates = inventory.filter(
      (p) =>
        pluginIdentity(p).toLowerCase() ===
          pluginIdentity(plugin).toLowerCase() ||
        (!plugin.config?.marketplace &&
          p.id.toLowerCase() === plugin.id.toLowerCase()),
    );
    if (candidates.length > 1) throw Error("Ambiguous plugin identity");
    const existing = candidates[0];
    if (
      existing &&
      plugin.source &&
      existing.source &&
      normalizeExtensionSource(existing.source) !==
        normalizeExtensionSource(plugin.source)
    )
      throw Error("Conflicting plugin marketplace source");
    const selector = existing
      ? pluginIdentity(existing)
      : pluginIdentity(plugin);
    const { id, market } = identityParts(selector);
    if (!market) throw Error("Missing marketplace identity");
    const state =
      options.stateDirectory ??
      path.join(options.homeDir, ".codex", "uagent-sync", "plugin-recovery");
    const key = digest(selector).slice(0, 24),
      baselineFile = path.join(state, key, "accepted.json");
    let needsInstall = !existing;
    let catalogRoot: string | undefined;
    let previous: Record<string, unknown> | undefined;
    try {
      previous = readReceipt(baselineFile);
    } catch (error) {
      if (fs.existsSync(baselineFile)) throw error;
    }
    const sourceDigest = snap?.sourceFiles
      ? fileDigest(snap.sourceFiles)
      : undefined;
    if (
      previous?.sourceDigest &&
      existing &&
      typeof existing.config?.sourcePath === "string"
    ) {
      const targetSourceDigest = fileDigest(
        readFiles(existing.config.sourcePath).files,
      );
      if (
        targetSourceDigest !== previous.sourceDigest &&
        targetSourceDigest !== sourceDigest
      )
        throw Error("Target source content conflict");
    }
    if (
      snap &&
      runtimeDependencies(snap.files).length &&
      !snap.files.some(
        (file) =>
          file.path === "package-lock.json" ||
          file.path === "npm-shrinkwrap.json",
      )
    )
      throw Error("Runtime dependencies require a lockfile");
    const destinationCache = snap ? path.join(options.homeDir, ".codex", "plugins", "cache", market, id, snap.version) : undefined;
    checkDestinationAncestors(destinationCache ?? path.join(options.homeDir, ".codex", "plugins", "cache", market, id));
    if (snap && existing?.version !== snap.version && destinationCache && fs.existsSync(destinationCache))
      throw Error("Different-version destination cache already exists; refusing to overwrite local content");
    if (snap && existing && existing.version !== snap.version) needsInstall = true;
    if (snap && existing && existing.version === snap.version) {
      const current = captureCodexPluginSnapshot({
        ...existing,
        config: { ...existing.config, sourcePath: undefined },
      });
      needsInstall =
        current.digest !== snap.digest || existing.version !== snap.version;
      if (needsInstall && existing.version === snap.version) {
        const baseline = previous;
        if (
          !object(baseline) ||
          baseline.digest !== current.digest ||
          baseline.selector !== selector
        )
          throw Error(
            "Same-version target content conflict: no matching successful baseline",
          );
      }
    }
    if (snap?.sourceFiles && sourceDigest)
      expand(snap.sourceFiles, path.join(state, key, "sources", sourceDigest));
    if (needsInstall) {
      let args: string[];
      if (snap) {
        const archive = path.join(state, key, snap.digest),
          catalog = path.join(archive, "catalog"),
          installed = path.join(catalog, "plugin");
        catalogRoot = catalog;
        expand(snap.files, installed);
        if (runtimeDependencies(snap.files).length) {
          const deps = execute(
            "npm",
            [
              "--prefix",
              installed,
              "ci",
              "--omit=dev",
              "--ignore-scripts",
              "--no-audit",
              "--no-fund",
            ],
            { env: envFor(options.homeDir), timeoutMs: 120_000 },
          );
          if (deps.code !== 0)
            throw Error(
              "Runtime dependency installation failed (scripts disabled)",
            );
        }
        assertSafeDirectory(path.join(catalog, ".agents", "plugins"));
        const catalogFile = path.join(
          catalog,
          ".agents",
          "plugins",
          "marketplace.json",
        );
        const catalogText = JSON.stringify({
          name: market,
          plugins: [
            {
              name: id,
              version: snap.version,
              source: { source: "local", path: "./plugin" },
            },
          ],
        });
        if (
          fs.existsSync(catalogFile) &&
          fs.readFileSync(catalogFile, "utf8") !== catalogText
        )
          throw Error("Immutable catalog conflict");
        if (!fs.existsSync(catalogFile))
          fs.writeFileSync(catalogFile, catalogText, { flag: "wx" });
        if (existing && typeof existing.config?.installedPath === "string")
          backupInstalledPlugin(
            existing.config.installedPath,
            path.join(state, key, "backups", `${Date.now()}-${process.pid}`),
          );
        const configPath = path.join(options.homeDir, ".codex", "config.toml");
        const config = fs.existsSync(configPath)
          ? parse(fs.readFileSync(configPath, "utf8"))
          : {};
        const markets = object(config.marketplaces) ? config.marketplaces : {};
        const ownedCatalog = prepareOwnedMarketplace(
          state,
          market,
          id,
          snap,
          markets[market],
        );
        if (!markets[market]) {
          const add = execute(
            "codex",
            ["plugin", "marketplace", "add", ownedCatalog ?? catalog],
            { env: envFor(options.homeDir), timeoutMs: 30_000 },
          );
          if (add.code !== 0) throw Error("Marketplace registration failed");
        }
        args = [
          "-c",
          `marketplaces.${market}.source_type="local"`,
          "-c",
          `marketplaces.${market}.source=${JSON.stringify(catalog)}`,
          "plugin",
          "add",
          selector,
          "--json",
        ];
      } else {
        if (!plugin.source) throw Error("Missing trusted marketplace source");
        const added = execute(
          "codex",
          ["plugin", "marketplace", "add", plugin.source],
          { env: envFor(options.homeDir), timeoutMs: 30_000 },
        );
        if (
          added.code !== 0 &&
          !/already/i.test(added.stderr + "\n" + added.stdout)
        )
          throw Error("Marketplace registration failed");
        args = ["plugin", "add", selector, "--json"];
      }
      const installed = execute("codex", args, {
        env: envFor(options.homeDir),
        timeoutMs: 120_000,
      });
      if (installed.code !== 0)
        throw Error(`Plugin install command failed: ${safe(installed.stderr)}`);
    }
    if (plugin.enabled !== undefined)
      setEnabled(options.homeDir, selector, plugin.enabled);
    const verified = verifyCodexPlugin(
      { ...plugin, config: { ...plugin.config, marketplace: market } },
      options,
    );
    if (verified.ok && snap) {
      if (!catalogRoot) {
        catalogRoot =
          typeof previous?.catalogRoot === "string"
            ? previous.catalogRoot
            : undefined;
      }
      const configPath = path.join(options.homeDir, ".codex", "config.toml");
      const config = fs.existsSync(configPath)
        ? parse(fs.readFileSync(configPath, "utf8"))
        : {};
      const markets = object(config.marketplaces) ? config.marketplaces : {};
      const marketplace = object(markets[market]) ? markets[market] : {};
      writeReceipt(baselineFile, {
        selector,
        digest: snap.digest,
        version: snap.version,
        source: plugin.source,
        sourceType: plugin.config?.sourceType,
        catalogRoot,
        marketplaceSource:
          typeof marketplace.source === "string"
            ? marketplace.source
            : undefined,
        sourceDigest,
      });
    }
    return verified;
  } catch (error) {
    result.errors.push(safe(error instanceof Error ? error.message : error));
    return result;
  }
}
function runtimeDependencies(files: CodexPluginFile[]): string[] {
  const pkg = files.find((file) => file.path === "package.json");
  if (!pkg) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(checkedBytes(pkg).toString("utf8"));
  } catch {
    throw Error("Invalid plugin package manifest");
  }
  if (!object(parsed)) throw Error("Invalid plugin package manifest");
  const dependencies = object(parsed.dependencies)
    ? Object.keys(parsed.dependencies)
    : [];
  if (
    dependencies.some(
      (dep) =>
        !/^(@[a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(
          dep,
        ),
    )
  )
    throw Error("Invalid package dependency identity");
  for (const source of Object.values(
    object(parsed.dependencies) ? parsed.dependencies : {},
  )) {
    if (typeof source !== "string")
      throw Error("Invalid package dependency source");
    if (/^(?:file|link):/i.test(source))
      checkedPath(source.slice(source.indexOf(":") + 1).replace(/^\.\//, ""));
  }
  const lockFile = files.find(
    (file) =>
      file.path === "package-lock.json" || file.path === "npm-shrinkwrap.json",
  );
  if (lockFile) {
    let lock: unknown;
    try {
      lock = JSON.parse(checkedBytes(lockFile).toString("utf8"));
    } catch {
      throw Error("Invalid dependency lockfile");
    }
    const check = (value: unknown): void => {
      if (typeof value === "string" && /^(?:file|link):/i.test(value))
        checkedPath(value.slice(value.indexOf(":") + 1).replace(/^\.\//, ""));
      else if (Array.isArray(value)) value.forEach(check);
      else if (object(value)) Object.values(value).forEach(check);
    };
    check(lock);
  }
  return dependencies;
}

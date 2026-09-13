import { after, before, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { exportSystemState, readSkills, scanInstalledCodexExtensions, scanSkillDirectories } from "../dist/lib/state.js";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "uagent-skill-scan-"));
const WS = path.join(TMP, "workspace");
const HOME = path.join(TMP, "home");
const OPEN_SKILLS = path.join(HOME, ".agents", "skills");
const CODEX_SKILLS = path.join(HOME, ".codex", "skills");

type SkillScanFileSystem = {
  lstatSync(filePath: string): fs.Stats;
  statSync(filePath: string): fs.Stats;
  readdirSync(filePath: string, options: { withFileTypes: true }): fs.Dirent[];
};

const realSkillFs: SkillScanFileSystem = {
  lstatSync: (filePath) => fs.lstatSync(filePath),
  statSync: (filePath) => fs.statSync(filePath),
  readdirSync: (filePath, options) => fs.readdirSync(filePath, options),
};

function errorWithCode(code: string): NodeJS.ErrnoException {
  const error = new Error(`${code} fixture`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function fsFailingOn(target: string, code: string, method: "lstatSync" | "statSync" = "lstatSync"): SkillScanFileSystem {
  const resolved = path.resolve(target);
  return {
    ...realSkillFs,
    [method]: (filePath: string) => {
      if (path.resolve(filePath) === resolved) throw errorWithCode(code);
      return realSkillFs[method](filePath);
    },
  } as SkillScanFileSystem;
}

function makeDirectoryLink(target: string, linkPath: string): string | undefined {
  try {
    fs.symlinkSync(target, linkPath, "junction");
    return undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" && fs.existsSync(linkPath)) return undefined;
    return code ?? "unknown-error";
  }
}

before(() => {
  fs.mkdirSync(WS, { recursive: true });
  fs.mkdirSync(OPEN_SKILLS, { recursive: true });
  fs.mkdirSync(CODEX_SKILLS, { recursive: true });
  fs.mkdirSync(path.join(OPEN_SKILLS, "plain-skill"), { recursive: true });
  fs.mkdirSync(path.join(CODEX_SKILLS, "codex-skill"), { recursive: true });
  fs.writeFileSync(path.join(CODEX_SKILLS, "codex-skill", "SKILL.md"), "# codex skill\n");
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("resilient OpenCode skill scanning", () => {
  it("keeps normal directories and valid directory links", (t) => {
    const linkedTarget = path.join(TMP, "open-linked-target");
    const linkedPath = path.join(OPEN_SKILLS, "linked-skill");
    fs.mkdirSync(linkedTarget, { recursive: true });
    const linkFailure = makeDirectoryLink(linkedTarget, linkedPath);
    if (linkFailure) {
      t.skip(`directory symlink unavailable (${linkFailure})`);
      return;
    }

    const result = readSkills(HOME, realSkillFs as never);
    assert.deepEqual(result.skills.sort(), ["linked-skill", "plain-skill"]);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.blocking, false);
  });

  it("reports a broken directory link and continues scanning", (t) => {
    const brokenPath = path.join(OPEN_SKILLS, "broken-skill");
    const linkFailure = makeDirectoryLink(path.join(TMP, "missing-target"), brokenPath);
    if (linkFailure) {
      t.skip(`directory symlink unavailable (${linkFailure})`);
      return;
    }

    const result = readSkills(HOME, realSkillFs as never);
    const diagnostic = result.diagnostics.find((item) => item.path === brokenPath);
    assert.equal(diagnostic?.kind, "broken-link");
    assert.equal(diagnostic?.blocking, false);
    assert.ok(result.skills.includes("plain-skill"));
  });

  it("reports a broken skills root link instead of treating it as an absent root", (t) => {
    const rootHome = path.join(TMP, "broken-root-home");
    const rootParent = path.join(rootHome, ".agents");
    const rootPath = path.join(rootParent, "skills");
    fs.mkdirSync(rootParent, { recursive: true });
    const linkFailure = makeDirectoryLink(path.join(TMP, "missing-skills-root"), rootPath);
    if (linkFailure) {
      t.skip(`directory symlink unavailable (${linkFailure})`);
      return;
    }

    const result = readSkills(rootHome, realSkillFs as never);
    const diagnostic = result.diagnostics.find((item) => item.path === rootPath);
    assert.equal(diagnostic?.kind, "broken-link");
    assert.equal(diagnostic?.blocking, false);
  });

  it("classifies a disappeared entry instead of silently dropping it", () => {
    const disappearingPath = path.join(OPEN_SKILLS, "disappearing-skill");
    fs.mkdirSync(disappearingPath, { recursive: true });

    const result = readSkills(HOME, fsFailingOn(disappearingPath, "ENOENT"));
    const diagnostic = result.diagnostics.find((item) => item.path === disappearingPath);
    assert.equal(diagnostic?.kind, "disappeared");
    assert.equal(diagnostic?.code, "ENOENT");
    assert.equal(diagnostic?.blocking, false);
  });

  it("classifies permission errors as recoverable diagnostics", () => {
    const restrictedPath = path.join(OPEN_SKILLS, "restricted-skill");
    fs.mkdirSync(restrictedPath, { recursive: true });

    const result = readSkills(HOME, fsFailingOn(restrictedPath, "EACCES"));
    const diagnostic = result.diagnostics.find((item) => item.path === restrictedPath);
    assert.equal(diagnostic?.kind, "permission-denied");
    assert.equal(diagnostic?.severity, "warning");
    assert.equal(diagnostic?.blocking, false);
  });

  it("classifies unknown I/O errors and marks the scan blocking", () => {
    const ioPath = path.join(OPEN_SKILLS, "io-error-skill");
    fs.mkdirSync(ioPath, { recursive: true });

    const result = readSkills(HOME, fsFailingOn(ioPath, "EIO"));
    const diagnostic = result.diagnostics.find((item) => item.path === ioPath);
    assert.equal(diagnostic?.kind, "io-error");
    assert.equal(diagnostic?.code, "EIO");
    assert.equal(diagnostic?.severity, "error");
    assert.equal(diagnostic?.blocking, true);
  });
});

describe("resilient Codex skill scanning", () => {
  it("discovers a valid directory link and reports diagnostics on exported state", (t) => {
    const linkedTarget = path.join(TMP, "codex-linked-target");
    const linkedPath = path.join(CODEX_SKILLS, "codex-linked-skill");
    fs.mkdirSync(linkedTarget, { recursive: true });
    fs.writeFileSync(path.join(linkedTarget, "SKILL.md"), "# linked codex skill\n");
    const linkFailure = makeDirectoryLink(linkedTarget, linkedPath);
    if (linkFailure) {
      t.skip(`directory symlink unavailable (${linkFailure})`);
      return;
    }

    const result = scanSkillDirectories(HOME, "codex", realSkillFs as never);
    assert.ok(result.skills.includes("codex-linked-skill"));
    const state = exportSystemState(WS, { targetAgent: "codex", homeDir: HOME, fsApi: realSkillFs } as never);
    assert.ok(state.agents?.codex?.skills.some((item) => item.id === "codex-linked-skill"));
  });

  it("preserves Codex diagnostics for a disappearing skill entry", () => {
    const disappearingPath = path.join(CODEX_SKILLS, "codex-disappearing-skill");
    fs.mkdirSync(disappearingPath, { recursive: true });
    fs.writeFileSync(path.join(disappearingPath, "SKILL.md"), "# disappearing codex skill\n");

    const result = exportSystemState(WS, {
      targetAgent: "codex",
      homeDir: HOME,
      fsApi: fsFailingOn(disappearingPath, "ENOENT"),
    } as never);
    const diagnostic = result.scanDiagnostics?.find((item) => item.path === disappearingPath);
    assert.equal(diagnostic?.kind, "disappeared");
    assert.equal(diagnostic?.blocking, false);
  });

  it("sends recoverable Codex diagnostics to the explicit diagnostic sink", () => {
    const disappearingPath = path.join(CODEX_SKILLS, "codex-sink-disappearing-skill");
    fs.mkdirSync(disappearingPath, { recursive: true });
    fs.writeFileSync(path.join(disappearingPath, "SKILL.md"), "# sink codex skill\n");
    const diagnostics: unknown[] = [];

    const extensions = scanInstalledCodexExtensions(
      HOME,
      fsFailingOn(disappearingPath, "ENOENT"),
      (diagnostic) => diagnostics.push(diagnostic),
    );
    assert.ok(Array.isArray(extensions));
    const diagnostic = diagnostics.find((item) => (item as { path?: string })?.path === disappearingPath) as { kind?: string } | undefined;
    assert.equal(diagnostic?.kind, "disappeared");
  });

  it("blocks Codex export on an unknown I/O error while returning its classification", () => {
    const ioPath = path.join(CODEX_SKILLS, "codex-io-error-skill");
    fs.mkdirSync(ioPath, { recursive: true });
    fs.writeFileSync(path.join(ioPath, "SKILL.md"), "# io codex skill\n");

    assert.throws(
      () => exportSystemState(WS, { targetAgent: "codex", homeDir: HOME, fsApi: fsFailingOn(ioPath, "EIO") } as never),
      /skill scan.*EIO|EIO.*skill scan/i,
    );
  });

  it("keeps scan internals at the top level of exported state", () => {
    const state = exportSystemState(WS, { targetAgent: "codex", homeDir: HOME, fsApi: realSkillFs } as never);
    assert.ok(Array.isArray(state.scanDiagnostics));
    assert.ok(!state.agents?.codex || !("scanBlocking" in state.agents.codex));
    assert.ok(!state.agents?.codex || !("scanDiagnostics" in state.agents.codex));
  });
});

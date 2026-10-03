import { afterEach, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  captureCodexPluginSnapshot,
  validateCodexPluginSnapshot,
  readCodexPluginInventory,
  verifyCodexPlugin,
  restoreCodexPlugin,
} from "../src/lib/codex-plugin-sync.js";
import type { ExtensionRef } from "../src/lib/types.js";
import { parse } from "smol-toml";
import { createHash } from "node:crypto";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((p) => fs.rmSync(p, { recursive: true, force: true })),
);
function fixture(version = "1.0.0") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usync-plugin-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, ".codex-plugin"));
  fs.writeFileSync(
    path.join(root, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "demo", version, skills: "./skills" }),
  );
  fs.mkdirSync(path.join(root, "skills", "hello"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "skills", "hello", "SKILL.md"),
    "---\nname: hello\ndescription: test\n---\nHello",
  );
  return root;
}
function plugin(root: string): ExtensionRef {
  return {
    kind: "plugin",
    id: "demo",
    version: "1.0.0",
    enabled: true,
    source: "acme/catalog",
    config: {
      marketplace: "market",
      installedPath: root,
      installationVerified: true,
    },
  };
}
it("distinguishes code generator calls from literal credentials without suppressing same-line secrets", () => {
  const root = fixture();
  const file = path.join(root, "generator.py");
  fs.writeFileSync(file, "import secrets\ntoken = secrets.token_hex(8)\n");
  assert.doesNotThrow(() => captureCodexPluginSnapshot(plugin(root)));
  fs.writeFileSync(file, 'token = secrets.token_hex(8); password = "very-private-password"\n');
  assert.throws(() => captureCodexPluginSnapshot(plugin(root)), /Secret/);
  fs.writeFileSync(file, 'token = "ghp_NOT_A_REAL_TOKEN_SENTINEL_123456"\n');
  assert.throws(() => captureCodexPluginSnapshot(plugin(root)), /Secret/);
  fs.writeFileSync(file, 'token = obtain_secret("ghp_NOT_A_REAL_TOKEN_SENTINEL_123456")\n');
  assert.throws(() => captureCodexPluginSnapshot(plugin(root)), /Secret/);
  fs.writeFileSync(file, 'token = ghp_NOT_A_REAL_TOKEN_SENTINEL_123456()\n');
  assert.throws(() => captureCodexPluginSnapshot(plugin(root)), /Secret/);
});
it("keeps valid installed content when a separate source archive is blocked and reports the gap", () => {
  const installed = fixture();
  const source = fixture();
  fs.writeFileSync(path.join(source, "private.txt"), 'password = "very-private-password"\n');
  const snap = captureCodexPluginSnapshot({ ...plugin(installed), config: { ...plugin(installed).config, sourcePath: source } });
  assert.equal(snap.sourceFiles, undefined);
  assert.ok(snap.remaining.some(item => item.includes("Source archive")));
  assert.ok(!JSON.stringify(snap).includes(Buffer.from("very-private-password").toString("base64")));
  assert.ok(snap.files.some(file => file.path === ".codex-plugin/plugin.json"));
});
it("never exempts credential assignments inside strings, templates, comments or regex literals", () => {
  const root = fixture();
  for (const content of [
    'const config = "token=very_private_value.method()";',
    'const config = `password=very_private_value.method()`;',
    '// token=very_private_value.method()',
    '/* password=very_private_value.method() */',
    'const pattern = /token=very_private_value.method()/;',
  ]) {
    fs.writeFileSync(path.join(root, "config.js"), content);
    assert.throws(() => captureCodexPluginSnapshot(plugin(root)), /Secret/, content);
  }
  fs.rmSync(path.join(root, "config.js"));
  for (const content of ['# token=very_private_value.method()', '"""password=very_private_value.method()"""']) {
    fs.writeFileSync(path.join(root, "config.py"), content);
    assert.throws(() => captureCodexPluginSnapshot(plugin(root)), /Secret/, content);
  }
});
it("accepts valid Python bare yield without waiving other syntax errors or literal credentials", () => {
  const root = fixture();
  const file = path.join(root, "generator.py");
  fs.writeFileSync(file, "def generate():\n    yield\n    token = secrets.token_hex(8)\n");
  assert.doesNotThrow(() => captureCodexPluginSnapshot(plugin(root)));
  for (const content of [
    'def generate():\n    yield\n    config = "token=very_private_value.method()"\n',
    'def generate():\n    yield\n    token = secrets.token_hex(\n',
    'def generate():\n    yield\n    config = """password=very_private_value.method()\n',
  ]) {
    fs.writeFileSync(file, content);
    assert.throws(() => captureCodexPluginSnapshot(plugin(root)), /Secret/);
  }
});
it("distinguishes code references and ternary descriptions from literal property credentials", () => {
  const root = fixture();
  const file = path.join(root, "references.js");
  for (const content of [
    'const response = { token: sessionToken };',
    'const response = { "X-Uagent-Token": session.token };',
    'const response = { "token": sessionToken };',
    'const description = yes ? "Personal Access Token" : key.includes("Y");',
  ]) {
    fs.writeFileSync(file, content);
    assert.doesNotThrow(() => captureCodexPluginSnapshot(plugin(root)), content);
  }
  for (const content of [
    'const response = { token: "very_private_value.method()" };',
    'const response = { "X-Uagent-Token": "very_private_value" };',
    'const response = { "token": "very_private_value" };',
    'const response = { "password=very_private_value.method()": sessionToken };',
    'const description = yes ? "token=very_private_value.method()" : key.includes("Y");',
  ]) {
    fs.writeFileSync(file, content);
    assert.throws(() => captureCodexPluginSnapshot(plugin(root)), /Secret/, content);
  }
});
it("retains valid installed content when independent source manifests are invalid", () => {
  const installed = fixture();
  for (const content of ["invalid-json", JSON.stringify({ name: "other", version: "1.0.0" }), null]) {
    const source = fixture();
    const file = path.join(source, ".codex-plugin", "plugin.json");
    if (content === null) fs.rmSync(file); else fs.writeFileSync(file, content);
    const snap = captureCodexPluginSnapshot({ ...plugin(installed), config: { ...plugin(installed).config, sourcePath: source } });
    assert.equal(snap.sourceFiles, undefined);
    assert.ok(snap.remaining.some(item => item.includes("Source archive")));
    assert.ok(snap.files.length > 0);
  }
});
function inventory(root: string, enabled = true, version = "1.0.0") {
  const cache = path.join(
    root,
    ".codex",
    "plugins",
    "cache",
    "market",
    "demo",
    version,
  );
  if (!fs.existsSync(cache)) {
    fs.mkdirSync(cache, { recursive: true });
    for (const file of [".codex-plugin", "skills"])
      fs.cpSync(path.join(root, file), path.join(cache, file), {
        recursive: true,
      });
  }
  return JSON.stringify({
    installed: [
      {
        name: "demo",
        pluginId: "demo@market",
        version,
        enabled,
        installed: true,
        source: { source: "local", path: root },
        marketplaceSource: { sourceType: "git", source: "acme/catalog" },
        marketplaceName: "market",
      },
    ],
    available: [],
  });
}
const probe = (options: { homeDir: string }) => ({
  skills: [
    {
      name: "hello",
      path: path.join(
        options.homeDir,
        ".codex",
        "plugins",
        "cache",
        "market",
        "demo",
        "1.0.0",
        "skills",
        "hello",
        "SKILL.md",
      ),
      pluginId: "demo@market",
      enabled: true,
    },
  ],
  errors: [],
});
it("captures installed bytes separately from changed source and reports exclusions", () => {
  const root = fixture(),
    source = fixture();
  fs.writeFileSync(
    path.join(source, "skills", "hello", "SKILL.md"),
    "source change",
  );
  fs.mkdirSync(path.join(root, "node_modules"));
  const p = plugin(root);
  p.config!.sourcePath = source;
  const snap = captureCodexPluginSnapshot(p);
  assert.notEqual(
    snap.files.find((f) => f.path.endsWith("SKILL.md"))!.sha256,
    snap.sourceFiles!.find((f) => f.path.endsWith("SKILL.md"))!.sha256,
  );
  assert.ok(snap.exclusions.some((x) => x.includes("node_modules")));
  validateCodexPluginSnapshot(snap);
});
it("rejects tampered digests and traversal before writes", () => {
  const snap = captureCodexPluginSnapshot(plugin(fixture()));
  snap.files[0].base64 = Buffer.from("tampered").toString("base64");
  assert.throws(() => validateCodexPluginSnapshot(snap), /digest|hash/);
  snap.files[0].path = "../escape";
  assert.throws(() => validateCodexPluginSnapshot(snap), /path/);
});
it("rejects credentials, binary content, and symlinks", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, ".env"), "TOKEN=value");
  assert.throws(
    () => captureCodexPluginSnapshot(plugin(root)),
    /credential|secret/i,
  );
  fs.rmSync(path.join(root, ".env"));
  fs.writeFileSync(path.join(root, "payload.bin"), Buffer.from([0, 255]));
  assert.throws(
    () => captureCodexPluginSnapshot(plugin(root)),
    /UTF|encoded data|binary/i,
  );
  fs.rmSync(path.join(root, "payload.bin"));
  fs.symlinkSync(
    path.join(root, "skills"),
    path.join(root, "linked"),
    "junction",
  );
  assert.throws(() => captureCodexPluginSnapshot(plugin(root)), /link/);
});
it("preserves recognized bounded PNG assets and reports regenerated Python caches", () => {
  const root = fixture();
  fs.writeFileSync(
    path.join(root, "icon.png"),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
  );
  fs.mkdirSync(path.join(root, "__pycache__"));
  fs.writeFileSync(
    path.join(root, "__pycache__", "test.pyc"),
    Buffer.from([0, 255]),
  );
  const snapshot = captureCodexPluginSnapshot(plugin(root));
  assert.ok(snapshot.files.some((file) => file.path === "icon.png"));
  assert.ok(snapshot.exclusions.includes("__pycache__"));
  fs.writeFileSync(path.join(root, "fake.png"), Buffer.from([0, 255]));
  assert.throws(() => captureCodexPluginSnapshot(plugin(root)));
});
it("inventory failure or malformed protocol never returns empty success", () => {
  assert.throws(
    () =>
      readCodexPluginInventory(fixture(), () => ({
        code: 1,
        stdout: "",
        stderr: "failed",
      })),
    /inventory/,
  );
  assert.throws(
    () =>
      readCodexPluginInventory(fixture(), () => ({
        code: 0,
        stdout: "{}",
        stderr: "",
      })),
    /protocol/,
  );
});
it("accepts safe SemVer build metadata while rejecting path-like versions", () => {
  const version = "1.0.0+codex.20261003";
  const root = fixture(version),
    p = plugin(root);
  p.version = version;
  validateCodexPluginSnapshot(captureCodexPluginSnapshot(p));
  assert.equal(
    readCodexPluginInventory(root, () => ({
      code: 0,
      stdout: inventory(root, true, version),
      stderr: "",
    }))[0].version,
    version,
  );
  p.version = "../escape";
  assert.throws(() => captureCodexPluginSnapshot(p));
});
it("verifies actual version, enabled state, bytes and selected skills only", () => {
  const root = fixture(),
    p = plugin(root);
  p.pluginSnapshot = captureCodexPluginSnapshot(p);
  const execute = () => ({ code: 0, stdout: inventory(root), stderr: "" });
  assert.equal(
    verifyCodexPlugin(p, { homeDir: root, execute, probe }).ok,
    true,
  );
  assert.equal(
    verifyCodexPlugin(p, {
      homeDir: root,
      execute: () => ({ code: 0, stdout: inventory(root, false), stderr: "" }),
      probe,
    }).ok,
    false,
  );
  assert.equal(
    verifyCodexPlugin(p, {
      homeDir: root,
      execute: () => ({
        code: 0,
        stdout: inventory(root, true, "2.0.0"),
        stderr: "",
      }),
      probe,
    }).ok,
    false,
  );
  assert.equal(
    verifyCodexPlugin(p, {
      homeDir: root,
      execute,
      probe: () => ({ skills: [], errors: [] }),
    }).ok,
    false,
  );
  assert.equal(
    verifyCodexPlugin(p, {
      homeDir: root,
      execute,
      probe: () => {
        throw Error("timeout");
      },
    }).ok,
    false,
  );
});
it("restore refuses same-version local changes and does not accept exit zero without installed evidence", () => {
  const root = fixture(),
    p = plugin(root);
  p.pluginSnapshot = captureCodexPluginSnapshot(p);
  inventory(root);
  fs.writeFileSync(
    path.join(
      root,
      ".codex",
      "plugins",
      "cache",
      "market",
      "demo",
      "1.0.0",
      "skills",
      "hello",
      "SKILL.md",
    ),
    "target edit",
  );
  let commands = 0;
  const execute = () => {
    commands++;
    return { code: 0, stdout: inventory(root), stderr: "" };
  };
  assert.equal(
    restoreCodexPlugin(p, { homeDir: root, execute, probe }).ok,
    false,
  );
  assert.equal(commands, 1);
  assert.equal(
    fs.readFileSync(
      path.join(
        root,
        ".codex",
        "plugins",
        "cache",
        "market",
        "demo",
        "1.0.0",
        "skills",
        "hello",
        "SKILL.md",
      ),
      "utf8",
    ),
    "target edit",
  );
  const bare = { ...p, pluginSnapshot: undefined };
  assert.equal(
    restoreCodexPlugin(bare, {
      homeDir: root,
      execute: () => ({
        code: 0,
        stdout: '{"installed":[],"available":[]}',
        stderr: "",
      }),
      probe,
    }).ok,
    false,
  );
});
it("retains an older local rollback copy without exporting refused content when the installer prunes the cache", () => {
  const home = fixture("2.0.0"), p = { ...plugin(home), version: "2.0.0" };
  p.pluginSnapshot = captureCodexPluginSnapshot(p);
  const oldCache = path.join(home, ".codex", "plugins", "cache", "market", "demo", "1.0.0");
  inventory(home);
  fs.writeFileSync(path.join(oldCache, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "demo", version: "1.0.0", skills: "./skills" }));
  const refused = 'password = "very-private-password"\n';
  fs.writeFileSync(path.join(oldCache, "local-only.txt"), refused);
  let currentVersion = "1.0.0", installs = 0;
  const execute = (_file: string, args: string[]) => {
    if (args.includes("list")) return { code: 0, stdout: inventory(home, true, currentVersion), stderr: "" };
    if (args.includes("add") && !args.includes("marketplace")) {
      installs++;
      const override = args.find(arg => arg.startsWith("marketplaces.market.source="))!;
      const catalog = JSON.parse(override.slice(override.indexOf("=") + 1));
      fs.cpSync(path.join(catalog, "plugin"), path.join(path.dirname(oldCache), "2.0.0"), { recursive: true });
      fs.rmSync(oldCache, { recursive: true });
      currentVersion = "2.0.0";
    }
    return { code: 0, stdout: "{}", stderr: "" };
  };
  const result = restoreCodexPlugin(p, { homeDir: home, execute, probe: () => ({ skills: [{ ...probe({ homeDir: home }).skills[0], path: path.join(path.dirname(oldCache), "2.0.0", "skills", "hello", "SKILL.md") }], errors: [] }) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(installs, 1);
  assert.equal(fs.existsSync(oldCache), false);
  const key = createHash("sha256").update("demo@market").digest("hex").slice(0, 24);
  const state = path.join(home, ".codex", "uagent-sync", "plugin-recovery", key);
  const backups = fs.readdirSync(path.join(state, "backups"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(state, "backups", backups[0], "local-only.txt"), "utf8"), refused);
  assert.equal(fs.existsSync(path.join(state, p.pluginSnapshot.digest, "catalog", "plugin", "local-only.txt")), false);
  assert.equal(fs.existsSync(path.join(path.dirname(oldCache), "2.0.0", "local-only.txt")), false);
  const backup = path.join(state, "backups", backups[0]);
  assert.throws(() => captureCodexPluginSnapshot({ ...plugin(backup), config: { ...plugin(backup).config, sourcePath: undefined } }), /Secret/);
});
it("refuses an unregistered different-version destination cache before invoking the installer", () => {
  const home = fixture("2.0.0"), p = { ...plugin(home), version: "2.0.0" };
  p.pluginSnapshot = captureCodexPluginSnapshot(p);
  inventory(home);
  const target = path.join(home, ".codex", "plugins", "cache", "market", "demo", "2.0.0");
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "local.txt"), "pre-existing edit");
  let commands = 0;
  const result = restoreCodexPlugin(p, { homeDir: home, execute: () => { commands++; return { code: 0, stdout: inventory(home), stderr: "" }; }, probe });
  assert.equal(result.ok, false);
  assert.equal(commands, 1);
  assert.ok(result.errors.some(error => error.includes("destination cache")), JSON.stringify(result));
  assert.equal(fs.readFileSync(path.join(target, "local.txt"), "utf8"), "pre-existing edit");
});
it("refuses linked and dangling cache ancestors before a first installation can write outside home", () => {
  for (const dangling of [false, true]) {
    const home = fixture(), outside = fixture(), p = plugin(home);
    p.pluginSnapshot = captureCodexPluginSnapshot(p);
    const cache = path.join(home, ".codex", "plugins", "cache");
    fs.mkdirSync(cache, { recursive: true });
    const redirected = path.join(outside, "redirected");
    fs.mkdirSync(redirected);
    fs.symlinkSync(redirected, path.join(cache, "market"), process.platform === "win32" ? "junction" : "dir");
    if (dangling) fs.rmSync(redirected, { recursive: true });
    let installs = 0;
    const result = restoreCodexPlugin(p, { homeDir: home, execute: (_file, args) => {
      if (args.includes("list")) return { code: 0, stdout: '{"installed":[],"available":[]}', stderr: "" };
      if (args.includes("add") && !args.includes("marketplace")) { installs++; if (!dangling) fs.writeFileSync(path.join(redirected, "outside-write.txt"), "changed"); }
      return { code: 0, stdout: "{}", stderr: "" };
    }, probe });
    assert.equal(result.ok, false);
    assert.equal(installs, 0);
    assert.ok(result.errors.some(error => /link|directory/i.test(error)), JSON.stringify(result));
    assert.equal(fs.existsSync(path.join(redirected, "outside-write.txt")), false);
  }
});
it("only inspects host-managed plugins without registering, installing or changing enabled state", () => {
  for (const installed of [false, true]) {
    const home = fixture(), p = plugin(home);
    p.config!.managedBy = "codex-runtime";
    p.enabled = false;
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    const configPath = path.join(home, ".codex", "config.toml"), original = 'model = "fixture"\n';
    fs.writeFileSync(configPath, original);
    const writes: string[][] = [];
    const result = restoreCodexPlugin(p, { homeDir: home, execute: (_file, args) => {
      if (args.includes("list")) return { code: 0, stdout: installed ? inventory(home, true) : '{"installed":[],"available":[]}', stderr: "" };
      writes.push(args);
      return { code: 0, stdout: "{}", stderr: "" };
    }, probe });
    assert.equal(result.ok, false);
    assert.deepEqual(writes, []);
    assert.equal(fs.readFileSync(configPath, "utf8"), original);
    assert.ok(result.remaining.some(value => value.includes("Host-managed")), JSON.stringify(result));
    assert.equal(fs.existsSync(path.join(home, ".codex", "uagent-sync", "plugin-recovery")), false);
  }
});
it("requires a lockfile for omitted runtime dependencies before invoking installers", () => {
  const root = fixture(),
    p = plugin(root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { demo: "1.0.0" } }),
  );
  p.pluginSnapshot = captureCodexPluginSnapshot(p);
  const result = restoreCodexPlugin(p, {
    homeDir: root,
    execute: () => ({
      code: 0,
      stdout: '{"installed":[],"available":[]}',
      stderr: "",
    }),
    probe,
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((x) => x.includes("lockfile")),
    JSON.stringify(result),
  );
});
it("rejects runtime dependency identities and local sources that escape the plugin", () => {
  const root = fixture();
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { "..": "1.0.0" } }),
  );
  assert.throws(() => captureCodexPluginSnapshot(plugin(root)), /dependency/i);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { demo: "file:../outside" } }),
  );
  assert.throws(
    () => captureCodexPluginSnapshot(plugin(root)),
    /path|dependency/i,
  );
});
it("keeps recovered origin identity, disabled state and unrelated TOML during repeated recovery", () => {
  const source = fixture(),
    home = fs.mkdtempSync(path.join(os.tmpdir(), "usync-target-"));
  roots.push(home);
  const p = plugin(source);
  const customSource = fixture();
  p.config!.sourcePath = customSource;
  p.enabled = false;
  p.pluginSnapshot = captureCodexPluginSnapshot(p);
  fs.mkdirSync(path.join(home, ".codex"));
  const preserved =
    'model = "fixture"\n[plugins."unrelated@other"]\nenabled = false\n[projects."fixture"]\ntrust_level = "untrusted"\n';
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), preserved);
  let catalog = "",
    installed = false;
  const execute = (_file: string, args: string[]) => {
    if (args.includes("list")) {
      const config = parse(
        fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8"),
      ) as any;
      return {
        code: 0,
        stdout: JSON.stringify({
          installed: installed
            ? [
                {
                  pluginId: "demo@market",
                  name: "demo",
                  marketplaceName: "market",
                  version: "1.0.0",
                  installed: true,
                  enabled: config.plugins?.["demo@market"]?.enabled ?? true,
                  source: { source: "local", path: catalog },
                  marketplaceSource: {
                    sourceType: "local",
                    source:
                      process.platform === "win32"
                        ? `\\\\?\\${catalog}`
                        : catalog,
                  },
                },
              ]
            : [],
          available: [],
        }),
        stderr: "",
      };
    }
    if (args.includes("marketplace")) {
      catalog = args.at(-1)!;
      fs.appendFileSync(
        path.join(home, ".codex", "config.toml"),
        `[marketplaces.market]\nsource_type = "local"\nsource = ${JSON.stringify(catalog)}\n`,
      );
    } else if (args.includes("add")) {
      installed = true;
      const cache = path.join(
        home,
        ".codex",
        "plugins",
        "cache",
        "market",
        "demo",
        "1.0.0",
      );
      fs.mkdirSync(path.dirname(cache), { recursive: true });
      const override = args.find((arg) =>
        arg.startsWith("marketplaces.market.source="),
      );
      const installationCatalog = override
        ? JSON.parse(override.slice(override.indexOf("=") + 1))
        : catalog;
      fs.cpSync(path.join(installationCatalog, "plugin"), cache, {
        recursive: true,
      });
    }
    return { code: 0, stdout: "{}", stderr: "" };
  };
  const first = restoreCodexPlugin(p, { homeDir: home, execute, probe });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(readCodexPluginInventory(home, execute)[0].source, p.source);
  assert.equal(
    restoreCodexPlugin(p, { homeDir: home, execute, probe }).ok,
    true,
  );
  assert.ok(
    fs
      .readFileSync(path.join(home, ".codex", "config.toml"), "utf8")
      .startsWith(preserved),
  );
  fs.writeFileSync(
    path.join(customSource, "skills", "hello", "SKILL.md"),
    "source-only updated content",
  );
  p.pluginSnapshot = captureCodexPluginSnapshot(p);
  const second = restoreCodexPlugin(p, { homeDir: home, execute, probe });
  assert.equal(second.ok, true, JSON.stringify(second));
  const exported = captureCodexPluginSnapshot(
    readCodexPluginInventory(home, execute)[0],
  );
  assert.deepEqual(exported.sourceFiles, p.pluginSnapshot.sourceFiles);
  const receipt = path.join(
    home,
    ".codex",
    "uagent-sync",
    "plugin-recovery",
    createHash("sha256").update("demo@market").digest("hex").slice(0, 24),
    "accepted.json",
  );
  const outside = path.join(home, "outside.json");
  fs.writeFileSync(outside, "{}");
  fs.rmSync(receipt);
  fs.linkSync(outside, receipt);
  assert.equal(
    restoreCodexPlugin(p, { homeDir: home, execute, probe }).ok,
    false,
  );
  assert.equal(fs.readFileSync(outside, "utf8"), "{}");
});

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { importSystemState } from "../dist/lib/state.js";
import type { WorkspaceState } from "../dist/lib/types.js";

// ⚠️ 安全前提：importSystemState 会写 os.homedir()/.config/opencode/opencode.jsonc。
// 本测试把 USERPROFILE/HOME 指向临时目录，并在 before() 里断言 os.homedir() 确实
// 解析到临时 home —— 若断言失败立即中止，绝不触碰真实 home 配置。

const TMP = path.join(os.tmpdir(), `import-redacted-test-${Date.now()}`);
const FAKE_HOME = path.join(TMP, "home");

describe("importSystemState redacted sentinel guard", () => {
  let savedUserProfile: string | undefined;
  let savedHome: string | undefined;

  before(() => {
    savedUserProfile = process.env.USERPROFILE;
    savedHome = process.env.HOME;
    fs.mkdirSync(FAKE_HOME, { recursive: true });
    process.env.USERPROFILE = FAKE_HOME;
    process.env.HOME = FAKE_HOME;
    assert.strictEqual(
      os.homedir(),
      FAKE_HOME,
      "os.homedir() must honor overridden USERPROFILE/HOME — aborting to protect real home"
    );
  });

  after(() => {
    if (savedUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedUserProfile;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  });

  function homeConfigPath(): string {
    return path.join(os.homedir(), ".config", "opencode", "opencode.jsonc");
  }

  function makeState(opencodeConfig: Record<string, unknown>): WorkspaceState {
    return {
      timestamp: new Date().toISOString(),
      platform: "windows",
      hostname: "test-host",
      opencodeConfig,
      envVars: [],
      submodules: [],
      skills: [],
    } as WorkspaceState;
  }

  it("should keep local real url when synced value contains <hidden>", () => {
    // 预写本地 config：含真实（伪造的）url 令牌
    fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
    const localConfig = {
      mcp: {
        zapier: {
          type: "remote",
          url: "https://mcp.zapier.com/api/mcp/s/abc123?token=FAKELOCALTOKEN111",
          enabled: true,
        },
      },
    };
    fs.writeFileSync(homeConfigPath(), JSON.stringify(localConfig, null, 2));

    // 同步来的 state：url 已脱敏
    const state = makeState({
      mcp: {
        zapier: {
          type: "remote",
          url: "https://mcp.zapier.com/api/mcp/s/abc123?token=<hidden>",
          enabled: true,
        },
      },
    });

    const ws = path.join(TMP, "ws1");
    fs.mkdirSync(ws, { recursive: true });
    const result = importSystemState(ws, state);
    assert.ok(result.success);

    const merged = JSON.parse(fs.readFileSync(homeConfigPath(), "utf-8"));
    const url = merged.mcp.zapier.url as string;
    assert.ok(url.includes("FAKELOCALTOKEN111"), `local real token must be preserved, got: ${url}`);
    assert.ok(!url.includes("<hidden>"), "sentinel must not overwrite local value");
  });

  it("should write <hidden> sentinel on a fresh device (no local config)", () => {
    const p = homeConfigPath();
    if (fs.existsSync(p)) fs.rmSync(p);

    const state = makeState({
      mcp: {
        zapier: {
          type: "remote",
          url: "https://mcp.zapier.com/api/mcp/s/abc123?token=<hidden>",
        },
      },
    });

    const ws = path.join(TMP, "ws2");
    fs.mkdirSync(ws, { recursive: true });
    const result = importSystemState(ws, state);
    assert.ok(result.success);
    assert.ok(fs.existsSync(p), "config should be created on fresh device");

    const merged = JSON.parse(fs.readFileSync(p, "utf-8"));
    assert.ok(
      (merged.mcp.zapier.url as string).includes("token=<hidden>"),
      "fresh device should receive the <hidden> sentinel (manual refill expected)"
    );
  });
});

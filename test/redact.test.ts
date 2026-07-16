import { describe, it } from "node:test";
import * as assert from "node:assert";
import { redactString, redactSecretsDeep, REDACTED } from "../dist/lib/redact.js";
import { analyzeMcpConfig, generateConfigRefMd } from "../dist/lib/guide.js";

// NOTE: 所有"密钥"均为明显伪造的测试值，绝不使用真实令牌。

describe("redactString", () => {
  it("should mask url ?token= but keep base url", () => {
    const out = redactString("https://mcp.zapier.com/api/mcp/s/abc123?token=FAKEZAPTOKEN789");
    assert.ok(out.startsWith("https://mcp.zapier.com/api/mcp/s/abc123"), "base url preserved");
    assert.ok(out.includes("token=<hidden>"), `expected token=<hidden>, got: ${out}`);
    assert.ok(!out.includes("FAKEZAPTOKEN789"), "token must not survive");
  });

  it("should mask &api_key= and other query secret params", () => {
    const cases: Array<[string, string]> = [
      ["https://x.com/mcp?foo=1&api_key=FAKEAPIKEY999", "api_key=<hidden>"],
      ["https://x.com/mcp?apiKey=FAKEAPIKEY999", "apiKey=<hidden>"],
      ["https://x.com/mcp?key=FAKEKEY999&other=2", "key=<hidden>"],
      ["https://x.com/mcp?secret=FAKESECRET999", "secret=<hidden>"],
      ["https://x.com/mcp?access_token=FAKEACCTOKEN999", "access_token=<hidden>"],
      ["https://x.com/mcp?auth=FAKEAUTH999", "auth=<hidden>"],
    ];
    for (const [input, marker] of cases) {
      const out = redactString(input);
      assert.ok(out.includes(marker), `${input} → expected ${marker}, got: ${out}`);
      assert.ok(!/FAKE[A-Z0-9]+/.test(out), `${input} → secret survived: ${out}`);
    }
  });

  it("should mask Bearer tokens", () => {
    assert.strictEqual(redactString("Authorization: Bearer abc.def-123_Xy"), "Authorization: Bearer <hidden>");
  });

  it("should mask well-known token prefixes", () => {
    const cases: Array<[string, string, string]> = [
      ["ntn_FAKENOTION123abc", "ntn_<hidden>", "FAKENOTION123abc"],
      ["github_pat_FAKEPAT123abc_def", "github_pat_<hidden>", "FAKEPAT123abc"],
      ["ghp_FAKEGHP123abc", "ghp_<hidden>", "FAKEGHP123abc"],
      ["sk-FAKEKEY123456789", "sk-<hidden>", "FAKEKEY123456789"],
      ["xoxb-FAKESLACK-123abc", "xox-<hidden>", "FAKESLACK"],
      ["AIzaFAKEGOOGLE12345", "AIza<hidden>", "FAKEGOOGLE12345"],
      ["AKIAFAKEAWSKEY123456", "AKIA<hidden>", "FAKEAWSKEY123456"],
    ];
    for (const [input, marker, gone] of cases) {
      const out = redactString(input);
      assert.ok(out.includes(marker), `${input} → expected ${marker}, got: ${out}`);
      assert.ok(!out.includes(gone), `${input} → secret survived: ${out}`);
    }
  });

  it("should NOT false-positive on ordinary words containing sk-", () => {
    const s = "risk-assessment and disk-space are ordinary words";
    assert.strictEqual(redactString(s), s);
  });

  it("should leave non-secret strings unchanged", () => {
    const s = "hello world https://example.com/mcp plain text 123";
    assert.strictEqual(redactString(s), s);
  });

  it("should be idempotent on already-redacted strings", () => {
    const once = redactString("https://x.com/s/abc?token=SECRET123");
    assert.ok(once.includes("<hidden>"));
    assert.strictEqual(redactString(once), once);
    assert.strictEqual(redactString("token=<hidden>"), "token=<hidden>");
    assert.strictEqual(redactString(`Bearer ${REDACTED}`), `Bearer ${REDACTED}`);
  });
});

describe("redactSecretsDeep", () => {
  it("should deep-redact nested objects and arrays without mutating input", () => {
    const input = {
      url: "https://mcp.zapier.com/s/abc?token=FAKEZAPTOKEN789",
      list: ["Bearer abcdef123456", "plain"],
      nested: { key: "sk-FAKEKEY123456789", n: 42, flag: true, nil: null },
    };
    const out = redactSecretsDeep(input);
    assert.ok(out.url.includes("token=<hidden>"), `got: ${out.url}`);
    assert.ok(!out.url.includes("FAKEZAPTOKEN789"));
    assert.strictEqual(out.list[0], "Bearer <hidden>");
    assert.strictEqual(out.list[1], "plain");
    assert.strictEqual(out.nested.key, "sk-<hidden>");
    assert.strictEqual(out.nested.n, 42);
    assert.strictEqual(out.nested.flag, true);
    assert.strictEqual(out.nested.nil, null);
    // 纯函数：入参不被修改
    assert.ok(input.url.includes("FAKEZAPTOKEN789"), "input must not be mutated");
    assert.strictEqual(input.nested.key, "sk-FAKEKEY123456789");
  });

  it("should pass through non-string scalars unchanged", () => {
    assert.strictEqual(redactSecretsDeep(42), 42);
    assert.strictEqual(redactSecretsDeep(null), null);
    assert.strictEqual(redactSecretsDeep(undefined), undefined);
    assert.strictEqual(redactSecretsDeep(true), true);
  });
});

describe("generateConfigRefMd redaction (guide layer)", () => {
  it("should not leak url token into generated config-ref.md", () => {
    const cfg: Record<string, unknown> = {
      type: "remote",
      url: "https://mcp.zapier.com/api/mcp/s/abc123?token=FAKEZAPTOKEN789",
      enabled: true,
    };
    const guide = analyzeMcpConfig("zapier-gmail", cfg, { version: "1.0", mcpServers: {} });
    const md = generateConfigRefMd("zapier-gmail", cfg, guide);
    assert.ok(!md.includes("FAKEZAPTOKEN789"), "config-ref.md must not contain the token");
    assert.ok(md.includes("token=<hidden>"), "config-ref.md should show redacted marker");
    assert.ok(md.includes("https://mcp.zapier.com/api/mcp/s/abc123"), "base url should remain for reference");
  });
});

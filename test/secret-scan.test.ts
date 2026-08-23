import { describe, it } from "node:test";
import * as assert from "node:assert";

describe("pre-commit secret scanner", () => {
  it("blocks secret values while allowing variable names and safe placeholders", async () => {
    const mod = await import("../dist/lib/secret-scan.js").catch(() => null);
    assert.ok(mod, "secret-scan module must exist");
    const safe = mod.scanForSecrets('OPENAI_API_KEY=<YOUR_OPENAI_API_KEY>\nTOKEN=<hidden>\nrequired=["GITHUB_TOKEN"]');
    assert.deepEqual(safe, []);
    const findings = mod.scanForSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456\napiKey="sk-FAKE12345678901234567890"');
    assert.ok(findings.length >= 2);
    assert.ok(findings.every((item: { evidence?: string }) => !item.evidence?.includes("FAKE123")), "findings must not echo secret values");
  });

  it("throws before unsafe serialized state can be written", async () => {
    const mod = await import("../dist/lib/secret-scan.js").catch(() => null);
    assert.ok(mod);
    assert.throws(() => mod.assertNoSecrets(JSON.stringify({ token: "ghp_abcdefghijklmnopqrstuvwxyz1234567890" }), "workspace-state.json"));
  });
});

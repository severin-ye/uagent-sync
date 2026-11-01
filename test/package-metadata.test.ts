import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_RUNTIME_ENGINE = "^22.22.2 || ^24.15.0 || >=26.0.0";

test("root manifest and lockfile advertise the supported runtime intersection", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    engines?: { node?: string };
    files?: string[];
  };
  const lockfile = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8")) as {
    packages?: { ""?: { engines?: { node?: string } } };
  };

  assert.equal(manifest.engines?.node, EXPECTED_RUNTIME_ENGINE);
  assert.equal(lockfile.packages?.[""]?.engines?.node, EXPECTED_RUNTIME_ENGINE);
  assert.ok(manifest.files?.includes("scripts/verified-public-profile.mjs"));
});

test("CI runs supported Node 22 and 24 releases instead of unsupported Node 20", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const matrix = workflow.match(/^\s+node: \[([^\]]+)\]/m)?.[1].split(",").map(v => v.trim());
  assert.deepEqual(matrix, ["22.22.2", "24.19.0"]);
});

test("DSH manifest declares runtime targets without promoting local checks to installable compatibility", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/dsh/package.json"), "utf8"));
  assert.equal(manifest.engines?.node, EXPECTED_RUNTIME_ENGINE);
  assert.equal(manifest.engines?.dsh, "0.1.0-rc.6 || 0.2.1-rc.5");
  assert.deepEqual(manifest.dsh?.compatibility?.dshReleases, {
    "0.1.0-rc.6": "unknown",
    "0.2.1-rc.4": "unknown",
    "0.2.2-alpha.2": "unknown",
    "0.2.1-rc.5": "unknown",
  });
});

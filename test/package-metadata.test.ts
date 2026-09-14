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

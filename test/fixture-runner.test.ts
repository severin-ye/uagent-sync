import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  isRetryableFixtureEnvironmentError,
  resolveGitExecutable,
  runGit,
  runWithFreshFixture,
  selectTrustedExecutable,
} from "./support/fixture-runner.js";

describe("fixture command runner", () => {
  it("retries one exact environment failure with a fresh fixture", () => {
    const fixtures: string[] = [];
    let attempts = 0;

    const result = runWithFreshFixture(
      () => {
        const fixture = `fixture-${fixtures.length + 1}`;
        fixtures.push(fixture);
        return fixture;
      },
      () => {
        attempts += 1;
        if (attempts === 1) throw new Error("pwd: write error: Bad file descriptor");
        return "ok";
      },
    );

    assert.equal(result, "ok");
    assert.equal(attempts, 2);
    assert.deepEqual(fixtures, ["fixture-1", "fixture-2"]);
  });

  it("fails after the single allowed retry when the environment error repeats", () => {
    const fixtures: string[] = [];

    assert.throws(
      () =>
        runWithFreshFixture(
          () => {
            const fixture = `fixture-${fixtures.length + 1}`;
            fixtures.push(fixture);
            return fixture;
          },
          () => {
            throw new Error("Unable to determine absolute path of git directory");
          },
        ),
      /Unable to determine absolute path of git directory/,
    );
    assert.deepEqual(fixtures, ["fixture-1", "fixture-2"]);
  });

  it("does not retry ordinary command failures", () => {
    let attempts = 0;

    assert.throws(
      () =>
        runWithFreshFixture(
          () => ({ id: ++attempts }),
          () => {
            throw new Error("fatal: ordinary git failure");
          },
        ),
      /ordinary git failure/,
    );
    assert.equal(attempts, 1);
    assert.equal(isRetryableFixtureEnvironmentError(new Error("permission denied")), false);
    assert.equal(isRetryableFixtureEnvironmentError(new Error("business assertion: Bad file descriptor")), false);
  });

  it("selects an absolute trusted Git executable and rejects WindowsApps shims", () => {
    assert.equal(
      selectTrustedExecutable([
        "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\git.exe",
        "C:\\Program Files\\Git\\cmd\\git.exe",
      ]),
      "C:\\Program Files\\Git\\cmd\\git.exe",
    );
    assert.throws(
      () => selectTrustedExecutable(["C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\git.exe"]),
      /trusted absolute Git executable/,
    );
  });

  it("passes Git arguments as argv, preserving spaces and shell metacharacters", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-runner-"));
    try {
      const git = resolveGitExecutable();
      assert.ok(path.isAbsolute(git), `Git path must be absolute: ${git}`);
      assert.doesNotMatch(git, /[\\/]WindowsApps[\\/]/i);
      assert.equal(runGit(fixture, ["init", "--initial-branch=main"]).code, 0);
      const value = "name with spaces ; $(not-a-command) & pipes";
      assert.equal(runGit(fixture, ["config", "user.name", value]).code, 0);
      assert.equal(runGit(fixture, ["config", "user.name"]).stdout.trim(), value);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});

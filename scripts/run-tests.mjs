// 跨 Node 版本测试入口：node --test 的 glob 参数是 Node 22+ 特性（18/20/21 会把
// "test/*.test.ts" 当字面量路径导致 "Could not find"），这里显式展开文件列表再调用。
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const defaultTestDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test");
// A private directory override keeps cancellation/exit-code regression tests
// isolated; npm test continues to use the repository test directory.
const testDir = path.resolve(process.env.UAGENT_SYNC_TEST_DIR ?? defaultTestDir);
const files = fs
  .readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => path.join(testDir, f));

if (files.length === 0) {
  console.error(`No test files found in ${testDir}`);
  process.exit(1);
}

// Pack/install tests invoke the package lifecycle, whose clean build removes dist/.
// Run test files serially so that real packaging cannot race CLI smoke tests.
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);

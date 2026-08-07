// 跨 Node 版本测试入口：node --test 的 glob 参数是 Node 22+ 特性（18/20/21 会把
// "test/*.test.ts" 当字面量路径导致 "Could not find"），这里显式展开文件列表再调用。
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test");
const files = fs
  .readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => path.join(testDir, f));

if (files.length === 0) {
  console.error(`No test files found in ${testDir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);

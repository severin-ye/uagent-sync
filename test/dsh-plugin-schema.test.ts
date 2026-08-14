import { describe, it } from "node:test";
import * as assert from "node:assert";
import { apply } from "../packages/dsh/index.js";

/**
 * DSH 插件 schema 契约守卫（2026-08-15 补）。
 *
 * 背景：uagent-sync-dsh 曾被 dsh-tools 的 author-schema 校验拦下
 * （`parameters.output.required must be true when present` 类报错）。那次是
 * 一次性诊断脚本验证的，没有提交级测试——本文件把它固化为回归测试。
 *
 * 机制：直接加载 packages/dsh/index.js 并执行 apply()，用 stub ctx 捕获全部
 * 工具定义。defineTool 在注册时做 author-schema 编译 + assertSupportedJsonSchema
 * 校验，任何契约破坏都会让 apply() 抛错，本测试即红。
 *
 * 版本锚定：@deepseek-ai/dsh-tools 由根 devDependencies 精确锁定 0.1.0-rc.6
 * （与 DSH 运行时 lockfile 的 ^0.1.0-rc.6 一致），CI 与真实运行环境校验同一契约。
 * 注意 packages/dsh 自己的 node_modules 不应存在陈旧副本（gitignored），否则会
 * 遮蔽根 devDeps 的版本——本测试在解析链上直接依赖这个约定。
 */
describe("dsh plugin schema contract (dsh-tools)", () => {
  it("apply() registers all 16 sync_* tools against the pinned dsh-tools contract", () => {
    const defs: Array<{ name: string; output?: { render?: unknown; schema?: unknown } }> = [];
    const ctx = {
      tools: {
        register: (def: { name: string }) => {
          defs.push(def);
          return () => {};
        },
      },
      skills: undefined,
    };

    apply(ctx as never, {});

    const EXPECTED = [
      "sync_export", "sync_import", "sync_diff", "sync_push", "sync_pull",
      "sync_status", "sync_verify", "sync_setup", "sync_init", "sync_create_repo",
      "sync_api_keys", "sync_guide", "sync_log", "sync_crystallize", "sync_update",
      "sync_changelog",
    ];
    assert.equal(defs.length, EXPECTED.length, `should register ${EXPECTED.length} tools, got ${defs.length}`);
    const names = defs.map((d) => d.name);
    for (const expect of EXPECTED) {
      assert.ok(names.includes(expect), `missing tool ${expect}`);
    }
    for (const def of defs) {
      assert.ok(def.output?.schema !== undefined, `${def.name}: output.schema must be present`);
      assert.equal(typeof def.output?.render, "function", `${def.name}: output.render must be a function`);
    }
  });
});

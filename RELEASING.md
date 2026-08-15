# 发布手册 (RELEASING)

## 版本规范

遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)：

- **patch**：Bug 修复、文档、测试（`1.1.0 → 1.1.1`）
- **minor**：新功能、向后兼容的行为变更（`1.1.0 → 1.2.0`）
- **major**：破坏性变更（`1.1.0 → 2.0.0`）

## 发布流程

> ⚠️ 本项目维护 **两个 npm 包**：根包 `uagent-sync`（CLI + opencode 插件）与 `packages/dsh`（`uagent-sync-dsh`，DSH bundle）。**版本必须同步递增**——`uagent-sync-dsh` 的 `dependencies.uagent-sync` 永远指向与自身同号的根包版本，否则会出现「源码 2.0.2 ≠ registry 2.0.2」的漂移。

1. **确认工作区干净**：`git status` 无未提交改动（CI 门禁依赖此状态）
2. **跑全量测试**：`npm run build && npm test`（node:test 全量必须全绿）
3. **同步版本号（两处）**：
   - 根 `package.json` 的 `version`
   - `packages/dsh/package.json` 的 `version` **以及** `dependencies.uagent-sync`（指向同号）
   - 检查其他版本引用（README / packages/dsh/README / CHANGELOG）
4. **更新 CHANGELOG.md**：把 `[Unreleased]` 内容移到新版本段，补日期
5. **提交 + 打 tag**（tag 覆盖两个包）：

   ```bash
   git add -A
   git commit -m "release: v<新版本>"
   git tag v<新版本>
   git push origin master --follow-tags
   ```

6. **等 GitHub Actions**：tag 推送触发 `Release` workflow（Windows runner）：
   - `npm ci` → `npm run build` → `npm test`（门禁，失败则不发版）
   - `npm pack` 生成 tarball
   - `gh release create <tag> --generate-notes` 创建 Release 并附加 tarball
7. **发布 npm（顺序固定）**：

   ```bash
   # 先发布根包（uagent-sync-dsh 的依赖需要它已存在于 registry）
   npm publish            # uagent-sync@<新版本>
   cd packages/dsh
   npm publish            # uagent-sync-dsh@<新版本>
   cd ../..
   ```

8. **干净环境 smoke test**：在无本地 checkout 的临时目录验证 DSH 插件独立可安装：

   ```bash
   npm pack uagent-sync-dsh   # 或直接指向 registry
   # 在测试 profile 安装并验证：插件加载 → sync_verify → sync_status → 3 个 skills 注册
   ```

## 消费方如何安装

GitHub Release 提供两种方式：

- **tarball**：`uagent-sync-<version>.tgz` —— 解压后 `npm install` + `npm run build`
- **源码**：`git clone`（或 `git submodule add`）+ `npm install && npm run build`

opencode 配置引用 `dist/plugin.js`（plugin 形态）或 `dist/cli.js`（CLI 形态）。

## 回滚

- 版本回滚：`git revert <tag-commit>` + 推送；已发布 Release 在 GitHub 页面上可删除
- 消费者回滚：checkout 旧 tag 重新构建

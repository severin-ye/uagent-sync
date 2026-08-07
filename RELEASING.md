# 发布手册 (RELEASING)

## 版本规范

遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)：

- **patch**：Bug 修复、文档、测试（`1.1.0 → 1.1.1`）
- **minor**：新功能、向后兼容的行为变更（`1.1.0 → 1.2.0`）
- **major**：破坏性变更（`1.1.0 → 2.0.0`）

## 发布流程

1. **确认工作区干净**：`git status` 无未提交改动（CI 门禁依赖此状态）
2. **跑全量测试**：`npm run build && npm test`（82 个测试必须全绿）
3. **更新 CHANGELOG.md**：把 `[Unreleased]` 内容移到新版本段，补日期
4. **打版本**（自动 commit + tag + push）：

   ```bash
   npm run release:patch   # 或 release:minor / release:major
   ```

   等价于：`npm version patch && git push --follow-tags`

5. **等 GitHub Actions**：tag 推送触发 `Release` workflow（Windows runner）：
   - `npm ci` → `npm run build` → `npm test`（门禁，失败则不发版）
   - `npm pack` 生成 tarball
   - `gh release create <tag> --generate-notes` 创建 Release 并附加 tarball

## 消费方如何安装

GitHub Release 提供两种方式：

- **tarball**：`uagent-sync-<version>.tgz` —— 解压后 `npm install` + `npm run build`
- **源码**：`git clone`（或 `git submodule add`）+ `npm install && npm run build`

opencode 配置引用 `dist/plugin.js`（plugin 形态）或 `dist/cli.js`（CLI 形态）。

## 回滚

- 版本回滚：`git revert <tag-commit>` + 推送；已发布 Release 在 GitHub 页面上可删除
- 消费者回滚：checkout 旧 tag 重新构建

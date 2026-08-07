# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.1.0] - 2026-08-07

### 新增

- workspace root 定位：支持环境变量 `OPENCODE_SYNC_WORKSPACE_ROOT` 显式指定（从任何目录启动 opencode 均可用）
- 固定缓存位置 `~/.config/opencode/sync-cache.json`——不再依赖进程 cwd，桌面/主目录/OpenChamber 默认目录启动也能恢复 workspace root
- `updateExtensions` 支持环境注入（`env.pluginCache` / `env.configDir`），测试不再依赖真实机器环境
- CI：GitHub Actions（Windows，Node 18/20/22），`npm run build` + `npm test` 门禁
- 发布流程：`release:patch|minor|major` 脚本 + tag 触发的 GitHub Release workflow（自动构建、测试、发布 tarball）

### 修复

- workspace root 定位缺陷：旧实现从 `process.cwd()` 向上找 `opencode-dotfiles/state/sync-cache.json` 相对路径，cwd 在 workspace 外时缓存不可达、必然抛错；现改为固定位置缓存 + 环境变量 + 旧缓存自动迁移
- 找不到 workspace 时的错误消息现在包含可操作引导（从 workspace 内启动或设置 `OPENCODE_SYNC_WORKSPACE_ROOT`）

### 变更

- `resolveWorkspaceRoot()` 查找顺序：内存缓存 → 环境变量 → 固定位置缓存 → 旧位置缓存（迁移）→ cwd 向上找 `.gitmodules`

## [1.0.0] - 2026-06-11

初始版本（历史记录合并）。跨设备同步 opencode 配置的 MCP server：export/import/diff/push/pull/init/setup/status/verify/create_repo/api_keys/guide 工具集。

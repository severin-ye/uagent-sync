# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [2.0.0] - 2026-08-07

### 新增

- **Codex 插件形态**：`.codex-plugin/plugin.json`（skills + hooks，预留 mcpServers 扩展位）+ SessionStart hook（注入 CLI 使用提示，Windows 经 Git bash polyglot 包装）
- **通用 skills（双端共享）**：`uagent-sync-backup` / `uagent-sync-restore` / `uagent-sync-update`——opencode 与 Codex 加载同一份目录（opencode 侧由 plugin 的 config 钩子自动注册）
- **CLI 补全 16 命令**：新增 `status` / `verify` / `setup` / `init` / `create-repo` / `api-keys` / `guide` / `log` / `crystallize`，与 opencode 插件工具完全对齐；CLI 成为双端唯一执行通道
- **GitHub marketplace 分发**：`codex plugin marketplace add severin-ye/uagent-sync` 即可安装

### 变更

- **更名**：`opencode-sync-mcp-server` → **`uagent-sync`**（GitHub 仓库、本地目录、package.json、代码路径、文档全部同步；旧仓库链接自动重定向）
- 工具/命令前缀保持 `opencode_sync_*` 不变（兼容既有文档与使用习惯）
- `detectWorkspaceInfo` 支持 `OPENCODE_SYNC_WORKSPACE_ROOT` 环境变量覆盖（与 `resolveWorkspaceRoot` 优先级一致）

### 修复

- `detectWorkspaceInfo` 在 env 指定 workspace 时不再读取本机固定缓存（测试/多工作区场景的正确性）

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

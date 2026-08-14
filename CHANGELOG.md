# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- **DeepSeek Harness bundle**（`packages/dsh/`）：16 个 `sync_*` 工具桥接 CLI + 共享 skills 注册为 DSH runtime skills；纯 JS 零构建（`dsh plugin add github:severin-ye/uagent-sync#main&path:packages/dsh`）
- **中文名 U同步 / 优同步**：语音触发词注册于 AGENTS.md 与三个 SKILL.md
- **看板双行正交轴**：迁移工作台重构为「目标端现状（缺失/已有/共享）× 我的决定（未决定/已决定）」正交筛选；动作精简为 4 项；旧决定自动映射
- **usync-dotfiles 数据目录重构**：三端共享状态 + `agents/<id>/`（config/manifests/env/runtime）+ 结构化 JSON know-how（组件级汇聚、按端分节）

### 变更

- 数据目录 `opencode-dotfiles/` → `usync-dotfiles/`（GitHub 仓库同名 rename，旧 URL 保留重定向）
- know-how 由 MD 三件套转为每组件一个 `know-how/<组件>.json`（general + agents.{opencode,codex,deepseek}）
- 路径字面量收敛至 `src/lib/dotfiles.ts` 常量

### 修复

- **DSH 插件 schema 契约回归测试**（`test/dsh-plugin-schema.test.ts`）：直接加载 `packages/dsh/index.js` 对 `apply()` 注册全部 16 工具，用 pin 在根 devDependencies 的 `@deepseek-ai/dsh-tools@0.1.0-rc.6` 校验 author-schema 契约（`required must be true when present` 类破坏将直接红）。同时清除 `packages/dsh/node_modules` 下的过期 dsh-tools 遮蔽副本——它会让插件解析到与运行时 lockfile（`^0.1.0-rc.6`）不一致的旧版本，也会让全新机器 `npm install` 后插件找不到 dsh-tools（对应早期 `ERR_MODULE_NOT_FOUND` 崩溃隐患）
- **CLI 旗标**：`--help` / `-h` / `--version` / `-V` 支持（此前被当作未知命令）；`uagent-sync` bin 别名与包名一致，`npx uagent-sync <cmd>` 可用（配合 npm 12 修复 Windows 上 npx 临时 bin 的 cmd PATH 查找问题）
- **tarball 打包卫生**：根包加 `files` 白名单（dist/skills/hooks/data/agent 配置/文档），首发 tarball 由 422 文件/1.2MB 收敛到 140 文件/130kB（原 `.npmignore` 未排除会话状态、备份、嵌套 node_modules）

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

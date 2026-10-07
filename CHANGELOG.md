# 2.2.0 — unified candidate (2026-09-17)

- Combines device profiles/identity/conflict protection with 2.1.2 target-aware, resumable crystallize.
- Version rationale: minor release; adds device workflows within the existing cross-device backup/restore capability while retaining prior entrypoints. No capability is removed.
- Candidate only: package tests do not certify host installation or completed migration.

# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [2.4.6] - 2026-10-07

- Fix project-source credential false positives when a Python condition ends in `token:` or `api_key:`. Only recognized assignments inspect initializer literals; unmatched text retains conservative scanning. Default profile scanning and literal credentials remain blocked.
- Add a regression for both conditions, adjacent literals/comments, and the unchanged default scanner.
- Reuse exact path/mode/blob tuples in the confirmed target remote tree instead of treating existing remote fixtures or public-key files as new uploads. Changed files, new paths and unpublished credential history remain scanned; unavailable remote-tree evidence grants no exemption.

## [2.4.5] - 2026-10-07

### 修复

- 私有快照发布仅对已逐文件检查的明确路径使用 literal force-add，防止复制进来的 `.gitignore` 静默遗漏个人文件；暂存后与提交后核对全部文件的 Git 对象摘要和数量，拒绝范围外改动和字节变化。
- 本机无改动且当前提交已在同一远端分支历史中时，只读核验已有备份并记录远端提交，不更新本机版本或推送；分叉、本地改动、暂存及分支目的地保护继续适用。
- 不扩大采集范围或放宽凭据检查；原失败快照和正式备份报告保留，发布阶段可用同一现有传输模块补齐。

## [2.4.4] - 2026-10-07

### 修复

- 扩展快照的 Base64 校验改用有界解码和规范编码往返比较，避免合法大文件触发正则调用栈溢出；不放宽文件大小、二进制类型或凭据内容限制。
- 补充大文本采集与验证、非规范编码拒绝、大文件真实凭据与未知二进制拒绝回归。实际备份中的遗漏仍须逐项解决，不以校验修复宣称完整备份。

## [2.4.3] - 2026-10-07

### 修复

- 既有公开源码核验脚本增加 `backup-all`，通过宿主组合调用同一个正式备份CLI和引擎，保留私有仓库、有效推送目的地、项目Git保护及遗漏收据；不创建第二套备份实现。
- 独立获取公开GitHub树与blob，核对110个被阻止文件的完整SHA256和换行；随应用维护的清单更新为119项。清单只含公开来源、固定blob和哈希，没有本地文件值或私密凭据。
- 普通CLI和默认扫描行为保持不变；本地改动、路径不符、未知文件、获取或校验失败继续拦截。完整备份仍需实际上传、项目和离线文件验收，源码通过不代表备份完成。

## [2.4.2] - 2026-10-07

### 修复

- 项目源码识别按文件选择JS/TS/JSX方言，限定处理解析器的数组交换误报；字典与下标键、TypeScript类型标注不再误认作凭据值，真实初始化字面量继续拦截。
- 环境模板中的非凭据数值和布尔配置可保留；凭据字段仍须使用占位符，不允许借模板上传实际连接口令或任意字符串。
- 按Z升级，不修改默认个人文件扫描和Git保护。真实完整备份仍须单独验证，收集阻断时不声称已经上传。

## [2.4.1] - 2026-10-07

### 修复

- 大工作区的完整备份报告逐项追加遗漏，避免参数展开造成栈溢出，不截断遗漏清单。
- 项目备份用语法解析区分敏感字段的代码表达式与内嵌值；保留字面量、注释、无效语法及非源码检查，其他配置扫描默认行为不变。仅明确的全占位符 `.env.example` / `.env.template` 可通过文件名检查，混入实际值仍阻断。
- 判级：修复2.4.0既有备份流程，按Z升至2.4.1；Git冲突、暂存改动、远端目的地和凭据边界不变。源码验收不等于用户资料已经备份。

## [2.4.0] - 2026-10-07

### 新增

- `uagent-sync backup --all` 与“U同步，备份所有”：统一采集 Codex 扩展实际内容、设置、规则、本地 Skills 和记忆到已有私有配置仓库，再逐项目提交并推送到各自已有 GitHub 远端，子仓库先于父仓库，核对远端 HEAD。
- `--dry-run` 展示注册工作区和项目计划，不生成快照、提交或上传。保留既有暂存区、冲突、分叉、凭据扫描和链接边界，失败保留本地产物与待推送提交；统一报告区分 complete/partial/failed，列出未覆盖文件和排除范围。
- 判级依据：在已有备份功能内增加用户可见的统一工作流，旧 push/device 入口保持兼容，按次版本从 2.3.0 升至 2.4.0。此版本不表示用户资料已执行备份或另一台设备已恢复。

## [2.3.0] - 2026-10-03

### 新增

- Codex 工作区导出保存真实插件版本、安装内容摘要和独立源码归档；恢复按完整市场标识安装固定内容，保持启用/禁用状态，并用新的 Codex 进程核对 Skill 发现。
- 同版本同步保护目标端修改，保留受控备份与接受基线；来源不可访问时可使用已保存内容，旧无内容状态明确报告验收缺口。生产依赖按锁文件重建，禁用安装脚本。

### 修复

- 不再把配置条目当成已安装插件、把市场 Git revision 当插件版本，或把所有个人本地市场当成宿主管理组件。不同市场同名插件保持独立，旧裸名称删除记录继续覆盖所有市场。
- 子命令 `--help` / `-h` 在读取工作区或执行写入前返回帮助，避免帮助查询触发导出。
- 跨版本升级分别处理本地回退副本与安全导出，不再因旧缓存无法导出而阻止已验证的新内容；拒绝覆盖已有的其他版本目标缓存。
- 判级依据：在既有跨设备备份/恢复目标内增加插件内容恢复与验收流程，保持旧状态兼容，升次版本至 2.3.0。Hook 信任、MCP 登录和业务调用仍需目标机验收，不将隔离软件测试写成惠普实机迁移完成。

## [2.2.2] - 2026-09-20

### 修复

- Windows 上更新已安装 Skills CLI 时，不再直接生成子进程执行 `skills` 或 `.cmd`；现在验证可信 npm shim 相邻的标准 Node 入口，并使用当前 Node、无 shell 执行 `skills update -g`。
- Skills CLI 未安装时明确记为 `skipped`，更新流程不会自动安装缺失组件，也不会把未执行写成成功。
- **判级依据**：`2.2.1 → 2.2.2`；本批恢复既有 Windows Skills 更新行为，不新增工作流或破坏兼容，按 Bug 修复升补丁位（Z）。

## [2.1.2] - 2026-09-13

### 修复

- 结晶将目标 Agent 贯穿单次状态快照和恢复指南；Codex 指南不再使用 OpenCode 安装说明。
- Skill 扫描逐条报告失效链接、消失条目和访问错误，保留正常条目与扫描不完整状态。
- 结晶失败明确报告部分进度；相同安装事件重试复用记录和产物，Git 续推保留子仓库先于父仓库的顺序并保护无关改动。
- 判级依据：恢复既有结晶目标、异常报告和失败恢复要求，属于 Bug 修复（Z）；不发布设备同步开发分支。

## [Unreleased]

- Fix Windows offline staging JSON decoding under non-UTF8 defaults; exclude nested Git metadata from personal profiles and reject legacy profiles containing it before restore writes. Add regression coverage following second-device acceptance feedback.

- Add modular `device` registration, alias resolution, registry reconnect, workspace coverage and offline staging reports, Codex personal-file snapshots with protected restore, explicit private GitHub registry transport, and the U同步/Severin device-handoff workflow. Full Skill collection and real second-device acceptance remain pending; no release is claimed.

### 修复

- **更新只处理已安装受管组件**：Skill 更新不再在规划阶段先执行一次；缺失的 uv MCP/CLI 与没有可核验持久实例的 npx MCP 明确记为 `skipped`，不再自动 `install --force` 或填充缓存。选中组件的命令失败统一记为 `error` 并让 CLI 非零退出。
- **自更新隔离与版本核验**：当前源码仓库仅用于读取、核验 origin；测试、打包和安装都在独立临时 `origin/master` clone 中执行，不再 pull、checkout 或改写用户的脏开发分支，成功失败均清理临时目录。安装后同时核验全局 CLI、Codex 插件与源码包版本，真实步骤使用各自配置的 timeout 文案。
- **判级依据**：`2.2.0 → 2.2.1`；本批恢复既有“更新已安装扩展并核验 Codex 插件缓存”的承诺，不新增能力，按 Bug 修复升补丁位（Z）。

### 新增

- **迁移分析统一入口**：资产盘点、覆盖与缺口、功能重叠与去重、兼容性、迁移决策、执行与验证共用同一 Dashboard 服务和显式分析范围；未选范围不扫描、不显示比较计数。旧扩展写入接口已冻结为 `410 upgrade_required`。
- 新增 V2 决策账本 `usync-dotfiles/policies/capability-decisions.json`（首次确认写入时才创建）；V1 `usync-dotfiles/agents/codex/policies/extension-conflicts.json` 保持原样。Codex 写入只接受暂存决定、精确 diff 和一次性二次确认；OpenCode/DeepSeek 始终只读。

## [2.1.0] - 2026-08-16

### 新增

- **全项目中英双语**：统一自研 i18n 机制（`src/i18n/`，零依赖，`t()` + 语言解析）——CLI 支持 `--lang en|zh` flag / `UAGENT_SYNC_LANG` 环境变量 / 系统 locale 检测，**默认英文**；dashboard 前端顶栏「中文 / EN」一键切换（localStorage `uagent-lang` 记忆）；dashboard-server API 错误与迁移草案理由按 `?lang=` 返回对应语言；CLI 输出/help/进度、lib 错误消息、生成文档（SYNC-GUIDE.md / know-how 文件）、opencode 插件运行时输出全部双语；工具描述保留中英触发词（"U同步，备份" 等）
- **DeepSeek Harness bundle**（`packages/dsh/`）：16 个 `sync_*` 工具桥接 CLI + 共享 skills 注册为 DSH runtime skills；纯 JS 零构建（`dsh plugin add github:severin-ye/uagent-sync#master&path:packages/dsh`）
- **中文名 U同步 / 优同步**：语音触发词注册于 AGENTS.md 与三个 SKILL.md
- **看板双行正交轴**：迁移工作台重构为「目标端现状（缺失/已有/共享）× 我的决定（未决定/已决定）」正交筛选；动作精简为 4 项；旧决定自动映射
- **usync-dotfiles 数据目录重构**：三端共享状态 + `agents/<id>/`（config/manifests/env/runtime）+ 结构化 JSON know-how（组件级汇聚、按端分节）

### 变更

- **版本对齐 2.0.3**：根包与 `uagent-sync-dsh` 同步升版，`packages/dsh` 的 `dependencies.uagent-sync` 指向同号；根包 description 同步为「Cross-device agent workspace sync for OpenCode, Codex, and DeepSeek Harness」
- 数据目录 `opencode-dotfiles/` → `usync-dotfiles/`（GitHub 仓库同名 rename，旧 URL 保留重定向）
- know-how 由 MD 三件套转为每组件一个 `know-how/<组件>.json`（general + agents.{opencode,codex,deepseek}）
- 路径字面量收敛至 `src/lib/dotfiles.ts` 常量

### 修复

- **crystallize git identity 继承（CI 修复）**：dotfiles 作为 submodule 的副本没有 local user.name/email、且环境无全局 identity 时，`git commit` 报 "Author identity unknown"（GitHub Actions runner 复现）。现从 workspace（parent）继承 identity 到 dotfiles 的 local config；两者都缺失则明确报错并给出配置指引
- **密钥安全代码层保证**：新增 `ensureSecretGitignore()`——写 API.md 前自动确保 `usync-dotfiles/.gitignore` 覆盖 `keys/`、`.env`（幂等，不依赖用户预配置）；crystallize 提交 dotfiles 前先 `git check-ignore keys/`，未 ignore 则拒绝提交。README "never values" 承诺由代码强制执行
- **uagent-sync-dsh 独立可安装（P0）**：`packages/dsh` 声明依赖 `uagent-sync`（npm 包自带 `dist/cli.js` + `skills/`），`resolveCliPath()` 新增 npm dependency 定位级（`node_modules/uagent-sync/dist/cli.js`，向上爬升兼容 pnpm 布局）——npm 安装形态不再依赖本机 checkout 即可直接调用 16 个 `sync_*` 工具
- **CLI `import` 支持 URL 源**：Node ≥18 全局 fetch，与 DSH/opencode 工具描述中的 "JSON/URL" 一致（此前 CLI 只读本地文件，三端描述不一致）
- **安装文档 `#main` → `#master`**：默认分支为 master，README / packages/dsh/README / CHANGELOG 统一修正
- **README 重构**：Installation 章节改为跨平台（DSH / OpenCode / Codex，DSH 安装命令前置）；CLI 命令表补齐 `inventory` / `dashboard`（16 → 18）；移除 82/95 等硬编码测试数量
- **API 密钥安全说明**：明确 `usync-dotfiles/keys/` 目录 gitignored，`api-keys` 写入的真实值只存在于本地、永不进入 Git 历史（与 README "never values" 承诺一致）
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

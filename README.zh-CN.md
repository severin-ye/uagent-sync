<p align="center">
  <img src="https://raw.githubusercontent.com/severin-ye/uagent-sync/master/assets/uagent-sync-readme-hero-banner.png" alt="uagent-sync" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square" alt="Node.js 18+">
  <img src="https://img.shields.io/github/actions/workflow/status/severin-ye/uagent-sync/ci.yml?style=flat-square&label=CI" alt="CI">
  <img src="https://img.shields.io/github/v/release/severin-ye/uagent-sync?style=flat-square&color=blue" alt="Release">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT">
  <a href="./README.md"><img src="https://img.shields.io/badge/English-Switch%20Language-blue?style=flat-square" alt="English"></a>
</p>

<h1 align="center">uagent-sync</h1>

<p align="center">
  <strong>一条命令备份，一条命令恢复。你的整个开发环境，跨设备同步。</strong>
</p>

<p align="center">
  把你的智能体工作区——子模块、配置、技能、API 密钥模板——导出到私有 GitHub 仓库。<br>
  在新设备上拉回来，一切自动安装。
</p>

---

## 为什么

你有不止一台机器。每台机器上的 opencode / Codex 都装着不同的插件、MCP 服务器、技能，子模块也停留在不同提交。手动同步是一场噩梦：`git submodule update`、`npx skills add`、复制粘贴配置文件……

**uagent-sync** 把它变成一条命令：

```bash
# 主机器上
opencode-sync push "周五备份"

# 新电脑上
opencode-sync pull
```

就这样。子模块重置到精确提交，MCP 服务器重建，技能重装，配置合并，API 密钥模板化。一切自动完成。

---

## 安装

uagent-sync 提供一套 CLI 与三个智能体入口。按你使用的平台安装：

### DeepSeek Harness

```sh
# 从 npm 安装（推荐——随依赖自动带入 CLI）
dsh plugin --profile <name> add uagent-sync-dsh

# 或从 GitHub 安装（monorepo 子包，纯 JS，无需构建授权）
dsh plugin --profile <name> add "github:severin-ye/uagent-sync#master&path:packages/dsh"
```

### OpenCode

```sh
npm install -g uagent-sync        # 全局 CLI（命令名：uagent-sync / opencode-sync）
# 或免安装直接运行：
npx uagent-sync <命令>
```

然后把它加进 opencode 配置（`config/opencode.json`）并重启：

```json
{ "plugin": ["file:///绝对路径/uagent-sync/dist/plugin.js"] }
```

### Codex

```sh
codex plugin marketplace add severin-ye/uagent-sync
# 然后在 Codex CLI 中打开 /plugins，安装 uagent-sync，新会话生效
```

### 迁移分析与功能去重

迁移分析是唯一的 Dashboard 模块，内部包含覆盖与缺口、兼容性、功能重叠与去重、迁移决策、执行与验证。运行 `uagent-sync dashboard --page migration-analysis` 后，选择单 Agent（检查同一 Agent 内的功能重复）或明确的来源/目标 Agent（迁移比较）；未选择范围时不扫描、不显示比较结果和数量。来源统一标记为官方、第三方、本地或未知；官方身份必须有受控安装证据。`agent-browser → browser/chrome` 是一个功能分组，保留多条证据边和一个动作控件。

V1 审计账本 `usync-dotfiles/agents/codex/policies/extension-conflicts.json` 只读保留。首次确认写入时才在事务内创建/导入 V2 账本 `usync-dotfiles/policies/capability-decisions.json`。Codex 写入必须经过暂存、精确配置/账本 diff 和一次性二次确认；OpenCode、DeepSeek 永远只读，不卸载或删除扩展。旧 `/extension-conflicts` 仅作为统一 Dashboard 的兼容入口。

### 首次备份

```sh
opencode-sync init          # 检测工作区
opencode-sync push "init"   # 首次备份
```

> **改用源码？** `git clone https://github.com/severin-ye/uagent-sync && cd uagent-sync && npm install && npm run build`，之后用 `node dist/cli.js <命令>`。
>
> **新设备？** 先 `opencode-sync init --init-type sync --github-url <地址>`，再 `opencode-sync pull`。

---

## Codex 支持

uagent-sync 同时是一个 **Codex 插件**（`skills` + `hooks`，不依赖 MCP）：同一套 CLI、同一批技能，两端共享。

### 安装（Codex CLI）

```bash
codex plugin marketplace add severin-ye/uagent-sync
# 然后在 Codex CLI 中打开 /plugins，安装 uagent-sync，新会话生效
```

### 安装（ChatGPT 桌面版 / Codex 桌面版）

1. 打开 **Plugins** → **Personal** → 添加 marketplace 源 `https://github.com/severin-ye/uagent-sync`
2. 安装 uagent-sync，开新会话

### 安装后获得什么

- **3 个技能**：`uagent-sync-backup`（备份流程）、`uagent-sync-restore`（新设备恢复）、`uagent-sync-update`（生态更新）——按需加载，指导智能体调用 CLI
- **会话启动钩子**：会话开始时注入 CLI 使用提示（`PLUGIN_ROOT` 环境变量定位插件根，Windows 经 Git bash 包装）
- **CLI（唯一执行通道）**：`node <插件目录>/dist/cli.js <命令>`，18 个命令与 opencode 插件共享同一套 CLI

### 原理

```
uagent-sync/
├── .codex-plugin/plugin.json   # Codex 插件清单（skills + hooks，预留 mcpServers 扩展位）
├── hooks/                      # hooks-codex.json + run-hook.cmd + session-start
├── skills/                     # 3 个 SKILL.md —— opencode 与 Codex 共享同一份
├── src/plugin.ts               # opencode 插件（config 钩子自动注册技能目录）
└── src/cli.ts                  # 18 命令 CLI —— 三端唯一执行通道
```

---

## DeepSeek Harness 支持

uagent-sync 同时以 **DeepSeek Harness bundle** 形态分发（`packages/dsh/`）：注册 16 个 `sync_*` 工具（与 opencode 插件的 `opencode_sync_*` 一一对应），全部通过 CLI 桥接执行。中文名：**U同步 / 优同步**。

### 安装

```sh
# 从 npm（推荐——uagent-sync-dsh 依赖 uagent-sync，CLI 随依赖带入）
dsh plugin --profile <name> add uagent-sync-dsh

# 从 GitHub（monorepo 子包，纯 JS，无需构建授权）
dsh plugin --profile <name> add "github:severin-ye/uagent-sync#master&path:packages/dsh"

# 或本地 checkout（自动发现 dist/cli.js）
dsh plugin --profile <name> add ./packages/dsh
```

插件按以下顺序定位 CLI：cordis.yml `config.cliPath` → 环境变量 `OPENCODE_SYNC_UAGENT_SYNC_CLI` → 本地 checkout 相对路径 → npm 依赖 `uagent-sync/dist/cli.js` → 工作区递归（向上找 `.gitmodules` 再找 `uagent-sync/dist/cli.js`）。详见 [packages/dsh/README.md](packages/dsh/README.md)。

DSH 插件加载时还会把共享技能（`uagent-sync-backup/restore/update`）注册为 DSH runtime skills——从 CLI 所在 checkout 的 `skills/` 目录读取，与 opencode/Codex 是同一份。

---

## 工作区根目录定位

所有 `node dist/cli.js *` 命令都需要知道工作区根目录（包含 `.gitmodules` 的目录）。定位顺序：

1. 环境变量 **`OPENCODE_SYNC_WORKSPACE_ROOT=<路径>`**（显式指定，优先级最高）
2. 固定缓存 `~/.config/opencode/sync-cache.json`（任何启动目录都能读到）
3. 旧位置缓存自动迁移（`usync-dotfiles/state/sync-cache.json`，v1.0.0 写入）
4. 从 opencode 进程启动目录逐级向上找 `.gitmodules`

> 从桌面、主目录或 OpenChamber 默认目录启动 opencode 也能正常解析——不需要在工作区内启动。四种途径全部失败时，错误信息会给出可操作的引导。

---

## 同步内容

| 类别 | 内容 | 方式 |
|------|------|------|
| **子模块** | 所有仓库，精确提交号 | `git clone` + `git reset --hard` |
| **OpenCode 配置** | 插件、MCP 服务器、模型供应商 | 深度合并，绝不覆盖 |
| **技能** | 从 git 源安装的技能包 | `skills add <源> -g` |
| **API 密钥** | 名称 + 说明（绝不包含值） | 模板文件 `keys/API.md` —— `keys/` 目录在 `usync-dotfiles` 中已 gitignore，真实值只存在于本机 |
| **依赖** | gh CLI、Ralph、Skills CLI | winget/brew/apt/npm 自动安装 |
| **Windows 修复** | NTFS 路径问题 | 自动检测问题文件名，应用 `git config core.protectNTFS` |
| **安装日志** | 每次安装的来源与踩坑 | `state/install-log.json` —— 可追溯 |

---

## 多 Agent 配置看板

以只读方式检查 Codex、OpenCode 和 DeepSeek Harness 配置：

```bash
opencode-sync inventory --json
opencode-sync dashboard
```

看板默认只监听 `127.0.0.1`，启动后会输出实际本地地址。第一阶段只做扫描和可视化：展示 Skills、规则、MCP 声明、Hooks、插件/工具、可迁移性与缺口，不在网页中修改配置。密钥值、Session、Memory、Provider 凭据、权限、主题、快捷键、UI 状态和缓存均不进入清单。DeepSeek MCP 在本机证据明确前始终标记为“未证实”。

“迁移建议”页面支持 Codex、OpenCode、DeepSeek Harness 之间的六个迁移方向。它按能力而不是插件名称生成只读草案，并将系统建议与用户决定分开显示。用户可以先选择一套统一法则，再逐项覆盖冲突能力；目标平台官方版本、目标原生重复能力、待验证兼容性和最后兜底的自制适配器会被区别标记。本阶段不会下载扩展、启用插件或改写任何 Agent 配置。

只读 API 也可以直接查看草案：

```text
GET /api/migration-draft?from=codex&to=opencode&policy=recommended
```

可用策略为 `recommended`、`prefer_target_native`、`prefer_source_workflow`、`keep_both` 和 `ask_each`。完整能力边界见 [`docs/multi-agent-capability-migration-spec.zh-CN.md`](docs/multi-agent-capability-migration-spec.zh-CN.md)。

### 🌐 语言（English / 中文）

输出**默认英文**，可随时切换为中文：

- **CLI**：`--lang zh` 参数，或环境变量 `UAGENT_SYNC_LANG=zh`（兜底依次为系统 locale、英文）。
- **看板**：顶栏 **中文 / EN** 一键切换，选择保存在 `localStorage`（键 `uagent-lang`）。
- 生成的文档（SYNC-GUIDE.md、know-how 文件）跟随当前语言。

```bash
opencode-sync api-keys detect            # 默认英文
opencode-sync api-keys detect --lang zh  # 中文
UAGENT_SYNC_LANG=zh opencode-sync guide  # 中文引导文档
```

## CLI（18 个命令）

所有命令以 `node dist/cli.js <命令>` 执行（`npm link` 后可简写为 `opencode-sync <命令>`）。

| 命令 | 作用 |
|------|------|
| `init` | 检测工作区，引导首次设置。只问一次。 |
| `push` | 导出状态 → 提交 → 推送到 GitHub。一条命令。 |
| `pull` | 从 GitHub 拉取 → 恢复一切。一条命令。 |
| `export` | 导出完整工作区状态为 JSON |
| `import` | 从 JSON/URL 恢复（支持 `--dry-run` 预览） |
| `diff` | 对比当前状态与已保存状态 |
| `status` | 查看每个子模块：提交、分支、是否脏 |
| `verify` | 环境健康检查：gh、git、配置、ralph、技能、子模块 |
| `setup` | 安装一切：gh、子模块、配置、ralph、Skills CLI、技能包 |
| `create-repo` | 创建**私有** GitHub 仓库（公开会警告） |
| `api-keys` | 检测、生成模板或添加 API 密钥 |
| `guide` | 生成 `guide/SYNC-GUIDE.md` —— 恢复手册 |
| `log` | 读写安装溯源日志 |
| `crystallize` | 记录安装 + 重生成文档 + 导出状态 + 一键提交 |
| `update` | 更新智能体生态：插件、技能、MCP 工具、同步仓库、配置依赖 |
| `changelog` | 从最新更新报告起草分类变更日志 |
| `inventory` | 只读扫描 Codex/OpenCode/DeepSeek Harness 配置（不含密钥值） |
| `dashboard` | 启动本地只读配置看板（默认监听 `127.0.0.1`） |

> MCP 服务器形态（v1.0.0）已移除——自 v1.1.0 起仅提供 opencode 插件形态与独立 CLI。工具/命令前缀保留 `opencode_sync_*` / `node dist/cli.js` 以兼容既有习惯。

---

## 架构

```
uagent-sync/                  # ← 本仓库（纯代码，运行时永不修改）
├── src/
│   ├── lib/                   # 模块，每个 <200 行
│   │   ├── types.ts           #   全部接口定义
│   │   ├── run.ts             #   Shell 执行与安全（shellEscape, isPathSafe）
│   │   ├── cache.ts           #   工作区根定位（固定缓存 + 环境变量 + 迁移）
│   │   ├── init-state.ts      #   初始化生命周期跟踪
│   │   ├── log.ts             #   安装溯源日志
│   │   ├── state.ts           #   导出/导入/对比核心逻辑
│   │   ├── workspace.ts       #   验证/设置/子模块状态
│   │   ├── github.ts          #   私有仓库创建
│   │   ├── keys.ts            #   API 密钥检测与模板
│   │   ├── skills.ts          #   技能源映射
│   │   ├── update.ts          #   updateExtensions —— 生态更新编排
│   │   └── guide.ts           #   SYNC-GUIDE.md 生成器
│   ├── sync.ts                # 汇总导出
│   ├── plugin.ts              # opencode 插件（16 个 opencode_sync_* 工具）
│   └── cli.ts                 # 独立 CLI（18 个命令）
├── skills/                    # 3 个共享技能（opencode + Codex + DSH）
├── hooks/                     # Codex 会话启动钩子
├── .codex-plugin/             # Codex 插件清单 + marketplace
├── packages/dsh/              # DeepSeek Harness bundle（16 个 sync_* 工具）
├── test/                      # node:test 测试套件（npm test 全量）
├── .github/workflows/         # CI + 发布自动化
├── CHANGELOG.md               # 变更日志
├── RELEASING.md               # 发布手册
└── dist/                      # 编译产物

usync-dotfiles/             # ← 运行时数据（独立仓库，随 Git 同步）
├── state/                     # 运行时状态文件
├── guide/                     # 自动生成的文档
├── keys/                      # API 密钥模板
├── config/                    # OpenCode 配置模板
├── sessions/                  # 聊天记录（来自会话录制插件）
└── scripts/                   # 引导脚本
```

> **代码永不触碰数据。** 插件代码在一个目录，所有生成文件写入 `usync-dotfiles/`。职责分离。

---

## 开发

```bash
git clone https://github.com/severin-ye/uagent-sync
cd uagent-sync
npm install
npm run typecheck    # tsc --noEmit
npm run build        # TypeScript → dist/
npm test             # 全量测试（node:test）
npx playwright install chromium  # 首次安装浏览器
npm run test:e2e     # 真实 Dashboard 浏览器流程
```

CI 门禁（GitHub Actions，Windows，Node 20/22）：构建、单元测试和 Playwright 浏览器 E2E 全部通过才能合并。

---

## 发布

见 [`RELEASING.md`](./RELEASING.md)。流程：更新 CHANGELOG → `npm run release:patch|minor|major`（版本号 + tag + 推送）→ GitHub Actions 自动构建、测试并创建 Release（附带 tarball）。

---

## 安全

- **命令注入加固**：`shellEscape()` 包裹所有进入 Shell 的用户输入；Git 提交用 `-F` 文件输入而非 `-m` 字符串拼接。
- **路径穿越防护**：`isPathSafe()` 校验所有文件路径都落在工作区根内。
- **Zod 模式校验**：每个输入都经 `.min()`/`.max()`/`.strict()` 校验后才触碰文件系统。
- **密钥绝不导出**：只记录环境变量_名称_，值永远留在本机。`usync-dotfiles/keys/` 目录已 gitignore，即使 `api-keys add --key-value` 写入的真实值也只存在于本地、永不进入 Git 历史。
- **默认私有仓库**：`create_repo` 创建 `--private`；发现公开仓库会警告。

---

## 参与贡献

欢迎 PR。测试先行：新功能附带测试，Bug 修复先写复现用例（红）再修复（绿）。测试套件设计见 `evaluation.xml`。

> **🤖 给智能体：** 详见 [`AGENTS.md`](./AGENTS.md)——完整的逐步指南，让任何智能体无需额外提示即可完成安装、配置与备份/同步全流程。把智能体指向本仓库即可。

---

## 许可证

MIT © 2026 uagent-sync contributors

---

**简体中文** | [**English**](./README.md)

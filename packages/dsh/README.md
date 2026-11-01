# uagent-sync-dsh — U同步 / 优同步（DeepSeek Harness 插件）

> 🌐 插件桥接的 CLI 输出与 dashboard 支持中英双语：默认英文，可通过 `--lang zh` 或 `UAGENT_SYNC_LANG=zh` 切换（dashboard 顶栏有 中文 / EN 一键切换按钮）。CLI 工具描述保留中英触发词（如 "U同步，备份" / "sync to GitHub"）以便语音与自然语言调用。

uagent-sync 的 DeepSeek Harness bundle 形态。注册 16 个 `sync_*` 工具（与 opencode plugin 的 `opencode_sync_*` 一一对应，分别桥接 CLI 中对应的同步命令；uagent-sync CLI 当前共 18 个命令，其中 `inventory` / `dashboard` 不作为 DSH tool 暴露），全部通过 **uagent-sync CLI 桥接执行**——与 Codex 形态（skills + hooks）保持同一"CLI 单一执行通道"架构。

插件加载时还会把共享 skills（`uagent-sync-backup/restore/update`）注册为 DSH runtime skills——从 CLI 所在 checkout 的 `skills/` 目录读取，与 opencode/Codex 是同一份，正文中的 `<uagent-sync>` 占位符自动替换为真实路径，Agent 可直接执行。skills 目录缺失时静默跳过（工具不受影响）。

中文名：**U同步**（别名 **优同步**）。语音命令：

- "U同步，更新所有扩展" → `sync_update`
- "U同步，备份" → `sync_push`（配合 init/create_repo/api_keys/guide）
- "U同步，恢复" → `sync_pull`（配合 init/setup/api_keys）
- "U同步，检查环境" → `sync_verify`

## 工具清单（16 个）

| 工具 | CLI 命令 | 用途 |
|------|---------|------|
| `sync_export` | `export` | 导出工作区状态 JSON |
| `sync_import` | `import` | 从 JSON/URL 恢复 |
| `sync_diff` | `diff` | 对比当前与已保存状态 |
| `sync_push` | `push` | 导出 + 提交 + 推送到 GitHub |
| `sync_pull` | `pull` | 拉取 + 应用状态 |
| `sync_status` | `status` | 子模块状态 |
| `sync_verify` | `verify` | 环境健康检查 |
| `sync_setup` | `setup` | 安装工作区依赖 |
| `sync_init` | `init` | 初始化（backup/sync） |
| `sync_create_repo` | `create-repo` | 创建私人 GitHub 仓库 |
| `sync_api_keys` | `api-keys` | 密钥模板 detect/generate/add |
| `sync_guide` | `guide` | 生成 SYNC-GUIDE.md |
| `sync_log` | `log` | 安装溯源日志 read/add/export |
| `sync_crystallize` | `crystallize` | 记录安装 + 文档 + 导出 + 一键提交 |
| `sync_update` | `update` | 更新 coding-agent 生态 |
| `sync_changelog` | `changelog` | 从更新报告提取变更证据 |

## 安装

> DeepSeek Harness 目前是 Developer Preview，以下命令以当前版本为准。

**方式一：从 npm 安装（推荐）**

```sh
dsh plugin --profile <name> add uagent-sync-dsh
```

> 3.1.0 候选正式发布后应安装 `uagent-sync-dsh@3.1.0`（依赖精确的 `uagent-sync@3.1.0`）；当前已发布版本仍为3.0.0。插件声明依赖 `uagent-sync`（npm 包内含 `dist/cli.js` 与 `skills/`），安装后 CLI 自动随依赖带入，独立可安装。

**方式二：从 GitHub 安装（本仓库 monorepo 子包）**

```sh
dsh plugin --profile <name> add "github:severin-ye/uagent-sync#3a81c8abdfdff24852098a354ed36c4b65669a1a&path:packages/dsh"
```

> 固定到已发布且已核验的3.0.0提交；该子包依赖可从npm获取的精确CLI3.0.0。`master`目前包含未发布的3.1.0候选，不能代替可安装的发布基线；待3.1正式发布并通过registry/安装器验收后再更新固定提交。本包是纯JavaScript，无需`prepare`构建授权（pnpm ≥10的allowBuilds步骤不会出现）。

**方式三：本地 checkout 安装**

```sh
# 在 uagent-sync 仓库内先构建 CLI：
npm install && npm run build

dsh plugin --profile <name> add ./packages/dsh
```

本地安装时插件自动通过相对路径发现 `dist/cli.js`，无需配置。

## 测试与契约守卫

### 固定源码与商城兼容状态

`engines.node` 与主 CLI 的锁定运行依赖声明保持一致；`engines.dsh` 列出当前契约检查的运行时目标。精确 `dsh.compatibility.dshReleases` 记录保留为 `unknown`，范围匹配不代表已满足商城安装条件。

2026-11-01 在一次性 DSH 0.2.1-rc.5 Profile 中，本地 checkout 的安装、启动帮助入口和配置组合通过；真实 Cordis 服务注册了 16 个工具与 3 个共享 Skills，卸载后均无残留。该检查没有调用模型或备份私人数据。共享 Skills 显式声明 `source: runtime`，符合当前 Skill 注册接口。

这仍是本地源码的部分证据：旧源码候选所依赖的 `uagent-sync@2.5.1` 当日从官方 npm registry 查询返回 E404；本次统一改为 3.0.0，正式发布及 registry 验收独立记录于 [发布验收](../../docs/validation/release-3.0.0.md)，不能据本地 link 安装声称 GitHub/npm 分发已可独立安装。恢复商城可安装状态前，必须完成正式 CLI 依赖发布、固定分发物的安装/启动/卸载/回退验收，以及商城要求的供应链和权限审核。不得用旧提交或本地依赖替代这几项证据。

- **桥接层测试**：`test/dsh-plugin.test.ts` 覆盖 CLI 定位/参数映射/spawn/渲染（`packages/dsh/lib/cli.js`，纯 JS 零依赖）。
- **schema 契约守卫**：`test/dsh-plugin-schema.test.ts` 直接加载 `index.js` 执行 `apply()`，对根 devDependencies 锁定的 `@deepseek-ai/dsh-tools@0.1.0-rc.6` 注册全部 16 工具——dsh-tools 的 author-schema 校验（如 `required must be true when present`）破坏会在 CI 直接红。
- **版本解析约定**：`packages/dsh/node_modules` 不应存在（gitignored 陈旧副本会遮蔽根 devDeps 的 dsh-tools 版本）。全新机器在仓库根 `npm install` 即可满足插件解析。

## CLI 定位与配置

工具执行前按以下顺序定位 `dist/cli.js`：

1. cordis.yml 配置：`config: { cliPath: '/abs/path/to/uagent-sync/dist/cli.js' }`
2. 环境变量：`OPENCODE_SYNC_UAGENT_SYNC_CLI`
3. 本地 checkout 相对路径（方式二自动命中）
4. npm dependency：`node_modules/uagent-sync/dist/cli.js`（方式一自动命中，无需配置）
5. 工作区递归：从 cwd 向上找 `.gitmodules`，在其下找 `uagent-sync/dist/cli.js`

全部失败时工具返回可操作的错误指引（fail loud）。

```yaml
# 在 profile 的 cordis.patch.yml 里覆盖配置示例
- id: uagent-sync
  name: uagent-sync-dsh
  config:
    cliPath: 'C:/Users/you/Codelib/2_Business/uagent-sync/dist/cli.js'
    commandTimeoutMs: 1800000   # update 全量可能 30 分钟，默认 10 分钟
```

## 三端对照

| | opencode | Codex | DeepSeek Harness |
|---|---|---|---|
| 形态 | plugin（16 `opencode_sync_*` 工具） | skills + hooks | bundle（16 `sync_*` 工具） |
| 执行通道 | 进程内调用业务函数 | CLI | CLI 桥接 |
| 共享资产 | skills/ 目录 | skills/ 目录 | skills/ 目录 + CLI |
| 分发 | `dist/plugin.js` | marketplace | `dsh plugin add` |

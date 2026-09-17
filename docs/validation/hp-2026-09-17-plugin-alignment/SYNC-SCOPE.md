# U同步持续插件安装与更新覆盖核对

审计对象：`<HP_CHECKOUT>`，源码 HEAD `dcffe24`；统一生产基线 `d6a4d937`。本次只读检查未运行 update、setup、pull、安装或全量测试，也未修改源码、真实配置或宿主信任状态。

GitNexus 的可用索引只包含工作区副本，不包含目标 `hpb/src`；读取目标仓库查询时返回 `Repository not found`。因此以下结论以目标源码的真实调用与现有测试/验收文档为证据，不能声称目标仓库已完成 GitNexus 图索引分析。

## 结论

- Codex 的持续更新入口是 `update --target-agent codex --components sync`，不是 `--components plugins`。`plugins` 组件只扫描和更新 OpenCode 的 `~/.cache/opencode/packages`；Codex 的 marketplace/plugin 更新被放在 `sync` 专用流程中。
- `sync` 对可定位到的 U同步源代码仓库执行 fast-forward 拉取、`npm ci`、测试、打包和全局 CLI 安装，然后刷新 Codex marketplace、安装 `uagent-sync@uagent-sync`，并用 `codex plugin list --json` 校验启用状态与精确版本。因此它能持续升级 U同步插件本体，但不复制或同步 Codex 插件缓存、运行时依赖目录或 Hook 信任。
- 跨机安装由 bootstrap + `pull` + `setup` 覆盖：bootstrap 克隆/更新源和 dotfiles，构建测试并打包，全局安装 CLI，注册个人 marketplace 并安装插件；`setup` 再调用 Codex restore 安装清单中的插件、MCP 和 Skill。仅 export/import 或个人 profile restore 不会执行这些安装动作。
- 知行 hp-fixed 没有被 sync 自动升级覆盖：该流程硬编码安装 uagent-sync@uagent-sync。本地 marketplace 被 state.ts 标为 codex-runtime，restore 跳过；改成本地Git目录本身也不会新增知行更新流程。
- Hook 信任是宿主状态，当前代码只检查 Hook 文件存在或插件启用；没有导出、导入、profile restore 或 update 步骤能证明或改变信任。现有 HP 统一验收记录仍把 Hook trust 标为 `untrusted`，所以不能把插件安装成功写成 Hook 已加载或已信任。

## 逐项证据与缺口

| 范围 | 实际行为 | 证据与缺口 |
|---|---|---|
| CLI 组件语义 | `plugins` 仅在非 Codex target 更新 OpenCode 包缓存；Codex target 会跳过它。`skills`、`mcp`、`cli` 仍更新全局工具；`config-deps`、`opencode` 对 Codex 跳过。 | `src/lib/update.ts:340-425,508-512`。组件名对 Codex 插件并不直观，单独传 `plugins` 不会更新 Codex plugin。 |
| Codex 持续更新 | `sync` 对源仓库执行 `git pull --ff-only origin master`、`npm ci`、`npm test`、`npm pack`、全局 `npm install`；随后通过 Codex CLI 注册/刷新同源 marketplace、`codex plugin add`，最后要求 `uagent-sync` 已安装、enabled 且版本等于源 `package.json`。 | `src/lib/update.ts:437-505,513-579`。此处能验证插件本体版本；没有 cache/runtime dependency 或 Hook trust 校验。普通 update 的 marketplace 刷新只做远端 git 流程；bootstrap 才有同源本地回退。 |
| Codex adapter/inventory | adapter 只读 `.codex/config.toml`、MCP、`.agents/skills`/`.codex/skills` 和 Hook 文件存在性；不扫描 marketplace 目录、plugin cache、运行时包版本、加载状态或信任。 | `src/lib/adapters/codex.ts:7-15`、`src/lib/agent-paths.ts:4-31`、`src/lib/agent-inventory.ts:15-20`。插件能力类型虽存在，扫描结果不产生实际 plugin capability。 |
| export | export 从 TOML 记录 plugin 的 id/marketplace/source/version/enabled，以及 MCP/Skill 元数据；会保留缺源和诊断为不完整。不会复制插件 cache/runtime，也不发现 host trust。 | `src/lib/state.ts:289-391`、`src/lib/types.ts:24-47`。导出清单是配置/元数据快照，不是可运行插件包。 |
| import 与实际安装 | Codex import 只接受 manifest 并明确跳过 OpenCode 配置；实际 Codex plugin/MCP/Skill 安装在后续 `setupWorkspace` → `restoreCodexExtensions` 中执行。插件恢复会 `marketplace add` 后 `plugin add`；runtime-managed 项目被跳过，需主机自有运行时。 | `src/lib/state.ts:524-534`、`src/lib/workspace.ts:237-276`、`src/lib/codex-restore.ts:226-430`。因此“导入成功”不等于“插件已安装/已加载”。 |
| verify 与信任 | Codex verify 会调用 `codex plugin list --json`，可检查 `uagent-sync` installed/enabled，并检查 Skill/MCP；不核对 marketplace origin、cache/runtime、精确插件版本或 Hook trust。普通环境检查使用 shell-backed `run`，不是可信 shim。 | `src/lib/workspace.ts:58-108`、`src/lib/run.ts:25-32`。更新专用 Codex plugin 操作使用 `executeTrustedCommand`，但这只约束命令入口，不是宿主 Hook trust 证明。 |
| device profile | profile 可携带配置中的 `plugins`、`marketplaces` 等 portable keys，并保留本机表；明确排除 auth、plugin cache/runtime、sessions/SQLite、automations 和 host trust。配置条目写入不代表插件已安装。 | `src/lib/codex-profile.ts:8-18,130-169,194-280`、`src/entrypoints/device-cli.ts:11-18,35-49`、`docs/DEVICE-SYNC-USAGE.md:32-66`。仍需单独安装、加载和业务验收。 |
| Hook | Hook manifest 与 session-start 脚本随包提供；扫描器只看 `.codex/hooks.json` 是否存在。wrapper 找不到 Git Bash 时可静默返回 0；代码无信任授予或信任验收。 | `src/lib/adapters/codex.ts:7-15`、`hooks/hooks-codex.json:2-15`、`hooks/run-hook.cmd:1-35`。生产验收记录的 `hookTrust: untrusted` 仍是未完成项。 |
| hp-fixed 本地源 | source_type=local 被导出为 codex-runtime，恢复时跳过；sync 仅安装硬编码 U同步插件。 | src/lib/state.ts:300-308、src/lib/codex-restore.ts:405、src/lib/update.ts:485。缺少通用固定版本/包摘要获取、运行依赖重建和安装版验收。 |

## 可直接纳入报告的边界

“配置同步”覆盖 TOML 中的 marketplace/plugin 声明、MCP/Skill 元数据及部分个人文件；“包安装”覆盖 bootstrap/setup 中的 Git、Node/npm、全局 CLI、marketplace/plugin add 和 Skill/MCP restore；“运行时加载与宿主信任”仍由 Codex 宿主单独决定。现有实现没有把三者合并成一个完成信号。

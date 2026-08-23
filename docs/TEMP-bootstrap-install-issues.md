# U同步首次安装/恢复问题记录（临时）

> 状态：临时诊断记录，供后续重构安装与 bootstrap 流程时使用。
> 记录日期：2026-08-23
> 当前目标：以后用户只提供 U同步插件 GitHub 地址和 dotfiles GitHub 地址，安装器应自动补齐环境、安装插件并完成恢复，不因下列可自动修复的问题中断。

## 2026-08-23 重构结论

| 原问题 | 状态 | 当前处理 |
|---|---|---|
| 1. 插件未真正安装/启用 | 已修复 | personal marketplace + 当前 Codex CLI `plugin add`，并解析 `plugin list --json` 的 installed/enabled。 |
| 2. 源码未构建 | 已修复 | bootstrap 执行 `npm ci`、自构建 `npm test`、`npm pack` 和 tarball 安装。 |
| 3. Node/npm 缺失 | 已修复 | winget 安装；失败或 npm 半缺失时切换当前用户 portable LTS。 |
| 4. msstore 证书错误 | 已修复 | 所有安装显式 `--source winget`，失败不依赖 msstore。 |
| 5. UAC/安装路径漂移 | 已修复 | 真实版本命令为唯一成功判据；portable fallback 不需要管理员权限。 |
| 6. WindowsApps 假 codex | 已修复 | 拒绝 WindowsApps 路径并执行真实 `codex --version`。 |
| 7. npm 半安装/下载卡住 | 已修复 | 先卸载再有界重装，配置 fetch timeout/retries，最后执行版本验证。 |
| 8. GitHub 连接/私有仓库 | 部分修复 | 有界重试、自动浏览器登录、`gh repo view` 权限验证已实现；真实断网矩阵仍待新电脑验收。 |
| 9. PowerShell profile 噪声 | 已修复 | 重试入口和子 PowerShell 明确 `-NoProfile`。 |
| 10. codebase-memory 被再次引入 | 已修复 | 永久 tombstone，当前 Codex manifest 已清理，pull/setup/update/verify 均禁止恢复。 |
| 11. 安装包缺生产依赖 | 已修复 | 真实 tarball 生产依赖安装测试验证 `smol-toml` 和 `zod`。 |
| 12. 临时目录危险清理 | 已修复 | 测试使用安全临时 API；bootstrap 不执行基于未验证计算路径的递归删除。 |
| 13. manifest 不兼容/版本漂移 | 已修复 | 删除禁止字段、补 defaultPrompt、版本统一为 2.1.0；已用当前 Codex CLI 隔离安装成功。 |

当前无代码级阻塞。尚未声称完成的是一台真正全新的 Windows 机器上的整机验收，以及私有仓库首次登录/真实断网场景；执行方法见 [Codex 新电脑端到端重试指南](./CODEX-CLEAN-WINDOWS-RETRY.md)。

## 本次环境

- Windows 10/11（Codex Desktop）
- U同步源码：`C:\Users\severin\Codelib-severin\2_Business\uagent-sync`
- dotfiles：`https://github.com/severin-ye/usync-dotfiles`（私有仓库，默认分支 `main`）
- U同步包版本：`2.1.0`
- Codex 插件清单版本：`2.0.0`（与包版本不一致，后续需检查是否应该自动同步）

## 遇到的问题与本次解决方法

### 1. 重启 Codex 后 U同步仍未启用

**现象**

- 当前任务中没有 U同步技能。
- 没有 `opencode_sync_*` 或 `sync_*` 工具。
- `~/.codex/plugins` 中没有 U同步安装或缓存目录。
- 仓库虽然包含 `.codex-plugin/plugin.json`，但仅把源码目录作为工作区打开并重启 Codex，不会自动安装插件。
- `~/.agents/plugins/marketplace.json` 尚不存在。

**结论/解决方向**

- 首次安装必须自动创建 Codex personal marketplace 条目，并执行插件安装。
- 安装后应明确检测插件是否出现在 `codex plugin list` 中。
- Codex 的新技能/工具通常需要新任务加载；安装器应提示或自动引导用户新建任务，而不是只提示“重启”。
- `opencode_sync_*` 是 OpenCode 插件侧工具；Codex 侧目前主要加载 U同步 skills 并调用 CLI。安装器和提示语必须区分宿主，不能用是否存在 `opencode_sync_*` 判断 Codex 安装成功。

### 2. U同步源码未构建

**现象**

- 仓库没有 `node_modules/`。
- 仓库没有 `dist/cli.js`。
- 因此无法使用 AGENTS.md 中的 CLI fallback：`node dist/cli.js <cmd>`。

**解决方向**

- bootstrap 必须自动检测 `dist/cli.js`。
- 缺失时自动执行依赖安装和构建，并验证 CLI 可运行。
- 构建失败必须输出精确失败阶段和日志位置。

### 3. Node.js 和 npm 完全不可用

**现象**

- `Get-Command node` 和 `Get-Command npm` 均未找到命令。
- U同步无法安装依赖或构建。

**本次解决方法**

- 使用 winget 安装 `OpenJS.NodeJS.LTS`。
- 最终安装版本：Node.js `v24.19.0`、npm `11.17.0`。
- 安装后不能只相信 winget 的成功消息；必须实际执行 `node --version` 和 `npm --version`。

**重构要求**

- 自动检测 Node/npm。
- 缺失时优先执行无人值守安装；如果管理员 MSI 路径不可用，应提供无需管理员权限的当前用户/portable fallback。
- 安装后刷新当前进程的 PATH，并做真实命令验证。
- Node 版本必须校验是否满足 `package.json` 的 engines 要求。

### 4. winget 默认源被 msstore 证书错误阻断

**现象**

首次执行：

```text
搜索源时失败: msstore
0x8a15005e : 服务器证书与任何预期值都不匹配
```

winget 同时提示 Node 包可从 `winget` 工作源获得。

**本次解决方法**

显式限制来源：

```powershell
winget install --id OpenJS.NodeJS.LTS --exact --source winget --silent `
  --accept-package-agreements --accept-source-agreements --disable-interactivity
```

**重构要求**

- 不应因无关的 `msstore` 源失败而中断。
- 安装 Windows 开发工具时应优先指定 `--source winget`。
- 记录并分类源错误，自动切换到可用来源。

### 5. Node MSI 安装长时间等待管理员确认

**现象**

- winget 输出“安装程序将请求以管理员身份运行”，随后长时间没有新输出。
- 终止等待时 winget 才返回“已成功安装”。
- 标准路径 `C:\Program Files\nodejs\node.exe` 不存在。
- 注册表显示 Node.js 24.19.0 已安装，但 `InstallLocation` 为空。
- 实际命令位于 `C:\node.exe`、`C:\npm.cmd`，并可正常运行。

**本次解决方法**

- 查询 winget 安装记录、卸载注册表、`where.exe node` 和 `where.exe npm`。
- 以真实命令执行结果作为成功判据，而不是假定标准安装目录。

**重构要求**

- 不硬编码 `C:\Program Files\nodejs`。
- 使用命令解析、注册表和已知目录多路发现安装位置。
- 对 UAC 等待设置合理超时；超时后优先检查安装是否已实际完成，再决定重试或使用 portable fallback。

### 6. 终端中的 Codex 命令指向不可执行的 WindowsApps 文件

**现象**

- `Get-Command codex` 找到 Codex Desktop 包内的：
  `C:\Program Files\WindowsApps\...\app\resources\codex.exe`
- 执行 `codex --version` 返回“拒绝访问”。

**本次解决方法**

- 按官方 npm 路径安装 `@openai/codex@0.149.0`。
- 安装完成后，命令优先解析到：
  `C:\Users\severin\AppData\Roaming\npm\codex.ps1/codex.cmd`
- `codex --version` 最终返回 `codex-cli 0.149.0`。

**重构要求**

- 不能只检查 `Get-Command codex` 是否存在；必须实际执行 `codex --version`。
- WindowsApps 中“存在但不可执行”的 Codex Desktop 内部文件应判定为无效 CLI。
- 如安装 npm CLI，应确保 npm global bin 在 WindowsApps 之前，随后验证最终解析路径。

### 7. npm 安装 Codex CLI 在平台二进制下载阶段卡住

**现象**

- `npm install --global @openai/codex@latest` 长时间无输出。
- 中断后 `npm list -g` 显示包存在，但 `codex.cmd` 不存在，属于不完整安装。
- npm 日志停在下载：
  `@openai/codex-win32-x64@0.149.0-win32-x64`。

**本次解决方法**

使用明确版本、更长下载超时和重试：

```powershell
npm install --global @openai/codex@0.149.0 `
  --no-audit --no-fund `
  --fetch-timeout=300000 --fetch-retries=5 --loglevel=info
```

Windows x64 tarball 最终约 39 秒下载完成，安装成功。

**重构要求**

- 网络下载必须配置超时、重试和可见进度。
- `npm list -g` 不能作为唯一成功条件；必须检查 shim 并执行版本命令。
- 不完整安装时应自动安全重试，而不是要求用户手工清理。
- 保存 npm 日志路径，便于诊断。

### 8. 首次访问 dotfiles 仓库发生连接重置

**现象**

```text
fatal: unable to access 'https://github.com/severin-ye/usync-dotfiles/':
Recv failure: Connection was reset
```

**本次解决方法**

- 稍后重新验证。
- `gh auth status` 确认 GitHub CLI 已登录 `severin-ye`，具备 `repo` 等权限。
- `gh repo view` 确认仓库存在、为私有仓库、默认分支为 `main`。
- `git ls-remote --exit-code ... HEAD` 最终成功。

**重构要求**

- GitHub 网络错误应按可重试错误处理，使用退避重试。
- 在 Git 操作失败时，分别检查网络、`gh` 登录、仓库存在性、私有仓库权限和 Git 凭据，给出精确结论。
- 不输出真实 token；日志中必须脱敏。

### 9. PowerShell profile 持续输出 OneDrive 错误

**现象**

部分 PowerShell 调用开头出现：

```text
云文件提供程序未运行。
...Microsoft.PowerShell_profile.ps1
```

该错误与 U同步本身无关，但会污染日志，也可能导致某些自动化误判失败。

**本次解决方法**

- 后续诊断使用不加载 profile 的 PowerShell 环境。

**重构要求**

- bootstrap 子进程在 Windows 上应尽量使用 `-NoProfile`。
- 应依据退出码和结构化检查判断成功，避免把 profile 噪声当成组件错误。

### 10. `codebase-memory` 被再次讨论，但尚未完成溯源

**用户确认**

- 用户此前已彻底删除 `codebase-memory`。
- 当前不应安装、更新或恢复它。

**当前状态**

- 因工作流按“遇错立即中断”执行，尚未进入残留引用调查步骤。
- 可能来源包括旧的 `workspace-state.json`、`known-mcps.json`、SYNC-GUIDE、安装日志、更新计划或旧配置快照；这些只是待验证假设。

**重构要求**

- 恢复前识别“明确删除/禁用”的扩展，并将其作为 tombstone/禁止恢复记录持久化。
- `update --components mcp` 不得因为旧文档或旧快照重新安装已删除 MCP。
- `codebase-memory` 必须有回归测试：用户删除后，pull/setup/update/verify 均不得重新引入。

## 期望的一键 bootstrap 行为

用户只提供 U同步插件 GitHub 地址（以及需要恢复时的 dotfiles GitHub 地址）后，程序应自动：

1. 识别 Windows、Codex/OpenCode/DSH 宿主和当前权限。
2. 检查 Git、GitHub CLI、Node/npm、Codex CLI；缺失或不可执行时自动修复。
3. 对 winget/npm/GitHub 的临时网络或源错误做有界重试和 fallback。
4. 克隆或更新 U同步源码，安装依赖，运行测试并构建 `dist/cli.js`。
5. 创建/更新 Codex personal marketplace，安装 U同步并验证插件/skills 可见。
6. 使用 dotfiles URL 初始化 sync，保存 URL，后续不重复询问。
7. pull 后读取 `workspace-state.json`，把 `skillSources` 和 `windowsFixPaths` 传给 setup。
8. 尊重已删除扩展的 tombstone，绝不恢复 `codebase-memory`。
9. 检测 API 密钥，仅生成模板和缺失清单，不暴露或覆盖真实密钥。
10. 执行最终 verify，并输出可操作的结构化结果。

## 后续重构的验收测试建议

- 干净 Windows 用户：无 Node、无 npm、无 personal marketplace。
- Node 存在但不在 PATH。
- `codex` 命令只命中不可执行的 WindowsApps 文件。
- winget 的 msstore 源证书失败，但 winget 源正常。
- npm 平台包首次下载超时、第二次成功。
- GitHub 首次连接重置、重试成功。
- 私有 dotfiles 仓库，gh 已登录/未登录两种场景。
- 仓库有 `.codex-plugin/plugin.json` 但插件未安装。
- `node_modules`/`dist` 缺失或构建失败。
- `codebase-memory` 有旧快照引用，但带明确删除 tombstone。
- 所有失败路径均验证：不泄露 token、不破坏已有配置、可安全重入。

## 本次已完成与未完成

**已完成**

- Node.js/npm 安装与验证。
- Codex CLI 安装、命令优先级修复与验证。
- GitHub 登录、私有仓库访问和 Git 远程读取验证。

**尚未执行**

- U同步依赖安装、测试和构建。
- Codex personal marketplace 创建和 U同步插件安装。
- 从 `usync-dotfiles` 初始化/pull/setup。
- API 密钥检测与最终 verify。
- `codebase-memory` 残留引用的实际溯源与清理。

## 后续处理记录（2026-08-23）

### 11. Codex 插件安装包缺少运行时依赖

**现象**

插件清单修复并通过验证、安装到 personal marketplace 后，首次执行 U同步 CLI 报错：

```text
ERR_MODULE_NOT_FOUND: Cannot find package 'smol-toml'
```

**根因**

从 `npm pack` 解包得到的插件目录包含源码构建产物和 `package.json`，但没有安装运行时 `dependencies`；Codex 的本地插件安装步骤也没有替它执行 npm 依赖安装。

**本次解决方法**

在已安装插件目录执行：

```powershell
npm install --omit=dev --no-audit --no-fund
```

随后 CLI 可正常初始化同步状态。

**重构要求**

- 一键安装必须自动安装生产依赖，或把运行时依赖可靠地 bundle 进发布物。
- 验收不能止于 manifest validation 和 `codex plugin list`，必须在最终安装目录执行一次 CLI smoke test。
- CI 应从实际 `npm pack` 产物安装，而不是只在源码仓库的完整 `node_modules` 环境测试。

### 12. 临时安装目录的递归清理触发安全策略

**现象**

首次把打包、解包和基于计算路径的递归删除组合在同一命令中时，被安全策略拒绝，安装流程中断。

**本次解决方法**

- 改用明确、固定且位于系统临时目录下的 staging 路径。
- 将打包、解包、验证拆开执行，避免把未验证的计算路径传给递归删除。

**重构要求**

- bootstrap 应使用安全的临时目录 API，并验证解析后的绝对路径仍位于预期临时根目录。
- 清理失败不应破坏已完成的安装，但应记录可手工回收的 staging 路径。
- Windows 文件操作保持在同一 PowerShell 进程模型中，避免跨 shell 拼接删除目标。

### 13. 插件清单问题已修复并完成安装

**实际结果**

- 删除 manifest 中当前验证器不接受的顶层 `hooks`。
- 增加 3 条 `interface.defaultPrompt`，并将版本与 npm 包对齐为 `2.1.0`。
- 新增 manifest 回归测试。
- `npm test` 通过 217/217，插件验证器通过。
- `uagent-sync@personal` 已安装并在 Codex 中显示为 enabled 2.1.0。

这说明早先的“尚未执行”状态已被后续步骤取代；保留原记录是为了完整呈现故障与修复时间线。

## 第二轮 Windows bootstrap 结果（2026-08-23）

### 14. Windows shim、npm 12 和恢复网络重试已修复

- bootstrap 解析并传递经过版本验证的 `codex.cmd` 与 `npx.cmd` 绝对入口；WindowsApps 候选被拒绝。
- Node 恢复器根据可信 shim 定位对应 Node CLI，以参数数组和 `shell=false` 执行，避免 `.cmd` 的 EPERM/ENOENT 和 shell injection。
- `npm pack --json` 同时支持 npm 10 数组与 npm 12 keyed object。
- clone、dotfiles pull、marketplace Git 更新均执行有界退避重试。
- marketplace 更新先校验 Codex 返回的 root 及其 Git origin，再 `pull --ff-only`，避免 Codex 内置 upgrade 的固定 30 秒 clone 超时。

### 15. 本地隔离 bootstrap 已通过

- 总退出码 `0`。
- 本地 bootstrap 当次测试 `257/257`；补齐聚合和脱敏回归后，提交前最终全量测试 `262/262`。真实 pack 安装通过。
- U同步 Codex 插件 `2.1.0` installed/enabled。
- setup 与 verify 均为 `ok=true`。
- 210 个 selected skills 全部可用，按 5 个来源聚合；不再输出上千条重复 skipped。
- 永久 tombstone 确认 `codebase-memory-mcp` absent，未重新安装。
- 没有访问或修改 OpenCode 配置，也没有写入真实密钥。

本记录对应推送前的本地脚本验收；推送后的 raw GitHub 验收结果应继续追加在此处。

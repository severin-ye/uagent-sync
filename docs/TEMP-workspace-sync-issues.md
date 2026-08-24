# U同步插件与数据同步问题记录（临时）

> 状态：临时诊断记录，供后续重构 U同步工作流时使用。
> 记录日期：2026-08-23
> 与 `TEMP-bootstrap-install-issues.md` 并列保存，但职责严格分开。

## 文档边界

- `TEMP-bootstrap-install-issues.md`：记录 U同步本身尚未启用、基础环境和 Codex 插件安装入口的问题。
- 本文档：记录 U同步开始执行安装、测试、插件/技能配置和工作区数据恢复时遇到的问题。
- 本次故障发生在工作流的测试门禁，尚未真正 pull 或修改 dotfiles 数据。

## 2026-08-23 重构结论

| 原问题 | 状态 | 当前处理 |
|---|---|---|
| 1. 干净 checkout 缺 dist | 已修复 | `pretest` 自动 clean build；真实 pack 测试与其他文件串行，248/248 通过。 |
| 2. Codex manifest 验证失败 | 已修复 | 当前 CLI 隔离注册 marketplace、安装 2.1.0、确认 enabled 成功。 |
| 3. Codex 流程误查 OpenCode | 已修复 | targetAgent 持久化；Codex 使用独立的 `~/.codex/uagent-sync-cache.json`，Codex-only 分支不读取、创建或修改 OpenCode 配置与缓存。 |
| 4. 内部失败仍返回 0 | 已修复 | pull 从 dotfiles 子仓库执行 `git pull --ff-only`；Git/JSON/import/verify/setup 必需错误均返回非零和统一结构化字段。 |
| 5. 安全状态文件缺失 | 已修复 | dotfiles 已生成设计上无密钥的 v2 `workspace-state.json`，缺失时明确失败。 |
| 6. 旧 init 状态冲突 | 已修复 | init-state 已迁移为 sync + 正确 URL + targetAgent=codex；显式 `--force` 可覆盖。 |
| 7. 212 skills 只有旧路径 | 已修复 | 210 个当前 skill 具有稳定仓库来源/path/hash；2 个无有效内容的陈旧项已 tombstone。 |
| 8. MCP manifest 残留 codebase-memory | 已修复 | 当前 manifest 只保留 Codex runtime 的 node_repl；codebase-memory 和已退役 gpt-dotfiles-sync 均 tombstone。 |

仍需外部验收而非代码修复：全新 Windows、首次 GitHub 私有仓库登录和真实网络中断。不能在当前已配置机器上把这些场景伪报为已验证。重试步骤见 [Codex 新电脑端到端重试指南](./CODEX-CLEAN-WINDOWS-RETRY.md)。

## 问题 1：干净 checkout 执行 `npm test` 必然依赖尚不存在的 `dist/`

### 执行顺序

第 2 步原计划：

1. 安装依赖。
2. 运行仓库要求的 `npm test` 门禁。
3. 构建 U同步。
4. 安装 U同步到 Codex personal marketplace。

实际执行：

```powershell
npm ci --no-audit --no-fund --fetch-timeout=300000 --fetch-retries=5
npm test
```

### 结果

- `npm ci` 成功，安装 89 个包。
- `npm test` 失败并返回退出码 1。
- 后续构建、Codex 插件安装和工作区恢复均已停止。

### 直接错误

测试重复报告：

```text
Error: Cannot find module '...\dist\cli.js'
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...\dist\sync.js'
```

随后大量父级测试被取消，CLI smoke test 也因为 `dist/cli.js` 不存在而失败。

### 已确认的根因

`package.json` 当前脚本为：

```json
{
  "build": "tsc && node scripts/generate-dashboard-i18n.mjs && node scripts/copy-dashboard.mjs",
  "test": "node scripts/run-tests.mjs"
}
```

`scripts/run-tests.mjs` 只展开并运行 `test/*.test.ts`，不会先构建项目。

与此同时，多个测试直接依赖构建产物：

- `test/smoke.test.ts` 执行 `node dist/cli.js` 并导入 `../dist/sync.js`。
- `test/portable.test.ts` 多次导入 `../dist/sync.js`。
- 其他测试同样间接依赖 `dist/cli.js` 或 `dist/sync.js`。

因此，在全新 clone、刚执行 `npm ci`、尚无 `dist/` 的标准环境中，`npm test` 不是自包含命令；它隐含要求用户先知道并执行 `npm run build`。

### 为什么这是 U同步工作流问题

- 仓库最高优先级纪律要求任何变更提交前必须通过 `npm test`。
- 但从干净环境直接运行该命令会因缺少构建产物失败，而不是因源码或测试断言失败。
- U同步未来若要从 GitHub 地址自动完成安装，不能依赖用户猜测“先 build 再 test”的隐藏顺序。
- 失败输出重复数百次同一缺失模块错误，掩盖了唯一根因，也不利于自动诊断。

## 解决方案与本次验证

### 本次临时恢复方法（已执行）

在用户明确要求继续后，按以下顺序执行：

```powershell
npm run build
npm test
```

结果：

- `npm run build` 成功，生成 `dist/`。
- `npm test` 成功：216 项测试通过，0 失败、0 取消。
- 证明本次测试失败不是源码回归，而是干净环境下 build/test 顺序缺失。
- 该手工顺序只是本次恢复方法，自动化根因仍应通过下面的 `pretest` 方案修复。

### 推荐方案：让 `npm test` 自动确保构建产物存在

在包脚本中增加标准 pretest 门禁：

```json
{
  "pretest": "npm run build",
  "test": "node scripts/run-tests.mjs"
}
```

这样 `npm test` 在干净 checkout 中会自动：

1. TypeScript 编译并生成 `dist/`。
2. 生成/复制 dashboard 资源。
3. 执行所有测试。
4. build 失败时立即停止，不产生大量误导性的缺失模块错误。

### 可选方案

- 在 `scripts/run-tests.mjs` 开头显式调用构建并检查退出码。
- 将纯单元测试改为导入 `src/`，只让 CLI/发布物 smoke test 依赖 `dist/`；但这需要更大范围重构。
- 将测试拆为 `test:unit` 与 `test:dist`，并让总入口 `npm test` 先 build 后串行执行两者。

### 推荐理由

- `pretest` 改动最小，符合 npm 标准生命周期。
- 保留现有测试对真实发布产物的覆盖。
- 用户、CI 和 U同步 bootstrap 只需记住一个可靠入口：`npm test`。

## 必须新增的回归测试/CI 场景

1. 在没有 `dist/` 的干净 checkout 中执行 `npm ci`。
2. 直接执行 `npm test`，不得预先手工运行 build。
3. 验证 `dist/cli.js` 和 `dist/sync.js` 自动生成。
4. 验证全部测试通过。
5. 人为制造 TypeScript 编译错误时，测试流程应在 build 阶段一次性失败，不继续产生缺失模块噪声。
6. Windows、Linux CI 都应覆盖该顺序。

## 同时观察到但不是本次失败根因的警告

`npm ci` 输出：

```text
npm warn allow-scripts 2 packages have install scripts not yet covered by allowScripts:
esbuild@0.28.0
msgpackr-extract@3.0.4
```

本次依赖安装退出码为 0，测试的直接根因是缺少 `dist/`，不是这两个警告；但后续应确认：

- dashboard/e2e 是否需要 esbuild 的 postinstall 产物。
- msgpackr 的可选原生包缺失是否只影响性能。
- 是否需要在受控配置中明确允许这些脚本，并添加配置格式测试。

## 问题 2：U同步的 Codex 插件清单无法通过当前验证器

### 触发位置

在 build 和 216 项测试全部通过后，安装到 personal marketplace 之前执行：

```powershell
py -3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py <uagent-sync>
```

### 结果

验证失败：

```text
plugin.json field `hooks` is not accepted by plugin validation
plugin.json field `interface.defaultPrompt` or `interface.default_prompt` is required
```

后续 personal marketplace 创建、`codex plugin add` 和 dotfiles 恢复已停止。

### 根因

当前 `.codex-plugin/plugin.json`：

- 显式声明了 `"hooks": "./hooks/hooks-codex.json"`，但当前 Codex 插件验证器拒绝该 manifest 字段；插件创建规范要求依赖默认组件发现，不在 manifest 中声明 `hooks`。
- `interface` 缺少当前验证器要求的 `defaultPrompt` starter prompts。
- `plugin.json` 版本仍为 `2.0.0`，而 npm 包为 `2.1.0`；这不是本次验证器直接报错，但说明发布元数据可能漂移，重构时应一并校验。

### 解决方案（尚未实施）

1. 从 `.codex-plugin/plugin.json` 删除顶层 `hooks` 字段，但保留现有 `hooks/` 目录和 hook 文件，让 Codex 走默认发现机制。
2. 在 `interface` 中加入 1–3 条、每条不超过 128 字符的 `defaultPrompt`，例如：

```json
"defaultPrompt": [
  "U同步，检查环境",
  "U同步，恢复工作区",
  "U同步，更新所有扩展"
]
```

3. 将 plugin manifest 版本与 `package.json` 的 `2.1.0` 对齐，或增加自动生成/一致性测试，避免再次漂移。
4. 为 manifest schema 增加测试，明确验证：不含不受支持字段、包含 `defaultPrompt`、版本一致。
5. 修改后按仓库纪律先运行 `npm test`，再重新运行 `validate_plugin.py`；两者均通过后才能创建 personal marketplace 和安装插件。

### 规范本身需要留意的矛盾

本地 `plugin-json-spec.md` 的字段示例仍展示 `hooks`，但同一规范的 validation notes 与实际验证器又明确拒绝 `hooks`；后续应统一样例、字段说明、scaffold 和验证器，避免插件作者按样例生成必然失败的清单。

## 当前停止位置

已完成：

- Node/npm/Codex CLI/GitHub 基础环境修复。
- `npm ci`。

曾失败并停止、现已通过手工顺序恢复：

- `npm test`：缺少 `dist/cli.js` 和 `dist/sync.js`。
- 随后执行 `npm run build`，再执行 `npm test`，216/216 通过。

当前失败并停止：

- Codex plugin validation：不接受顶层 `hooks`，并要求 `interface.defaultPrompt`。

尚未执行：

- U同步 Codex 插件验证与安装。
- `usync-dotfiles` 初始化和 pull。
- plugins/skills/MCP/config 数据恢复。
- API 密钥检测、verify 和 `codebase-memory` 残留调查。

## 后续处理记录（2026-08-23）

### 问题 3：配置目标是 Codex，但 `verify/setup` 错误地把 OpenCode 当成必需宿主

**现象**

- U同步已经作为 Codex personal plugin 安装并启用。
- 执行 `verify` 时仍将“OpenCode 配置不存在”报告为错误。
- 执行通用 `setup` 时仍进入 OpenCode 优先的旧流程，造成任务范围混乱。

**根因**

当前 U同步的初始化状态没有可靠保存目标宿主，`verify/setup` 又继承了项目早期的 OpenCode 默认值，因此没有按本次明确的 Codex 目标进行作用域过滤。

**本次处理**

- 后续流程只检查、安装和恢复 Codex 组件。
- OpenCode 未配置被视为“不在本次作用域”，不再视为错误，也不再触发修复。
- 本次不创建、不覆盖 OpenCode 配置。

**重构方案**

1. 初始化状态增加 `targetAgent: codex | opencode | dsh | all`，由已运行宿主和用户指令自动确定并持久化。
2. `verify/setup/pull/update/api-keys` 全部接受并遵守目标宿主作用域。
3. Codex 模式不得检查或修改 OpenCode 配置；反向同理。
4. 输出必须标明“已检查”“已跳过（不在作用域）”，不能把跳过项记为错误。
5. 增加 Codex-only 回归测试，保证系统没有 OpenCode 配置时仍能完整通过。

### 问题 4：内部步骤失败，但命令仍返回退出码 0

**现象**

- `pull` 未找到必需的 `workspace-state.json`，但进程退出码为 0。
- `verify` 报告一个 error，进程退出码仍为 0。
- `setup` 的子模块更新失败（`2_Business/GReSy` 的固定提交在远端不存在），进程退出码仍为 0。

**风险**

上层 Agent 或 CI 会把未完成的恢复误判成成功，并错误地继续后续步骤。

**本次处理**

- 不再仅依据退出码判断成功，同时解析输出并验证预期文件/组件。
- `GReSy` 属于工作区子模块问题，不是 Codex 插件配置的必需条件；在 Codex-only 流程中记录但不继续用通用 `setup` 扩大处理范围。

**重构方案**

1. 必需步骤失败必须返回非零退出码。
2. 工具返回结构化结果：`ok`、`warnings`、`errors`、`skipped`、`targetAgent`。
3. 可选组件失败可降级为 warning，但必须明确分类；不得吞掉异常。
4. 为缺失状态文件、verify error、子模块失败分别增加退出码回归测试。

### 问题 5：远端主动删除了含明文密钥的状态文件，导致恢复协议断裂

**现象与溯源**

- `pull` 后没有 `usync-dotfiles/state/workspace-state.json`。
- Git 历史显示该文件曾因包含明文敏感信息而被安全提交主动删除并忽略。

**本次处理**

- 没有从历史提交恢复不安全的旧文件。
- 使用当前环境重新 `export` 生成了本地状态文件；其中没有 `codebase-memory`，但当前导出的 `skillSources` 和 `windowsFixPaths` 均为空，不能把它当作完整的新设备恢复清单。

**重构方案**

- 状态格式必须从设计上排除密钥值，只保存变量名、来源类型和是否缺失。
- `push/export` 在写入前进行 secrets 扫描；检测到敏感值立即失败并给出脱敏迁移方法。
- 远端必须保留一份可安全提交、足以恢复插件/skills/MCP 的清单，不能依赖已被 `.gitignore` 排除的唯一状态文件。
- `pull` 缺少必需状态时必须明确失败，或切换到经过定义和测试的文档清单恢复路径。

### 问题 6：旧初始化状态与本次同步目标冲突

**现象**

原 `init-state.json` 仍记录 backup 模式、测试工作区名称和错误仓库 URL。

**本次处理**

使用显式 `sync` 模式、正确的 `https://github.com/severin-ye/usync-dotfiles` 和强制刷新重新初始化；之后 URL 与工作区识别正确。

**重构方案**

- 当用户显式提供的新 URL/模式与缓存冲突时，不能静默沿用旧值。
- 应展示冲突、自动迁移可确认的陈旧测试状态，并记录变更来源。
- 初始化状态应同时保存 `targetAgent=codex`，避免再次落入 OpenCode 默认流程。

### 问题 7：Codex skills 清单记录了名称，却没有保存可恢复来源

**现象**

- `agents/codex/manifests/skills.json` 列出 212 个 skills。
- 每项 `source` 都是旧机器路径 `C:\Users\6seve\.agents\skills\...\SKILL.md`，当前机器无法使用。
- 当前机器的标准个人 skill 目录按名称核对为 0/212。
- `SKILLS.md` 只为部分 skills 记录了 GitHub/Skills CLI 来源，不能覆盖完整清单。

**影响**

U同步知道“以前有哪些 skill”，却不知道“应从哪里重新下载”，所以不能根据现有清单可靠完成一键恢复。仅把旧用户名替换为新用户名也无效，因为源目录内容本身不存在。

**本次处理**

- 没有把旧机器绝对路径当作安装源。
- 没有臆测 212 个同名项目的 GitHub 地址，以免安装错误或恶意同名包。
- 后续仅使用仓库中有可信来源记录的条目恢复，并把无来源项明确列为不可自动恢复。

**重构方案**

1. 每个 skill 必须保存稳定标识和来源，例如 `owner/repo@skill`、仓库 URL + commit、或所属 Codex plugin。
2. 本地自定义 skill 应把内容纳入安全的 dotfiles 数据目录，或保存可访问的私有仓库地址。
3. 导出时拒绝把本机绝对路径作为唯一来源；路径只能作为安装位置元数据。
4. pull/setup 应先生成 dry-run：可恢复、已存在、来源缺失、冲突、明确删除五类结果。
5. 增加跨 Windows 用户名恢复测试，确保从 `C:\Users\6seve` 导出的状态能在 `C:\Users\severin` 安装。

### 问题 8：Codex MCP 清单仍包含已删除的 `codebase-memory-mcp`

**现象**

- 当前 Codex 配置中没有 `codebase-memory-mcp` 活跃配置。
- 但 `agents/codex/manifests/mcp.json` 仍列出它，dotfiles 的 `know-how/` 也保留相关历史文档。

**本次处理**

- 将该项判定为陈旧记录，遵守用户已彻底删除的指令，不安装、不配置。
- 当前有效目标仅包括 `node_repl` 和 `gpt-dotfiles-sync`；其中 `node_repl` 已存在，`gpt-dotfiles-sync` 尚未恢复。

**重构方案**

- 引入扩展 tombstone/删除记录，并让其优先级高于旧快照、know-how 和自动发现清单。
- 删除扩展时同步更新各宿主 manifest；历史说明文档不得被解释为待安装项。
- 增加测试，保证 pull/setup/update/verify 都不会重新引入 tombstone 中的扩展。

## 真实 bootstrap 重试记录（2026-08-23，提交 `0dafd452`）

执行入口：

```powershell
$script = Join-Path ([IO.Path]::GetTempPath()) 'uagent-bootstrap.ps1'
Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/severin-ye/uagent-sync/master/scripts/bootstrap.ps1' -OutFile $script
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -UagentRepo 'https://github.com/severin-ye/uagent-sync' -DotfilesRepo 'https://github.com/severin-ye/usync-dotfiles' -TargetAgent codex
```

### 已验证通过的改进

- GitHub 第一次 clone 出现 `Recv failure: Connection was reset` 后脚本自动重试并成功。
- 干净 checkout 的 `npm test` 自动通过 `pretest` 先构建 `dist`。
- 248/248 项测试通过，包括真实 `npm pack`、Codex-only 作用域、tombstone、退出码、密钥扫描和路径安全测试。
- U同步 marketplace 和 `uagent-sync@uagent-sync` 插件成功安装。
- 初始化状态正确保存 `targetAgent=codex`，且 OpenCode 被明确跳过。
- bootstrap 在恢复失败后返回退出码 1，并没有继续执行最终 verify。

### 问题 9：Node 恢复器无法在真实 Windows 环境执行 `codex` 和 `npx` shim

**现象**

- tombstone MCP 删除命令失败：`spawnSync codex EPERM`。
- skill 删除和安装命令失败：`spawnSync npx ENOENT`。
- 同一个 PowerShell 进程中 `codex --version`、`npx` 和 bootstrap 前置检查均可用。

**根因**

`src/lib/codex-restore.ts` 使用 `spawnSync(file, args, { shell: false })` 执行裸命令名，而 Windows 上实际可用入口是 `codex.cmd`、`codex.ps1` 和 `npx.cmd` 等 shim；PowerShell 能解析这些入口，但 Node 的无 shell 子进程无法可靠执行它们，并可能继续命中不可执行的 WindowsApps `codex.exe`。

**重构方案**

1. bootstrap 在验证命令时保存经过验证的绝对可执行入口，并传递给恢复器。
2. Windows 下显式选择可信的 `.cmd` shim，并通过 `ComSpec /d /s /c` 安全调用，或直接调用对应 Node CLI 入口。
3. 不得重新搜索并命中 WindowsApps 中不可执行的 `codex.exe`。
4. 增加真实 Windows `.cmd` shim 端到端测试，不能只使用 mock execute 验证参数。
5. 错误结果应包含最终解析路径和错误类型，但不得输出敏感环境变量。

### 问题 10：bootstrap 已安装的 U同步插件被恢复器误判为来源冲突

**现象**

恢复阶段报告：

```text
Conflicting recovery entries for plugin:uagent-sync
```

但 bootstrap 在此前已经从同一个 U同步仓库成功注册 marketplace 并安装了 `uagent-sync@uagent-sync`。

**根因**

恢复分类器直接比较 selected 与 installed 的原始 `source` 字符串，只要表示形式不同就判定冲突，没有把 GitHub URL、marketplace 标识和已安装插件元数据规范化为同一来源身份。

**重构方案**

1. 为插件来源建立规范化身份，例如规范化 GitHub URL、marketplace 名称、仓库 owner/name 和版本。
2. bootstrap 自己安装的同版本插件必须分类为 existing，而不是 conflict。
3. 只有规范化来源确实不同且存在供应链风险时才报告冲突。
4. 增加“先由 bootstrap 安装、再由恢复器扫描”的真实顺序回归测试。

### 问题 11：tombstone 在确认扩展是否存在前无条件调用删除命令

**现象**

当前配置中并没有活动的 `codebase-memory-mcp`，恢复器仍调用 `codex mcp remove codebase-memory-mcp`，并因命令启动失败把 tombstone 记为 required error。

**根因**

恢复器先遍历所有永久 tombstone 并执行删除，然后才处理 installed/selected 分类，没有利用已扫描的 installed 清单跳过本来就不存在的扩展。

**重构方案**

1. tombstone 目标不在已安装清单时直接记录为已满足，不启动删除命令。
2. 目标存在时才执行删除，并在删除后重新扫描确认确实消失。
3. 删除命令的“未安装/不存在”结果必须幂等成功，真正的权限或执行错误才失败。
4. `codebase-memory-mcp` 必须继续保持删除状态，修复不得以绕过 tombstone 为代价。

### 问题 12：按 skill 输出重复的 source-already-installed 日志导致结果膨胀

**现象**

多个 skill 来自同一个仓库时，恢复输出为每一项重复一条 `source-already-installed`，最终产生上千行 JSON 并被终端截断。

**重构方案**

- 安装计划应先按规范化 source 分组，每个仓库只执行一次并输出一次汇总，同时列出该来源覆盖的 skill 数量和失败项目。

### 下一次重试的新增验收条件

1. 在真实 Windows PowerShell `-NoProfile` 环境中运行完整 bootstrap，而不是只跑单元测试。
2. 验证恢复器实际执行 `codex.cmd` 和 `npx.cmd`，并且不会命中 WindowsApps。
3. 已由 bootstrap 安装的 U同步插件必须被识别为 existing。
4. 未安装的 `codebase-memory-mcp` tombstone 必须幂等通过且不得重新安装。
5. 选定 skills 必须成功恢复，或者只为真实来源/凭据问题返回精确错误。
6. 恢复输出应按来源聚合，不能再次产生上千条重复 skipped 记录。
7. `setup` 和最终 `verify` 都必须返回 `ok=true`，bootstrap 总退出码必须为 0。

## 第二台 Windows 机器重试记录（2026-08-23，提交 `f271000`）

### 本机环境与结果

- Windows 用户名：`severin`，用于验证从原电脑用户 `6seve` 跨用户名恢复。
- raw GitHub bootstrap 成功快进到 `f271000`，完整测试 262/262、60 suites、0 failed。
- U同步插件成功刷新并安装，同源插件被正确识别为 existing。
- Windows shim 修复生效，恢复器使用 `C:\npx.cmd`，不再出现 `EPERM` 或 `ENOENT`。
- `codebase-memory-mcp` tombstone 被判定为 satisfied，没有活动配置，也没有重新安装。
- `panniantong/agent-reach`、`anthropics/skills` 和 `google-deepmind/science-skills` 三个来源恢复成功，共覆盖 58 个所选 skills。
- `nexu-io/open-design` 和 `garrytan/gstack` 两个来源恢复失败，共影响 152 个所选 skills。
- `setup` 返回退出码 1 和 `ok=false`，bootstrap 总退出码为 1，并正确停止在最终 verify 之前。

### 问题 13：skill 来源安装缺少自身的有界重试、超时和进度心跳

**现象**

- 本次 GitHub 操作多次出现 `Recv failure: Connection was reset`，仓库 pull 能自动重试恢复。
- skill 来源安装过程中连续数分钟没有输出，随后两个来源仅以 `non-zero exit; path=C:\npx.cmd` 结束。
- 另外三个来源在同一流程中成功，说明 shim、Skills CLI 和全局安装能力本身可用。

**判断**

此次失败高度符合外部 GitHub clone 网络中断，但 skill 来源安装没有使用 bootstrap 已具备的有界重试策略，因此单次 `npx skills add` 失败就使整个 setup 失败；由于错误报告没有保留安全脱敏后的 stdout，目前无法从结构化结果确认底层 Git 的精确错误文本。

**重构方案**

1. 每个规范化 skill source 应独立执行有界重试，并使用指数退避和可配置超时。
2. 重试前重新扫描已安装 skills，避免重复安装前一次已经部分成功的内容。
3. 每个来源应输出开始、重试次数、耗时和完成心跳，避免长时间静默。
4. 网络连接重置、超时和临时 DNS/TLS 错误应分类为可重试错误，来源不存在、权限拒绝和清单无效应立即失败。
5. 单个来源最终失败时应保留安全脱敏后的 stdout 与 stderr 摘要以及底层退出码。
6. bootstrap 的重试状态应精确到来源级别，重新运行时只处理失败或未完成的来源。
7. 增加可控的“前两次 clone 连接重置、第三次成功”端到端测试。

### 问题 14：聚合错误仍会展开 151 个 skill 名称

**现象**

来源级 skipped 日志已经聚合，但 `open-design` 失败时仍在一条错误中展开全部 151 个 skill 名称，导致错误结果非常长。

**重构方案**

- 结构化摘要只输出来源、skill 数量、少量示例和独立失败报告路径，完整名称列表写入报告文件而不是终端主结果。

### 下一次跨设备重试验收条件

1. 在本机模拟或真实遇到 GitHub connection reset 时，skill 来源安装必须自动重试而无需再次运行整条 bootstrap。
2. 5 个来源最终都成功，dotfiles 选择的 210 个 skills 全部可用。
3. setup 和 verify 均返回退出码 0、`ok=true`、0 errors。
4. bootstrap 总退出码为 0，并保持 Codex-only、tombstone 和密钥安全要求。
5. 终端错误摘要不得展开数百个 skill 名称，完整明细应写入可审计报告文件。

## 第三次 `severin` 机器重试记录（2026-08-23，提交 `4f55a1a`）

### 本次中断位置

- 仓库成功更新到 `4f55a1a`，新增的来源重试、超时、heartbeat、错误分类和脱敏报告测试均通过。
- 完整测试在 `crystallize-submodule.test.ts` 创建本地测试子模块时发生 Git Bash 环境错误，最终 270 项中 266 通过、4 取消、0 断言失败。
- bootstrap 按门禁要求返回退出码 1，并在真实 skill 来源恢复和最终 verify 之前停止。
- 随后单独重跑 `crystallize-submodule.test.ts`，6/6 全部通过，说明该故障具有环境性或偶发性。

### 问题 15：全套测试中的 Git 子模块 fixture 偶发 `Bad file descriptor`

**错误**

```text
/mingw64/libexec/git-core/git-sh-setup: line 315: pwd: write error: Bad file descriptor
Unable to determine absolute path of git directory
```

**触发位置**

`test/crystallize-submodule.test.ts` 的 `makeSubmoduleWorld()` 通过字符串 shell 执行：

```text
git -c protocol.file.allow=always submodule add <local-bare-repo> usync-dotfiles
```

错误发生在测试 fixture 构造阶段，尚未进入 U同步 crystallize 业务逻辑；同一测试文件立即单独重跑可以稳定通过。

**可能关联因素**

- 测试帮助函数使用 `execSync("git ...")` 的字符串 shell 形式，而不是解析后的 Git 可执行文件加参数数组。
- 前一次 bootstrap 的 skill 下载曾长时间运行多个 Node/Git 子进程，全套重试需要保证失败或超时后完整清理 Windows 子进程树和文件描述符。
- 当前证据只能确认这是偶发环境错误，尚不能断言唯一根因。

**重构方案**

1. 测试 Git 帮助函数改为 `execFileSync(resolvedGitExe, args)`，避免额外的命令 shell 和字符串解析层。
2. Windows 受监控命令超时时必须终止整个进程树，并等待句柄关闭后再返回。
3. 在完整测试开始前检测 U同步遗留的 Git/Skills 子进程，并仅清理可确认属于上一次 bootstrap 的进程树。
4. fixture 为每次 Git 调用记录脱敏后的可执行路径、参数阶段、退出码、stdout 和 stderr 摘要。
5. 针对明确的 Git Bash `Bad file descriptor` 环境错误，可在重新创建全新临时 fixture 后做一次有界重试，但不得隐藏真实业务失败。
6. 增加“受监控命令超时后立即运行本地 submodule fixture”的 Windows 回归测试，验证没有遗留子进程或坏句柄。

### 下一次重试要求

1. 完整 `npm test` 必须一次通过 270/270，不能依赖人工单独重跑失败文件。
2. 通过测试门禁后继续验证 5/5 skill 来源、210/210 selected skills、setup/verify `ok=true` 和 bootstrap 退出码 0。
3. 若仍失败，必须区分测试 fixture 环境错误与真实恢复错误，并分别生成脱敏报告。

### 问题 15 当前状态（本轮代码修复，尚待 raw bootstrap 复验）

- **代码已修复**：`crystallize-submodule.test.ts` 现在通过解析后的可信绝对 Git 入口和 `execFileSync` 参数数组执行 Git；Node CLI 也通过 `process.execPath` 与参数数组执行，不再拼接 shell 命令。
- **重试边界已收窄**：fixture helper 只识别上述两条精确环境诊断，最多重新创建一次全新临时 fixture；普通 Git 失败、权限失败和业务断言不会重试或被隐藏。
- **当前自动化证据**：fixture helper 与 crystallize 聚焦测试已通过；`run-tests.mjs` 的取消 hook 非零退出码回归已通过；本轮 `npm test` 为 379/379、82 suites、0 failed，独立 bootstrap/DSH schema/pack/smoke 组为 11/11。
- **尚不能声称**：当前 HEAD 尚未重新执行 raw GitHub bootstrap；此前记录中的 bootstrap 结果不能替代本轮代码推送后的真实 Windows 复验。

## 第三轮修复状态（原电脑，基于 `bc33778`）

### 问题 13：已修复，等待 `severin` 机器复验真实仓库下载

- 每个规范化 skill source 默认最多尝试 3 次，指数退避为 500ms、1000ms，单次默认超时 120 秒；参数均有上下界并可在测试中注入。
- 只有 connection reset、超时、临时 DNS/TLS、429/502/503/504 等瞬态网络错误会重试；权限、认证、仓库不存在、来源或 manifest 无效立即失败。
- 每次重试前重新扫描已安装清单；若该来源覆盖的 skills 已全部出现，立即记为成功，不重复安装。
- 默认 Windows 执行器通过受控 Node monitor 运行可信 CLI，`shell=false`；单次命令仍运行时每 15 秒向 stderr 输出一行无参数、无密钥的 heartbeat，120 秒后返回 `124/TIMEOUT`。
- CLI 另外输出 source 级 `start/heartbeat/retry/complete`、attempt、elapsedMs 和退避时间；结构化 JSON 保持在 stdout，不被进度输出污染。
- 新增真实临时 `npx.cmd` 端到端测试：两个独立子进程返回 `Recv failure: Connection was reset`，第三个进程成功；同时覆盖真实周期心跳和真实超时终止。

### 问题 14：已修复

- 主错误只显示规范化 source、skill 总数、最多 3 个示例、退出码、分别脱敏限长的 stdout/stderr、可信路径与错误类型，不再展开 151 个名称。
- 失败完整明细原子写入 `usync-dotfiles/state/recovery-reports/skill-source-*.json`，保存完整 skill ID、每次尝试的耗时、退出码和脱敏摘要；写入前再次执行 secrets 扫描。
- setup 返回的错误包含脱敏 report 路径，便于跨设备审计；报告测试确认 Bearer fixture 的实际值既不进入结构化结果也不进入文件。

### 原电脑验证

- `npm test`：270/270、60 suites、0 failed。
- 独立真实 `npm pack`、production install、CLI `--version`/`--help` smoke：通过。
- 原电脑目标 workspace：setup 退出 0、`ok=true`、0 errors；verify 退出 0、`ok=true`、210 个 selected skills 可用，`codebase-memory-mcp absent`。
- 上述原电脑结果不能代替 `severin` 机器对 `open-design` 与 `gstack` 的真实网络下载复验；推送后必须在该机器重新执行同一 raw bootstrap，确认 5/5 来源和最终 verify。

## 第二轮真实 Windows 修复与本地 bootstrap 验收（2026-08-23）

测试方式：先在隔离的临时 workspace clone `ee4c5ec`，再应用本轮未推送 diff，直接运行本地 `scripts/bootstrap.ps1`。该方式保证测试的是本地修改，而不是 raw GitHub 上尚未推送的旧脚本。

### 四个指定问题的状态

1. **问题 9 — 已修复**：Windows 恢复器只解析可信绝对 `codex.cmd` / `npx.cmd`。实际入口分别为 npm global bin 和 Node 安装目录；随后直接执行对应 Node CLI，`shell=false`，参数不经过 shell。WindowsApps 被显式拒绝，错误包含脱敏路径和错误类型。新增真实临时 `.cmd`、真实子进程和 shell 元字符回归测试。
2. **问题 10 — 已修复**：GitHub URL、`owner/repo`、大小写、尾部 `.git`、插件名和语义版本统一规范化。同仓同版本 `uagent-sync@uagent-sync` 被分类为 existing；不同仓库仍按供应链冲突失败。真实 bootstrap 顺序中未再出现 conflict。
3. **问题 11 — 已修复**：恢复器使用未经过 tombstone 过滤的原始 Codex 扫描。目标缺席时记录 `tombstone-satisfied` 且不执行删除；目标存在时才删除并复扫。权限错误和“命令成功但目标仍存在”均失败。`codebase-memory-mcp` 实际验证为 absent。
4. **问题 12 — 已修复**：restorable 和 existing skills 都按规范化 source 聚合。当前 210 个 selected skills 被汇总为 5 个仓库来源（151、39、18、1、1），不再产生逐 skill 的重复 skipped 项。

### 本地完整 bootstrap 结果

- 首次发现 npm 12 把 `npm pack --json` 改为 keyed object，旧数组读取报错；已增加兼容解析和回归测试。
- 恢复 pull 首次遇到 GitHub connection reset；已把 pull 纳入三次有界退避重试。
- Codex marketplace 内置 upgrade 固定 30 秒 clone 超时；改为读取 Codex 认可的 marketplace root、核验 Git origin 与 `UagentRepo` 一致，再使用 Git 的 `pull --ff-only` 重试更新。
- U同步插件从陈旧缓存 2.0.0 更新并严格确认到 2.1.0。

## 2026-08-23：U同步自身更新闭环

此前 `update` 的 `sync` 组件只执行源码拉取、`npm install` 和 build，因此会更新 checkout 中的代码，但不会更新全局 `uagent-sync` CLI，也不会刷新 Codex personal marketplace、重装插件或核验插件版本；而且 `sync/*` 非零退出被降级成 warning。

当前状态：**已修复并通过自动化回归**。

- Codex `sync` 更新执行 pull、干净依赖安装、全部测试、真实 pack、tarball 全局安装、marketplace 来源核验与刷新、插件安装及 installed/enabled/version 验证。
- 所有命令使用参数数组执行；Windows 上 Codex 调用复用可信 `codex.cmd`/Node CLI 解析，不会命中 WindowsApps 假入口。
- 任一必需步骤失败立即阻断后续替换步骤，并计为 error；测试失败时不会覆盖当前全局 CLI。
- 更新结果带 `targetAgent=codex`，Codex 默认计划不访问 OpenCode plugin cache 或 config 目录。
- 回归测试覆盖完整计划、Codex-only 隔离、pack 安装和插件验证成功路径，以及测试失败后的安全停止路径。
- 发布元数据统一升至 `2.1.1`，使 Codex 能把本轮实现识别为新插件版本，而不是继续复用 2.1.0 缓存。

### severin Windows 实机结果

- 从本地 2.1.1 构建直接执行 `updateExtensions({ components: ['sync'], targetAgent: 'codex' })`，总结果为 `ok=8, warning=0, error=0, skipped=0`。
- 源码 `pull --ff-only`、`npm ci`、275 项测试、真实 pack、tarball 全局安装、marketplace 来源核验/快进、插件安装和最终版本验证全部成功。
- 全局 `uagent-sync --version` 为 `2.1.1`；Codex 返回 `uagent-sync@uagent-sync` installed/enabled，版本为 `2.1.1`。
- personal marketplace 从旧提交快进至 `0e3de43`，Git origin 仍为 `https://github.com/severin-ye/uagent-sync.git`。
- bootstrap 总退出码：`0`。
- `setup --target-agent codex --json`：`ok=true`，0 warnings，0 errors，13 个聚合 skipped，17 个步骤。
- `verify --target-agent codex --json`：`ok=true`，0 warnings，0 errors，1 个 out-of-scope skipped，13 个验证步骤。
- Codex skills：223 个已安装；dotfiles 选中的 210 个全部可用。
- Codex MCP：选中的 1 个条目可用；`codebase-memory-mcp` 无活动配置。
- 可信入口：`codex.cmd` 位于 npm global bin，`npx.cmd` 位于 Node 安装目录，二者均不在 WindowsApps。
- 全过程 targetAgent 为 codex；OpenCode 仅作为 out-of-scope 结果出现，没有读取、创建、覆盖或验证其配置。

### 推送后 raw GitHub 最终验收

- 验收提交：`a30ec80f8829e567d0fba6e9a89e9111fd043a87`。
- 严格使用文档中的 `Invoke-WebRequest` raw GitHub 入口和 `powershell.exe -NoProfile`，默认 workspace 为 `C:\Users\6seve\UagentWorkspace`；bootstrap 总退出码 `0`。
- 干净 clone 自动执行 `npm ci`、build、`npm test` 与真实 `npm pack` 安装；结果为 `262/262` 通过，pack CLI smoke 通过。
- GitHub 网络先后出现 connection reset 和一次 dotfiles pull 连接超时；有界重试继续执行并最终成功，没有人工补命令。
- 独立在目标 workspace 复跑 `setup --target-agent codex --json` 与 `verify --target-agent codex --json`，二者退出码均为 `0`、`ok=true`、0 warnings、0 errors。
- `setup` 只有 13 个聚合 skipped，其中 210 个 selected skills 按 5 个来源汇总；`verify` 记录 223 个已安装 skills、210 个 selected skills 可用、1 个 selected MCP 可用。
- `uagent-sync@uagent-sync` 为 `2.1.0`、installed/enabled，marketplace Git 来源规范化后与 U同步仓库一致，因此分类为 existing，不再产生 conflict。
- 恢复器实际采用 `C:\Users\6seve\AppData\Roaming\npm\codex.cmd` 和 `C:\Program Files\nodejs\npx.cmd`，二者存在且均不位于 WindowsApps。
- tombstone 验证为 `codebase-memory-mcp absent`，Codex 配置中无活动表；未执行无意义删除，也未重新安装。
- OpenCode 只作为结构化结果中的 out-of-scope skipped 项出现，没有读取或修改其配置；日志和状态没有真实密钥。

从其他源码仓库目录手工复核时应显式设置 `OPENCODE_SYNC_WORKSPACE_ROOT`，或先切换到 bootstrap workspace；否则当前目录会按设计参与 workspace 解析。这不是 bootstrap 失败，目标 workspace 上的独立 setup/verify 已再次通过。

## 2026-08-23 Hexagonal Modular Monolith 架构收口

本节是增量状态，不覆盖上文真实故障时间线。

- **已修**：CLI 与 OpenCode Plugin 的 verify/export/import/setup/update/push/pull 已共用 `src/application/` 用例；依赖方向记录为 Entry → Application → Domain/Ports ← Adapters。
- **已修**：新增 AST 级架构边界守卫；聚焦测试 RED 后为 4/4，通过命名导入和解析后的模块路径检查入口不得绕过 Application、Application 不得反向依赖 entrypoints。
- **已修**：Agent inventory 使用可注入 registry；第四 Agent fixture 已证明无需修改 inventory 核心扫描循环。
- **已修**：WorkspaceState v3 codec 是内部读时验证/迁移契约；当前 wire export 保持兼容，不声称已整体切换到 v3 输出。
- **已修**：Codex-only 隔离和 `codebase-memory-mcp` 永久删除语义保持不变；架构改造没有扩大宿主写入范围。
- **仍待**：DSH 只有 inventory、没有 restore writer；`targetAgent=dsh` 和 `all` 的 artifact restore 继续 fail-closed。
- **已修（本轮自动化验证）**：初始 `npm test` 为 333/333；Review 2 补强后为 334/334，架构/inventory 聚焦组 10/10，typecheck 通过；独立 manifest/真实 pack 组为 25/25；真实 CLI smoke 随全量测试通过；隔离 workspace 的 Codex-only update dry-run 为 11 skipped / 0 error，报告确认 `targetAgent=codex`，计划不含 OpenCode 配置/cache 或 `codebase-memory-mcp`。
- **仍待外部验收**：另一台全新 Windows 的 bootstrap/首次登录/winget-UAC 矩阵仍按原记录待验，不能由本轮架构与隔离 dry-run 替代。

## 2026-08-24 severin Windows raw bootstrap 复验（基于 `1d3300b`）

### 已确认修复

- 隔离工作区已从 `bc68f75` 快进到 `1d3300b`；本地既有未提交文件与远端变更无路径重叠，未被覆盖或纳入本次记录。
- `npm test` 一次通过 379/379、82 suites、0 failed；此前偶发失败的 Windows Git submodule fixture 本轮完整通过。
- skill source 的 120 秒超时、15 秒 heartbeat、最多三次有界重试和脱敏恢复报告均在真实 bootstrap 中触发并按设计工作。
- `google-deepmind/science-skills` 首次超时后第二次命令退出成功，证明瞬态网络重试链路能够继续执行。
- `codebase-memory-mcp`、`gpt-dotfiles-sync`、`agent-browser`、`brand-extract` tombstone 均保持 satisfied，没有被重新安装。

### 问题 16：source 级 `complete` 事件会掩盖最终失败（已修复，待 severin raw 复验）

**现象**

- `open-design` 和 `gstack` 都输出了 source 级 `complete`，但随后 setup 返回 `ok=false`、bootstrap 退出码 1。
- 源码当前无论来源恢复成功还是失败，都会在循环尾部发送 `phase="complete"`；该词实际只表示“此来源处理结束”，不是“安装完成”。

**影响**

- 用户和 Agent 会把 `complete` 误读为安装成功，并与最终错误产生矛盾，增加错误诊断成本。

**解决方案**

- 将进度终态拆为明确的 `succeeded`、`failed`、`already-complete`，或为 `complete` 增加不可省略的 success/result 字段；CLI 文案必须直接输出成功或失败。
- 为“最后一次命令退出 1 后仍发送 complete”增加回归测试，禁止失败来源显示成功语义。

### 问题 17：恢复成功判定只信任 CLI 退出码，没有验证最终 skill 集合（已修复，待 severin raw 复验）

**现象**

- `science-skills` 第二次命令被记录为成功，但磁盘复扫仍缺少 `scienceskillscommon`；按 dotfiles 的 210 个选择项逐 ID 核对，当前只匹配 57/210。
- 分来源实际结果为：Anthropic 18/18、Agent-Reach 1/1、science-skills 38/39、open-design 0/151、gstack 0/1。
- 当前实现仅在“准备重试之前”复扫该来源是否完整；命令退出 0 后不会复扫完整性，最后一次非零退出后也不会复扫以识别可能的部分成功。

**影响**

- CLI 退出 0 但漏装 skill 时会产生假成功；CLI 非零但已完成部分写入时也无法给出准确缺失清单。

**解决方案**

- 每一次安装命令结束后都重新扫描，并以“该来源所有 selected skill 均存在且来源一致”作为唯一成功条件，退出码仅作为诊断和重试分类证据。
- 对部分成功只重试缺失项或重新执行来源级幂等安装；最终错误必须报告准确的 present/missing 数量及最多三个缺失示例。
- 增加“退出 0 但缺一项”“退出 1 但实际已完整”“退出 1 且部分安装”三组回归测试。

### 问题 18：无诊断文本的 clone 退出 1 不会重试，报告摘要被终端控制字符污染（已修复，待 severin raw 复验）

**现象**

- `gstack` 首次运行约 22 秒后退出 1，stdout 只有 `Cloning repository` spinner、stderr 为空、errorType 为空，因此没有命中瞬态网络错误正则，也没有第二次尝试。
- `open-design` 前两次明确为 `ETIMEDOUT` 并重试，第三次约 40 秒后同样只留下 clone spinner 和退出码 1，最终失败。
- 脱敏报告虽然没有密钥，但 stdout 仍包含 `[?25l`、`[1G[J` 等 ANSI/终端控制序列，主错误无法呈现真正的 Git 失败原因。

**影响**

- 网络克隆失败一旦被第三方 CLI 吞掉 stderr，就会被当作非瞬态失败立即终止；恢复报告也只有动画噪声，不能支持根因分析。

**解决方案**

- 优先让 skills CLI 使用非交互/无 spinner 输出；若不可控，则在 U同步层剥离 ANSI/光标控制序列，并保留底层 Git 的最终诊断。
- 对处于 clone 阶段、短时间退出 1 且无权限/认证/404/manifest 等永久错误证据的结果，允许有界重试，但必须受总次数和总时间限制。
- 报告新增 failureStage、lastMeaningfulLine、retryDecision 和 decisionReason，测试 spinner-only、空 stderr、永久错误三种分支。

### 问题 19：PowerShell 验收命令不能在 Web 请求后直接判断 `$LASTEXITCODE`（已修复，待 severin raw 复验）

**现象**

- 首次复验把 `Invoke-WebRequest` 后的 `$LASTEXITCODE` 当成 cmdlet 退出码；该变量未由 PowerShell cmdlet 设置，空值与 0 比较导致脚本在真正执行 bootstrap 前提前退出，并呈现误导性的进程退出 0。

**解决方案**

- 下载步骤使用 `$ErrorActionPreference='Stop'` 或 `Invoke-WebRequest -ErrorAction Stop` 捕获异常；只在执行原生程序后检查 `$LASTEXITCODE`，并把文档中的多行命令作为自动化 smoke fixture 验证。

### 本轮停止点

- setup 返回 `ok=false` 后已按顺序执行规则停止，没有继续运行 final verify；因此当前不能声称 5/5 来源成功、210/210 skills 可用或 bootstrap 退出码 0。
- 本轮完整脱敏证据位于 `usync-dotfiles/state/recovery-reports/skill-source-github-nexu-io-open-design-1787502276728-69652.json` 和 `skill-source-github-garrytan-gstack-1787502298807-69652.json`。

### 问题 16—19 当前代码状态（2026-08-24）

- **问题 16 已在代码与自动化中修复**：source 终态改为 `succeeded`、`failed`、`already-complete`；失败路径不再输出 `complete`，CLI stderr 直接呈现明确终态，结构化 source summary 仍只保留一份。
- **问题 17 已在代码与自动化中修复**：每次 source 安装命令结束后都立即复扫，并按当前 `normalizeExtensionSource` 规则逐项核对该来源的 selected skill ID。退出 0 但缺项会失败或继续有界重试；退出 1 但复扫完整按幂等成功处理；部分安装继续重试。最终错误报告准确的 `present`、`missing` 和最多三个缺失示例。38/39 fixture 会明确列出 `scienceskillscommon`，实现中没有硬编码该仓库或 skill。
- **问题 18 已在代码与自动化中修复**：skill 专用诊断路径先剥离 ANSI、光标和 spinner 控制序列；clone 阶段的空诊断退出 1 在最多三次和来源总时限内重试，权限、认证、404、manifest 等永久证据立即停止。attempt 报告包含已脱敏的 `failureStage`、`lastMeaningfulLine`、`retryDecision`、`decisionReason`。
- **问题 19 已在脚本、文档与 smoke 中修复**：`Invoke-WebRequest` 使用 `-ErrorAction Stop` 和 `try/catch`；通用 retry wrapper 不再读取 cmdlet 不会设置的 `$LASTEXITCODE`，只在 `git`、`npm`、`powershell.exe` 等原生程序调用后检查退出码。文档 raw bootstrap 命令的 fixture 已验证原生退出 7 不会被误报为 0。
- **保持不变的安全边界**：`codebase-memory-mcp` 永久 tombstone、Codex-only 不访问 OpenCode、source 级聚合、heartbeat、单次/总超时和受信 `.cmd` 路径均由既有与新增测试继续覆盖。
- **本地自动化证据**：问题 16—19 聚焦组 43/43 通过；完整 `npm test` 为 390/390、82 suites、0 failed；typecheck 通过；bootstrap、recovery/manifest、DSH schema、真实 pack 与 CLI smoke 逐文件串行独立复核为 30/30。staged GitNexus 门禁结果在提交记录中另行报告。
- **仍待实机验收**：当前 HEAD 尚未在 `severin` 机器重新执行 raw GitHub bootstrap，因此现在仍不能声称 5/5 skill 来源、210/210 selected skills、setup/verify `ok=true` 或 bootstrap 退出码 0；必须在本提交推送后按本文入口重跑。

### 问题 20：GitNexus 提交门禁在首次下载依赖时被网络超时阻断

**现象与处理**

- 当前 Codex 会话没有暴露 GitNexus MCP 的 `detect_changes` 工具，本机也没有全局 GitNexus，因此提交前按仓库规则调用 `.gitnexus/run.cjs` 安装 runner。
- pnpm 下载 `onnxruntime-node-1.27.0.tgz` 时经过内置重试后仍以 timeout error 23 失败，导致强制的 `detect_changes` 门禁无法执行。
- 本轮没有绕过门禁提交或推送；问题文档保留为隔离工作区中的单文件未提交增量，待网络恢复并成功运行 `detect_changes({scope: "staged"})` 后再提交。

**改进建议**

- 为不需要 embeddings 的 `detect_changes` 提供不下载 `onnxruntime-node` 的轻量安装路径，或随 U同步预装可离线执行的 GitNexus 门禁运行时。

### 问题 21：severin raw bootstrap 的 marketplace 网络刷新耗尽后中断（本轮已修复，待实机复验）

**现象**

- severin 实机 bootstrap 的 source checkout 已从 `b4214d5` 快进到 `62e65d1`，`390/390`、build、prepack 和 tarball 均通过；随后 Codex personal marketplace 的 `git pull --ff-only origin master` 连续三次 connection reset，bootstrap 返回 `ok=false`、退出码 1，restore/setup/verify 未继续执行。
- 本机没有该实机的 staged raw 报告；以下状态仅基于用户提供的现象和本仓库自动化 fixture，不声称已取得或复验远端报告。

**解决方案与边界**

- 保留原有三次网络 `pull --ff-only` 行为；三次失败后只在 marketplace 与已成功更新的 source checkout 的 `origin` 均规范化等于 `UagentRepo` 时，使用本地 source repository fetch + `merge --ff-only` 回退。
- 回退逐次检查原生 Git 的 `$LASTEXITCODE`，不 reset、不 force；来源不一致、本地无法快进或最终 marketplace 未包含当前 source commit 时仍失败，不会继续 `plugin add` 或伪报成功。
- plugin add 前再次验证 marketplace HEAD 已包含/达到当前 source commit；Codex-only、`codebase-memory-mcp` tombstone 和后续恢复流程保持不变。

**本地验证**

- 新增真实本地 Git fixture：三次远端失败后的同源快进、source origin 不一致拒绝、marketplace 非 fast-forward 拒绝；bootstrap 聚焦测试 `10/10` 通过。
- **仍待 severin raw 复验**：本修复尚未推送，也未在 severin 实机重跑；必须在包含本修复的 raw GitHub bootstrap 上确认 marketplace HEAD、plugin add、restore/setup/verify 和最终退出码。

## 2026-08-24 `b4214d5` / `62e65d1` severin 实机复验：marketplace 刷新被外部网络阻断

- 首次 `git fetch origin master` 连接 GitHub 443 端口超时，第二次成功；隔离工作区安全快进到 `b4214d5b101650aabf999687cd492e534e3dd41f`，本机其他未提交文件均被保留。
- raw bootstrap 启动后又检测到远端前进至仅调整测试的 `62e65d1`，并自动快进；因此本轮实际测试目标为 `62e65d1`。
- 完整 `npm test` 为 390/390、82 suites、0 failed、0 cancelled；新增的 38/39 复扫、exit 1 幂等成功、部分安装重试、spinner-only clone 重试和明确 source 终态均在真实完整测试中通过。
- 真实 prepack/build、production tarball 全局安装和 marketplace 路径核验已经通过。
- 随后的 Codex marketplace `git pull` 连续三次返回 `Recv failure: Connection was reset`，bootstrap 正确返回 `ok=false` 和退出码 1，错误为 `git pull Codex marketplace failed`。
- 已按顺序执行规则停止；没有进入 restore-dotfiles、skills 恢复、setup 或 final verify，所以仍不能声称问题 16—19 已通过 severin 真实来源下载验收，也不能声称 5/5 来源或 210/210 skills 可用。

**处理与改进建议**

- 网络恢复后直接重复同一 raw bootstrap 入口；已完成步骤由状态文件和真实版本检查安全复用，不应手工跳过 marketplace 门禁。
- bootstrap 已经从同一远端更新、测试并打包了 U同步 checkout，marketplace 刷新可考虑复用这个经过验证的本地对象库或 bundle，减少对同一 GitHub 仓库的第二次独立网络拉取；仍须核验 origin 与目标提交一致并保持 fast-forward 语义。
- 更换 VPN 节点后再次执行同一 raw 入口：raw 文件下载成功，但 Uagent Sync `git pull` 三次有界尝试分别出现两次 `Recv failure: Connection was reset` 和一次 GitHub 443 连接超时；bootstrap 在第一项必需拉取处退出 1，表明该节点对 GitHub raw HTTP 的可达性有所恢复，但 Git smart HTTP 连接仍不稳定。
- 远端 `0534348` 与 GitHub Actions 全绿后再次准备最终验收时，severin 机器的预检 `git fetch origin master` 仍连续三次失败（两次 connection reset、一次 GitHub 443 超时）；本机未取得 `0534348`，因此按门禁没有运行 raw bootstrap，也没有产生新的 5/5、210/210、setup 或 verify 结论。

### 问题 22：PowerShell 会在单词内部自动折行，`0534348` 的兼容断言仍不完整

**现象**

- 更换 VPN 后 Git 通道恢复，本机成功快进到远端 `0534348`，但 raw bootstrap 的完整测试为 392/393，唯一失败为 `rejects a source-origin mismatch before using the local fallback`。
- 生产脚本正确拒绝了不匹配的 source origin；实际 PowerShell stderr 把 `not` 在控制台宽度边界拆成 `no\r\nt`，而测试正则 `/source repository origin\s+does\s+not\s+match UagentRepo/i` 只允许单词之间出现空白，不能匹配单词内部折行。
- GitHub Actions 的 Node 20/22 全绿没有覆盖 severin 当前 PowerShell host 的具体输出宽度，因此该问题只在本机真实 bootstrap 中暴露。

**解决方案**

- 测试应先把 PowerShell 诊断中的所有空白 canonicalize 后再比较固定语义片段，例如将实际输出与预期短语都执行 `replace(/\s+/g, "").toLowerCase()`，再断言包含 `sourcerepositoryorigindoesnotmatchuagentrepo`。
- 新增一个明确把 `not` 折成 `no\r\nt` 的 fixture，确保断言不再依赖控制台宽度；生产脚本的 origin 校验和 fail-closed 行为无需放宽。
- bootstrap 已因 `npm test failed` 返回 `ok=false` 和退出码 1，并按门禁停止；没有执行 pack 安装、marketplace 回退、skills 恢复、setup 或 verify。

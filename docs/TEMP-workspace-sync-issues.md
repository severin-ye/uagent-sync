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

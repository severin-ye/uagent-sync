# U同步改进清单

> 记录日期：2026-08-23  
> 用途：在原电脑上重构 U同步后，再由当前电脑拉取并重新执行完整的 Codex 恢复流程。  
> 详细证据：[首次安装与 bootstrap 问题](./TEMP-bootstrap-install-issues.md)；[插件与数据同步问题](./TEMP-workspace-sync-issues.md)。

## 一键安装与宿主作用域

1. 用户只提供 U同步和 dotfiles 的 GitHub 地址后，程序应自动完成环境准备、安装、恢复和验证。
2. U同步必须自动识别当前目标是 Codex、OpenCode 还是其他宿主，并把该选择持久化。
3. Codex 模式只能检查和修改 Codex 配置，不能把 OpenCode 缺失报告为错误。
4. 首次安装时应自动创建或更新 Codex personal marketplace，并真正安装和启用插件。
5. 安装完成后应提示新建任务加载扩展，不能简单地把“重启 Codex”当作唯一生效方式。

## 环境依赖与命令发现

6. U同步应自动检测并安装 Node.js、npm、Git、GitHub CLI 和 Codex CLI 等必需依赖。
7. 依赖检查必须执行真实版本命令，不能仅凭文件或命令名称存在就判断可用。
8. Windows 下应能识别并避开存在但不可执行的 WindowsApps 版 `codex.exe`。
9. winget 的 `msstore` 源失败时应自动切换到可用的 `winget` 源。
10. 遇到 UAC 长时间等待时应先检查软件是否已实际安装，再决定重试或使用免管理员方案。
11. 安装路径不能硬编码为标准目录，而应通过 PATH、注册表和已知位置综合发现。
12. npm、GitHub 和 Git 下载应具有超时、退避重试、进度显示和安全的失败恢复。
13. npm 出现半安装状态时应自动检测并安全重装，而不能把包目录存在当作成功。
14. GitHub 操作失败时应分别诊断网络、登录状态、仓库存在性、私有仓库权限和 Git 凭据。
15. 所有日志都必须隐藏 token、API 密钥及其他敏感信息。

## 构建、测试与插件发布

16. `npm test` 应在干净仓库中自动先构建 `dist`，不能要求用户提前执行隐藏的 build 步骤。
17. 构建失败时应立即停止并只报告根因，避免产生大量重复的缺失模块错误。
18. Codex 插件 manifest 应持续符合当前验证器规范，并自动检查必需字段和禁止字段。
19. 插件 manifest 版本必须和 `package.json` 版本自动保持一致。
20. Codex 插件规范文档、示例、脚手架和验证器必须统一，不能对 `hooks` 等字段互相矛盾。
21. 发布包必须包含或自动安装全部运行时依赖，避免安装后缺少 `smol-toml` 等包。
22. CI 必须从真实的 `npm pack` 产物安装并运行 CLI smoke test，不能只测试源码目录。
23. 安装验证必须同时确认插件已启用、CLI 能运行、skills 能加载以及核心命令能执行。
24. 临时安装目录必须使用安全 API 创建并验证绝对路径，避免危险的递归清理命令。
25. Windows 子进程应尽量使用无 Profile 模式，避免 PowerShell profile 的错误污染执行结果。

## 错误处理与可恢复执行

26. 所有必需步骤失败都必须返回非零退出码，不能在 `pull`、`verify` 或 `setup` 失败后仍返回成功。
27. 工具应返回包含 `ok`、`warnings`、`errors`、`skipped` 和 `targetAgent` 的结构化结果。
28. 可选组件与必需组件必须明确分类，单个非 Codex 子模块失败不应阻断 Codex 配置。
29. 初始化缓存与用户本次提供的模式或 URL 冲突时，应识别陈旧状态并安全更新。
30. GitHub URL、工作区和目标宿主只应在首次确定时询问，此后应可靠复用且允许显式覆盖。

## 状态文件与敏感信息

31. `workspace-state.json` 必须从设计上排除明文密钥，只保存变量名称、来源类型和缺失状态。
32. `export` 和 `push` 必须在写入或提交前执行 secrets 扫描，并阻止敏感数据进入 Git。
33. 远端必须始终保存一份安全且足够恢复环境的状态清单，不能删除唯一恢复文件后让协议失效。
34. `pull` 找不到核心状态文件时必须明确失败，或自动切换到经过定义和测试的备用清单。
35. 本机重新生成的状态文件必须标明来源机器和完整程度，不能冒充旧设备的完整备份。

## Skills 的来源与跨设备恢复

36. 每个 skill 必须保存稳定的下载来源，例如 `owner/repo@skill`、仓库 URL、版本或 commit。
37. skill 的旧机器绝对路径只能作为历史安装位置，不能作为新机器的唯一恢复来源。
38. 本地自定义 skills 必须备份实际内容，或者保存可访问的私有仓库来源。
39. 恢复前应把 skills 分为可恢复、已存在、来源缺失、发生冲突和明确删除五类。
40. U同步应支持跨用户名和跨设备恢复，不能依赖 `C:\Users\6seve` 之类的固定路径。

## 插件、MCP 与删除语义

41. plugins、skills 和 MCP 应分别维护宿主专用清单，不能混用 OpenCode 与 Codex 数据。
42. U同步只能安装 dotfiles 明确选择的插件，不能把 marketplace 中所有可用插件全部安装。
43. 历史说明文档和 `know-how` 内容不能被当作当前待安装扩展清单。
44. 删除扩展时必须写入 tombstone，并让删除记录优先于旧快照、历史文档和自动发现结果。
45. 删除 `codebase-memory-mcp` 后，`pull`、`setup`、`update` 和 `verify` 都不得重新引入它。
46. 删除扩展时应同步清理各宿主 manifest 中的陈旧条目。
47. MCP 恢复必须按 Codex 清单验证真实配置，目前缺失的 `gpt-dotfiles-sync` 应被准确报告。
48. API 密钥流程只能检测缺失项和生成安全模板，不能读取、显示或覆盖真实密钥。

## 幂等性、审计与验收

49. 安装流程必须可安全重复执行，并能从上次失败步骤继续而不破坏已有配置。
50. 最终验证必须按 Codex 作用域逐项确认插件、skills、MCP、CLI 和配置确实可用，而不是只检查文件存在。
51. 安装日志应保存每个组件的来源、版本、安装命令、结果和失败原因，以便审计和重新恢复。
52. CI 应覆盖干净 Windows、路径变化、网络重试、私有仓库、状态缺失、敏感信息和删除扩展等真实场景。

## 2026-08-23 实施状态（逐项）

状态口径：**已修复**＝代码和回归测试已落地；**部分修复**＝主路径已实现，但仍缺真实外部场景或全矩阵验证；**仍阻塞**＝当前没有可靠实现。详细重试见 [Codex 新电脑端到端重试指南](./CODEX-CLEAN-WINDOWS-RETRY.md)。

1. **已修复**：`scripts/bootstrap.ps1` 以两个 GitHub URL 为唯一业务输入，串联准备、安装、恢复和验证。
2. **已修复**：引入并持久化 `targetAgent`，支持显式覆盖和宿主环境识别。
3. **已修复**：Codex 的 pull/setup/verify/export 分支使用独立 Codex 缓存，不读取或写入 OpenCode 配置/缓存，并有隔离测试。
4. **已修复**：自动注册 personal marketplace，使用当前 CLI 的 `plugin add` 安装，并用 JSON 确认 installed/enabled。
5. **已修复**：完成后明确提示新建 Codex 任务加载 skills，不再把重启当作唯一手段。
6. **已修复**：自动处理 Git、gh、Node/npm、Codex CLI；winget 失败使用当前用户 portable fallback。
7. **已修复**：依赖判据均执行真实版本命令。
8. **已修复**：WindowsApps `codex.exe` 被判定为无效并改走 npm CLI。
9. **已修复**：winget 显式使用 `--source winget`，失败后切换 portable fallback。
10. **已修复**：优先采用无需 UAC 的 portable fallback；安装后再次执行真实命令确认。
11. **已修复**：通过命令解析和 PATH 刷新发现工具，不依赖标准安装目录。
12. **已修复**：npm/Git/GitHub 下载使用有界重试、退避和可见输出。
13. **已修复**：Codex npm 包先卸载半安装状态，再重装并执行 `codex --version`。
14. **部分修复**：已自动检查 gh 登录、仓库存在性和私有仓库权限；更细的网络错误分类仍依赖上游错误文本。
15. **已修复**：结构化错误脱敏，提交前还有独立 secrets 扫描门禁。
16. **已修复**：`pretest` 自动 clean build；无 `dist/` 的 checkout 可直接执行 `npm test`。
17. **已修复**：构建是测试前置门禁，失败立即停止；测试文件串行避免 pack 的 clean build 竞态。
18. **已修复**：manifest 必需/禁止字段有回归测试，并已用当前 Codex CLI 隔离安装验证。
19. **已修复**：package、Codex manifest 和 marketplace 版本一致性有测试。
20. **已修复**：顶层 `hooks` 已移除，skills 走默认发现，验证规则与实际清单一致。
21. **已修复**：真实 tarball 安装生产依赖，并验证 `smol-toml`、`zod` 可解析。
22. **已修复**：`npm test` 内含真实 `npm pack`、生产依赖安装和 CLI smoke。
23. **已修复**：bootstrap/verify 同时验证插件、CLI、selected skills、MCP 和 Codex 配置。
24. **已修复**：测试使用 `mkdtemp`；bootstrap 不对计算路径做递归清理。
25. **已修复**：Windows 重试入口和子 PowerShell 使用 `-NoProfile`，按退出码/JSON 判断。
26. **已修复**：pull/verify/setup 任何必需错误均非零退出。
27. **已修复**：三者统一返回 `ok/warnings/errors/skipped/targetAgent`。
28. **已修复**：Codex-only 分支把 OpenCode/非 Codex 工作区内容列为 out-of-scope，不阻塞。
29. **部分修复**：`--force` 可安全更新显式 URL/模式/宿主；自动冲突迁移仍保持保守失败。
30. **已修复**：初始化状态可靠复用并允许显式覆盖。
31. **已修复**：v2 状态只保存变量名/安全来源元数据，不保存密钥值。
32. **已修复**：export、push、crystallize 写入或提交前执行 secrets 扫描。
33. **已修复**：dotfiles 重新提交安全且足够恢复的 `workspace-state.json`。
34. **已修复**：核心状态缺失时明确非零失败；不再用未定义文档猜测恢复。
35. **已修复**：状态含 source machine、targetAgent 和 completeness，不冒充旧快照。
36. **已修复**：210 个当前 skill 保存仓库 URL、skill path 和内容 hash/版本。
37. **已修复**：旧用户名绝对路径已从 Codex 当前 manifest 清除。
38. **已修复**：当前自定义项 `agent-reach` 保存可信仓库来源；无来源陈旧项写 tombstone。
39. **已修复**：恢复分类器输出可恢复、已存在、来源缺失、冲突和明确删除。
40. **已修复**：恢复只使用 portable 来源和用户 HOME，不依赖固定 Windows 用户名。
41. **已修复**：Codex 当前清单独立存放；OpenCode 历史配置不进入 Codex 状态。
42. **已修复**：只迭代 dotfiles `agents.codex` 的 selected 项，不遍历 marketplace 可用项。
43. **已修复**：know-how/安装日志明确标为历史，不参与恢复发现。
44. **已修复**：tombstone 在分类和执行阶段优先于 selected、旧快照和文档；文件损坏时 fail-closed，永久删除项即使被旧清单省略也继续生效。
45. **已修复**：pull/setup/update/verify 均有 `codebase-memory-mcp` 禁止恢复测试或硬性检查。
46. **已修复**：Codex MCP manifest 已清除该陈旧项，另有永久 tombstone。
47. **已修复**：`gpt-dotfiles-sync` 经实际安装日志确认已退役并写 tombstone；`node_repl` 标为 Codex runtime 管理，但最终验证仍要求其真实出现在 Codex 配置中。
48. **已修复**：API 流程拒绝 `--key-value` 和真实 token，只接受变量名/占位符。
49. **已修复**：bootstrap 状态逐步持久化并记录源码 commit；同一 commit 复用构建/安装结果，源码变化自动失效旧步骤，安装命令容忍 already-present。
50. **已修复**：verify 对 selected plugin/skills/MCP/CLI/config 做实际命令和清单比对。
51. **部分修复**：bootstrap 与现有 install-log 保留步骤、来源和失败原因；portable fallback 的精确下载 commit 尚无统一审计字段。
52. **部分修复**：已有 Windows CI、状态缺失、密钥、tombstone、跨 HOME、真实 pack 测试；私有仓库登录、真实断网重试和全新 Windows 整机仍需按重试指南执行验收。

**仍阻塞：无代码级阻塞。** 外部条件只剩私有 GitHub 仓库首次浏览器身份确认，以及真实全新 Windows 整机验收；两者无法在当前已配置机器上伪造为已验证。

## 2026-08-23 第二轮真实 Windows 增量状态

本轮保持上述 52 项口径，针对真实 bootstrap 暴露的差距作如下更新：

- **第 8、11 项 — 已修复并实机验证**：恢复器解析 npm global bin 的可信 `codex.cmd` 和 Node 安装目录的 `npx.cmd`，拒绝 WindowsApps；真实子进程测试验证参数不经过 shell。
- **第 12、49 项 — 已修复并实机验证**：新增 npm 12 pack JSON 兼容、dotfiles pull 重试、marketplace origin 校验与 Git 更新重试；同一隔离 workspace 可从失败步骤安全重入直至退出码 0。
- **第 15、48 项 — 已修复并实机验证**：恢复命令 stderr 在进入 structured result 前脱敏、移除控制字符并限长；验收日志和状态未包含真实密钥。
- **第 19 项 — 已修复并实机验证**：bootstrap 不再只检查 installed/enabled，还要求已安装 U同步插件版本等于源码 `package.json`；陈旧 2.0.0 缓存已更新并确认 2.1.0。

## 2026-08-23 Codex 自更新闭环补充

- **更新命令自身 — 已修复（自动化验证）**：`update --target-agent codex` 的 `sync` 组件不再只拉取、安装依赖和构建；现在依次执行 `git pull --ff-only`、`npm ci`、完整 `npm test`、真实 `npm pack`、从 tarball 重装全局 CLI、核验 personal marketplace Git 来源并刷新、重新安装 U同步插件，最后确认 installed/enabled/version 与源码一致。
- **失败传播 — 已修复（自动化验证）**：上述任一必需步骤失败均记为 `error`；后续替换 CLI 和插件的步骤会被跳过，CLI 总退出码为非零，不再把部分完成报告为成功。
- **Codex-only 作用域 — 已修复（自动化验证）**：更新报告持久化 `targetAgent`；Codex 默认更新不扫描 OpenCode plugin cache，也不读取或更新 OpenCode config dependencies。OpenCode 插件入口仍显式传入 `targetAgent=opencode`，与 Codex 流程隔离。
- **发布版本 — 已修复（自动化验证）**：本轮补丁版本升至 `2.1.1`，`package.json`、lockfile、Codex plugin manifest 与 marketplace 元数据保持一致，避免 Codex 复用旧的 2.1.0 插件缓存。
- **Windows 实机验收 — 已通过**：真实执行 Codex `sync` 自更新得到 `8 ok / 0 warning / 0 error / 0 skipped`；全局 CLI 与 installed/enabled 插件均确认到 `2.1.1`，marketplace 来源核验和 Git 快进成功。
- **第 39 项 — 已修复并实机验证**：同一 GitHub 仓库的 URL、`.git`、大小写和 `owner/repo` 表示统一；同源 U同步为 existing，真正异源仍为 conflict。
- **第 44、45 项 — 已修复并实机验证**：原始扫描与导出过滤分离，tombstone 缺席不执行删除，存在时删除后复扫；`codebase-memory-mcp` 最终 absent。
- **第 50、51 项 — 已修复并实机验证**：210 个 selected skills 全部可用，并按 5 个 source 汇总；setup 仅 13 个聚合 skipped，verify 逐项确认插件、skills、MCP、CLI、配置。
- **第 52 项 — 部分修复**：本机真实 Windows PowerShell `-NoProfile` 隔离 workspace 与推送后 raw GitHub 唯一入口均已通过；raw 验收提交为 `a30ec80`，总退出码 0，setup/verify 均 `ok=true`。仍需另一台真正全新 Windows 机器验证 winget/UAC/首次 gh 登录矩阵。

## 2026-08-23 第三轮跨设备网络修复

- **第 12、49 项 — 已修复，待第二台机器复验**：skill source 现在独立执行 3 次有界重试、指数退避、重试前重扫、单次 120 秒超时和 15 秒 heartbeat；真实临时 `npx.cmd` 测试验证前两次 reset、第三次成功。
- **第 15、27、51 项 — 已修复**：最终错误分别保留脱敏 stdout/stderr、exit code、可信路径和错误类型；终端只给数量与 3 个示例，完整列表和 attempts 原子写入 secrets-scanned recovery report。
- **第 50、52 项 — 部分修复**：原电脑 270/270、真实 pack、setup/verify 均通过，但 `severin` 机器的 `open-design`/`gstack` 真实下载以及 bootstrap 最终 verify 仍需在本提交推送后复验，未伪报为通过。

## 原电脑修复后的重试验收

原电脑完成重构并推送后，当前电脑应只提供 U同步仓库地址和 dotfiles 仓库地址即可自动完成 Codex-only 安装、恢复与最终验证，并且全过程不得访问或修改 OpenCode、不得恢复 `codebase-memory-mcp`、不得泄露密钥、不得把失败报告为成功。

## 2026-08-23 架构项增量状态

- **已修**：共享 `ApplicationResult` 和 WorkspaceApplication 已覆盖 verify/export/import/setup/update/push/pull，CLI 与 OpenCode Plugin 只保留入口呈现职责。
- **已修**：FileSystem、Git、ProcessRunner 和 AgentAdapter ports 已落地；基础设施与 Agent scanner 通过 adapters 接入。
- **已修（runtime scanner/diff）**：Agent registry 可注入，`scanWorkspaceInventory` 和 `buildInventoryDiff` 根据实际 adapter/inventory 集合工作；四端 fixture 已走完 registry→scan→diff，前三端具备而第四端缺失的能力会形成 diff。
- **部分**：第四 Agent 当前只能作为 runtime scanner fixture 注入，类型测试仍需把新 id cast 为现有 `AgentId`。正式产品支持仍需扩展 `AgentId`、`AgentPaths`、默认 registry/target mapping、CapabilityMatrix、Dashboard route/presentation，以及 migration scope/context；不得把 scanner 可注入表述为 Dashboard/migration 已自动支持。
- **已修**：WorkspaceState v3 codec 已作为内部读时 contract 使用，迁移 v1/v2、拒绝未来版本并优先执行永久 tombstone；wire export 继续兼容旧格式。
- **已修**：新增 AST 级依赖边界测试，Entry → Application → Domain/Ports ← Adapters 的已迁移方向有自动化守卫。
- **部分**：`src/lib/` 仍是兼容性领域实现，composition root 仍在 `src/application/default-workspace-application.ts` 连接具体 adapters；这是当前已实装结构，不声称完成纯粹分层重写。
- **仍待**：DSH/all artifact restore contract 与 writer 尚未实现，当前必须 fail-closed。
- **仍待外部验收**：另一台全新 Windows 的 bootstrap、首次 gh 登录、winget/UAC 与真实私有仓库网络矩阵；本轮架构测试不能替代这些结果。
- **本轮验证已完成**：初始架构测试 RED→GREEN（4/4）；Review 2 的 bypass/四端 diff 测试为 3 pass / 2 fail → 聚焦组 10/10；typecheck 通过；全量由 333/333 更新为 334/334；独立 manifest/真实 pack 组 25/25；CLI smoke 通过；隔离 workspace 的 Codex-only update dry-run 为 11 skipped / 0 error，报告作用域为 Codex 且无 OpenCode 配置/cache 或 `codebase-memory-mcp` 计划。

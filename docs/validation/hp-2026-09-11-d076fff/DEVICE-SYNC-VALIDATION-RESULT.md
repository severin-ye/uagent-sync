# 惠普 U同步修复复验报告

**本轮两项修复通过；完整环境迁移仍未完成。**

## 验证对象

- 设备：惠普；用户目录：%USERPROFILE%；工作区：%USERPROFILE%\Codelib-severin（已确认存在）。
- 源码：severin-ye/uagent-sync，codex/device-sync-validation，完整 SHA **d076fff50b142b4d09a2fbee9b0b8882b1554b96**，克隆时与分支 HEAD 一致。
- 独立目录：%USERPROFILE%/AppData/Local/Temp/uagent-hp-revalidation-d076fff。本轮没有修改该提交的函数或测试，也没有使用旧全局 CLI。
- 系统：Windows 11 Pro for Workstations 10.0.26200；Node v24.19.0；Git 2.45.2.windows.1；npm 11.17.0；Codex CLI 0.149.0。
- 完整读取 docs/DEVICE-SYNC-ACCEPTANCE.md，按“首轮反馈后的修复与复验”先定向、后全量执行。

## 本轮结果

| 检查 | 结论 | 退出码 / 证据 |
|---|---|---|
| SHA、npm ci、build、device help、typecheck | PASS | 均0；logs/head、npm-ci、build、device-help、typecheck.log |
| 定向回归 | PASS：10/10，0跳过 | 0；logs/targeted.log；node --import tsx --test test/offline-workspace-copy.test.ts test/codex-profile.test.ts |
| 全量 npm test | PASS：419/419，0失败、0跳过 | 0；logs/test-real.log；真实USERPROFILE，源码位于独立目录 |
| 中文路径复制、续传与覆盖保护 | PASS | 定向测试强制 Get-Content 默认 Ascii；中文源目录、文件名、暂存目录均通过；输入未加BOM绕过 |
| Git目录/工作树指针排除 | PASS | 新测试及新真实快照验证；排除记录保留 |
| 包含 .GiT 的旧格式快照拒绝 | PASS | 合成旧格式fixture在写目标前拒绝；没有加载此前真实含.git快照 |
| 默认完整个人快照 | FAIL（仍有阻断） | 1；logs/c05-real-full-snapshot.log；13个Skill文件、23处规则命中 |
| 全新 config,rules,memories 快照 | PASS（部分组件） | 0；logs/c06-real-selected-snapshot.log；**9个文件，0个Git元数据文件** |
| 新快照恢复至全新隔离目标 | PASS | preview/apply均0；预览无写入；8个非config文件字节一致，配置路径映射一致 |
| 真实配置、记忆、相关缓存前后摘要 | PASS（已监测范围） | 三个阶段区间均0变化；state-change-intervals.json |

真实 USERPROFILE 全量回归已通过，因此未额外重跑空白 USERPROFILE 全套；不把空白环境结果冒充真实环境。419项通过是自动化测试结果，测试中无配置时提前返回的外部服务检查不等于已验证真实服务。

新快照排除记录包含：

- codex/memories/.git: Git metadata is not personal content。
- skills: explicitly not selected。
- sessions、SQLite、认证、插件缓存/运行态、自动化和宿主信任不复制。
- config.notify/desktop/windows/projects 属设备本地或不支持；mcp_servers.node_repl.env 属本地环境。

新快照目录：%USERPROFILE%\AppData\Local\Temp\uagent-hp-revalidation-evidence-d076fff\hp-profile-no-skills。
新隔离恢复目标：%USERPROFILE%\AppData\Local\Temp\uagent-hp-revalidation-evidence-d076fff\hp-backup-restore-target。
此前42文件快照未使用、未修改清单来绕过保护；本轮有效计数来自全新manifest。

## 仍阻断或未完成的项目

完整 Skill 采集仍为 **13个文件、23处命中**。规则和文件见 logs/c05-real-full-snapshot.log；相邻行的脱敏代码结构见 skill-blocker-redacted-context.json。上下文字符串值已遮蔽，不能将命中一律判定为真实密钥或误报。未修改扫描器、未删改原文、未整体跳过扫描；只在完整采集失败后明确选择三个组件生成部分快照。

| 完成维度 | 本轮判断 |
|---|---|
| 源码可运行 | PASS：本轮构建、定向、全套及类型检查均通过 |
| 个人文件可恢复 | 部分PASS：惠普三个组件到隔离目标通过；完整skills仍FAIL；荣耀实际恢复NOT RUN |
| 更新插件已安装 | NOT RUN：未安装本次修复版本；现有2.1.0/2.1.1缓存无device Skill |
| 宿主已加载 | NOT RUN：当前宿主目录未见新增device Skill及Severin联动；未重启或修改信任 |
| 完整迁移可用 | NOT RUN / 未完成 |

以下均未执行：荣耀真实快照恢复（未提供源机快照）；真实项目与依赖恢复；U同步设备配置仓库 publish/fetch及两机实际回传（未提供对应资料与获准测试远端）；Severin联动及新版插件安装；原始大文件搬运；历史对话/SQLite迁移。报告回传到源码仓库不等于资料同步。旧绝对路径继续保留在记忆原文，不自动替换。

## 真实状态保护

只读采集真实目录，连接和registry文件显式写在本轮临时目录；所有恢复目标也在临时目录，未覆盖运行配置、记忆或缓存。

监测区间（UTC）：
- 2026-09-11T09:13:08.705Z → 2026-09-11T09:15:36.521Z：state-after-real-tests.json，差异 0。
- 2026-09-11T09:15:36.521Z → 2026-09-11T09:15:48.394Z：state-before-snapshot.json，差异 0。
- 2026-09-11T09:15:48.394Z → 2026-09-11T09:16:11.151Z：state-after-snapshot.json，差异 0。

完整前后摘要存于 state-*.json，仅本机保留；监测范围包括 Codex config、AGENTS、rules、memories、skills、.agents/skills、本机连接、相关U同步缓存、OpenCode配置。没有观测到这些范围变化，无需回退。此结论只适用于本轮监测区间，不追认首轮记忆变化来源，也未还原或删除首轮来源未明变化。

构建生成的源码工作树状态单独记录在 logs/source-diff.log；没有手工修复源码。用户原正在工作的checkout未操作。没有全局安装或覆盖插件缓存。

## 产物与回传

本机报告：%USERPROFILE%/Codelib-severin/uagent-revalidation-hp-20260911-d076fff/DEVICE-SYNC-VALIDATION-RESULT.md。
实际命令/退出码：COMMANDS.md、commands.jsonl；日志：logs/；快照核对：fresh-snapshot-verification.json；扫描上下文：skill-blocker-redacted-context.json。

按用户此前要求，继续向同一GitHub分支回传公开脱敏报告和必要日志；真实个人快照、真实恢复清单及完整前后文件摘要不上传。公开副本会遮蔽用户根路径和敏感值。它只回传验收材料，不表示两机资料迁移完成。

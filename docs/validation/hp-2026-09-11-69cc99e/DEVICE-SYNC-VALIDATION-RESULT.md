# 惠普 U同步更新验收报告

结论：**本提交未通过完整验收，不是环境迁移完成。** 构建、类型检查和隔离设备交接可运行；两次完整回归均为 417 项中 416 PASS、1 FAIL。真实完整个人文件采集被 Skill 扫描阻断。未安装新增插件或 Severin 联动，未执行荣耀资料恢复和两机远端往返。

## 验证对象与环境

- 设备别名：惠普。实际用户目录：%USERPROFILE%。
- 工作区：%USERPROFILE%\Codelib-severin，实际存在。
- 系统：Windows 11 Pro for Workstations，10.0.26200，Windows；Node v24.19.0；Git 2.45.2.windows.1；npm 11.17.0；Codex CLI 0.149.0。
- 仓库：https://github.com/severin-ye/uagent-sync.git；分支 codex/device-sync-validation。
- 指定及实际 HEAD：69cc99ef4cb4df4f180ea53f21addad34ea6d22e。
- 独立源码目录：%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source。
- 唯一结果目录：%USERPROFILE%/Codelib-severin/uagent-validation-hp-20260911-173421。未提交、未上传；真实个人快照仅保存在临时本机目录。
- 完整阅读并按 A→B→C 顺序执行 DEVICE-SYNC-ACCEPTANCE.md；原文及 USAGE 副本随报告保存。

## 五项独立判断

| 判断 | 结果 | 实际边界 |
|---|---|---|
| 源码可运行 | PASS（有限） | npm ci、build、typecheck、device help 通过；完整回归 FAIL，不是整个版本合格 |
| 个人文件可恢复 | PASS（部分）/ FAIL（完整） | 合成四类组件恢复通过；惠普 config/rules/memories 到隔离目标通过；完整 skills 采集失败；荣耀真实恢复 NOT RUN |
| 插件已安装 | NOT RUN（本次更新未安装） | 缓存中已有旧 2.1.0/2.1.1，均没有 device Skill；源码同样标 2.1.1，版本数字不能证明内容相同 |
| 宿主已加载 | NOT RUN（新增入口未见） | 当前任务 Skill 目录没有 uagent-sync-device 或 Severin；未重启、未写信任、未改缓存 |
| 完整迁移可用 | NOT RUN / 未证明 | 缺荣耀快照、真实远端往返、项目依赖与大文件搬运、实际安装及宿主运行验收 |

## 逐项结果

| 检查 | 状态 | 退出码与证据 |
|---|---|---|
| SHA/分支/独立克隆 | PASS | 0；logs/source-head.log，logs/source-final-head.log |
| npm ci / build / device help / typecheck | PASS | 均 0；logs/npm-ci.log、build.log、device-help.log、typecheck.log |
| npm test，真实 USERPROFILE | FAIL | 1；logs/test-real-home-retry.log；417/416/1，skipped 0 |
| npm test，临时 HOME/USERPROFILE/CODEX_HOME | FAIL | 1；logs/test-isolated-home.log；417/416/1，skipped 0；父进程环境未修改 |
| 设备 ID、重复登记、rename、list/show、任意别名 | PASS | 成功命令 0；logs/b01 至 b06；最终运行见 attempt 后缀 |
| 默认四组件快照及预览无写入 | PASS | 0；b07/b08；isolated-checks.json |
| 首次冲突、prefer-source 备份原文 | PASS | 冲突预览及 apply 预期 1，首次覆盖 0；b09–b11 |
| 路径映射与规则/Skill/记忆原文 | PASS | byte/text assertions；isolated-checks.json |
| 反向交接 | PASS（手工协调后） | 首次无基线拒绝 1；手工协调后及建立基线后更新 0；b12–b19 |
| 双方同时改动及滥用 prefer-source 阻断 | PASS | 预期 1，目标摘要不变；b20–b23 |
| 路径逃逸、junction、密钥和身份覆盖保护 | PASS | 全套测试中相关测试通过；codex-profile/device-registry/profile-secret-scan/device-git-transport 测试名称见日志 |
| Windows 原始 UTF-8 中文路径搬运 | FAIL | 1；d01-utf8-no-bom-repro.log；与全套失败一致 |
| BOM 输入补充诊断：预览/复制/续传/覆盖保护 | PASS（仅诊断输入） | 0/0/0/预期1；d02–d05；不能替代原始回归通过 |
| 复制中源文件变化保护 | PASS（故障注入） | 预期1；d06；只在模拟 Copy-Item 之后修改源文件，正式目标文件未落地 |
| 惠普 config.toml 可解析、支持字段路径转换 | PASS | config-compatibility.json、real-config-mapping.json |
| 惠普 Skill 链接检查 | PASS（未发现链接） | skill-links.json：扫描 .codex/skills 和 .agents/skills 未发现链接；不代表所有缓存链接已审计 |
| 惠普默认完整快照 | FAIL | 1；c05；13 个文件的 23 个规则命中，完整路径/规则在 SKILL-COLLECTION-BLOCKERS.txt |
| 惠普 config/rules/memories 快照与隔离恢复 | PASS（部分） | c06–c09 均0；42文件，其中33个 .git 内部文件，9个非.git文件；41个非config文件字节一致，配置支持字段映射一致，预览未写入 |
| U同步 device Skill 源码可发现性 | PASS（源码） | source/skills/uagent-sync-device/SKILL.md；installed-plugin-evidence.json |
| 新版 U同步 / Severin 联动安装与宿主加载 | NOT RUN | 现有缓存无设备入口、未发现 Severin 安装；未覆盖缓存或运行配置 |
| npm audit | FAIL | 1；dependency-audit.log；brace-expansion high、esbuild low，均传递依赖；未自动修改锁文件 |

最终隔离脚本 12 项断言通过。详细实际命令、退出码、执行时间、用户目录和日志逐条见 **COMMANDS.md** 与 **commands.jsonl**。退出 1 的保护拒绝按预期 PASS，不能与回归失败混为一谈。

## 阻断问题与最小复现

1. **Windows PowerShell 中文报告编码**：Node 写 UTF-8 无 BOM JSON（transferFiles.path 为中文 file.txt），原脚本第9行 Get-Content -Raw 未显式编码，第45行 Get-Item 找不到路径。最小复现在 reproduction/offline-diagnostic.mjs；同一报告加 BOM 后不改源码即可走通复制/续传/覆盖保护，支持读取编码不一致的诊断。建议源码端显式 UTF-8，并保留无 BOM 中文路径回归。没有把诊断输入通过记作本提交回归通过。
2. **Skill 采集阻断**：本机默认 device snapshot 即复现。13个文件/23处规则命中，不等于确认13份真实密钥；未公开原文、未改扫描或删除原文。建议逐项审查示例和环境引用，增加精确回归后修复，禁止整体禁用扫描。
3. **记忆 .git 进入个人快照**：42文件包含33个 Git内部文件。建议明确排除 .git 并补测试，尤其避免将历史对象误当普通记忆文本和已完成安全扫描的内容。当前快照仅本机保留，未上传。
4. **路径与自动合并边界**：6个非.git文档仍含绝对路径，见 real-config-mapping.json，原文未替换。首次反向 config TOML 仅格式差异也产生无基线冲突；模拟中手工接受记忆并规范化TOML后建立基线，后续仅源变更能恢复。不能宣称跨设备自动合并。
5. **依赖审计**：保留 npm audit 原始脱敏 JSON；建议单独更新依赖并重跑完整回归，不在指定提交验收中混入修复。

## 未执行项目

- GitHub publish/fetch 真实往返：NOT RUN，未提供获准测试远端；示例 private-registry 仅作本地登记字段，未访问它、未创建远端。
- 荣耀真实个人快照恢复：NOT RUN，仓库没有荣耀快照或办公资料。
- 荣耀→惠普真实项目恢复、惠普→荣耀真实回传：NOT RUN，缺实际输入和远端往返条件。
- 新版 U同步与 Severin 联动安装、宿主加载/信任验证：NOT RUN，缺相应已验证安装发布输入，本次明确只验源码且保护缓存。
- 原始大文件迁移、项目依赖重建：NOT RUN，本轮不做；离线补充测试仅6字节模拟文件。
- 历史会话、SQLite、认证信息迁移：NOT RUN，个人快照排除，历史对话本轮未选择。
- 不执行全局安装、源项目 reset/clean、缓存覆盖、配置回写、报告提交或远端上传。

## 状态保护与产物

Codex config.toml、AGENTS、rules、skills、.agents/skills、相关 personal/uagent-sync 缓存、本机连接文件、OpenCode配置均与前置摘要一致。原正在工作的源码仓库已有未提交修改，前后 git status 列表完全相同；未对其源文件编辑、提交或切分支。摘要只覆盖列明的配置与相关缓存，不声称对整个工作区做了逐文件一致性检查。

**观察到真实 .codex/memories 期间变化**：MEMORY.md、memory_summary.md、phase2_workspace_diff.md、新增记忆Skill及内部Git元数据等变化见 protected-state-detail.json。来源未确认；验收脚本真实路径操作只有读取，恢复目标均在临时目录。不能宣称整个真实用户状态零变化，也未将来源不明变化回滚。没有验收前这些文件的完整内容备份，无法提供可靠回退；只有前后摘要及稍后生成的本机快照，不应把稍后快照冒充验收前备份。

临时源码构建曾在 status 中显示 src/dashboard/i18n.js 变化，已保留 source-generated-diff/source-final-diff-stat/status 证据；普通 git diff 未显示内容差异，未手动改验证提交的函数或测试。所有自编验收脚本在源码外，副本在 reproduction/。没有执行修复提交。

- 惠普本机部分备份：%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\hp-profile-no-skills（含个人原文，未复制到报告或上传）。
- 惠普备份隔离恢复目标：%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\hp-backup-restore-target。
- 模拟首次覆盖备份：见 isolated-fixture.json 的 firstBackup（非真实用户备份）。
- 报告及日志：%USERPROFILE%/Codelib-severin/uagent-validation-hp-20260911-173421。
- 脱敏策略：日志替换已知令牌模式、Bearer 值、URL凭据及token查询参数；真实扫描只输出文件路径、规则名、行号，不输出命中原文。日志保留本机路径以便定位，不作为公开发布内容。

本轮可交付的是验证证据与明确的失败/缺口；不表示插件已安装、宿主已加载或荣耀与惠普已同步成功。

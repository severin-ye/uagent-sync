# 当前调用路径（固定70428520228adcac3ac66a2cfb857667b7b69aed）

以下为静态核对，不是本轮执行入口。行号均基于固定生产源码，仓库内可直接定位。

| 路径 | 实际检查与副作用边界 |
|---|---|
| src/cli.ts:207 → runDeviceCli，src/entrypoints/device-cli.ts:11 | snapshot分支41调用createCodexProfile；restore分支46选择plan或apply；publish分支29调用publishDevicePaths。CLI当前async，底层四个函数当前同步。 |
| createCodexProfile，src/lib/codex-profile.ts:82 → collect/walk → assertProfileContentSafe别名assertNoSecrets，108 | 路径/链接/大小/源变动检查；config.toml先portableConfig转换；逐payload扫描，issues汇总后才121写payload、122写manifest。可在首次collect之前持有一次scan session；不得把加载放在walk里。 |
| planCodexProfileRestore，codex-profile.ts:164 → readSnapshot:125 → assertNoSecrets:138 | manifest路径/摘要验证后逐payload扫描，随后readBaseline和计算计划。readSnapshot没有写入；扫描不针对合并后的本地config凭据。 |
| restoreCodexProfile，codex-profile.ts:181 → planCodexProfileRestore:182 | 计划扫描通过后检查冲突、重新校验输入和目标；200首次备份写入、206目标写入、210基线写入。嵌套plan/readSnapshot必须复用外层session；独立preview和后来apply是两次操作，不复用旧plan或旧policy。 |
| publishDevicePaths，src/lib/device-git-transport.ts:26 → scan:29 → assertNoSecrets:34 | 全部显式目录扫描在43 assertPrivateGitHub之前；后者才调用git remote和gh查询。之后检查暂存、fetch、分叉、add/commit/push。拒绝测试应看到Git/gh mock新增调用为0，而非仅禁止push。 |
| assertProfileContentSafe，src/lib/profile-secret-scan.ts:5 | 调用recognizeProfileExpressions和scanForSecrets；前者141进一步调用PHP/Ruby识别。没有provider/文件读取，适合保留纯内容层。 |
| setupWorkspace(codex)，src/lib/workspace.ts:239/263 → restoreCodexExtensions，src/lib/codex-restore.ts:226 | 独立扩展恢复路径，412直接用基础scanForSecrets检查MCP JSON；213也用于恢复报告。不是profile文件入口，M2不进入该路径。src/sync.ts:19/20导出基础扫描/扩展恢复，保持既有语义。 |

GitNexus确认profile专用断言生产直接调用者为walk、readSnapshot和publish内部scan；plan的生产调用者包含runDeviceCli及restoreCodexProfile。图中动态/间接边可能不足，已对照上述函数实现。

特别边界：Codex扩展恢复是逐项操作，可能先处理tombstone/其他安全条目，再遇到危险MCP。不能声称整个混合批次事务性零副作用。人工“零execute”测试应限定仅危险MCP、无tombstone/其他条目；混合批次只断言危险条目没有执行，并保留原有语义。

静态风险保留：现有publish在扫描后仍可能发生文件并发变化，现有恢复也有多次读取；session固定只解决模板一致性，不证明所有文件TOCTOU已解决。沿用既有摘要/并发保护并复验，不把本范围扩大为文件事务重写。

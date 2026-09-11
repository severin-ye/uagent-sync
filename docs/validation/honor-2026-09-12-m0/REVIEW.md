# 荣耀 M0 源码与拒绝保护审查

验证对象：11237d974ce42f3377cf06faf01e351b8f20cc3d。交接输入31c849a563b78f3edaa988f1531884a912d98422。主对话审查前确认当前工作树相关源码与该SHA一致；独立目录运行由单独记录证明。

## 范围结论

独立修复提交恰好两个文件：src/lib/secret-scan.ts、test/secret-scan-m0.test.ts。生产代码只删除含占位符时continue整行，换成注释。未改变三条规则、LF/CRLF拆分、原文、返回格式及每规则每行至多一条的API；没有掩码，因此没有新增长度或换行转换。M1/M3的profile规范化逻辑未改。

惠普baseline-checks、commands、impact-summary、detect、green、full日志已读取；公开校验和核对通过。CRITICAL为惠普实际影响分析的整体调用范围，不是荣耀重新运行影响分析的结果。荣耀调用GitNexus context辅助核对；本地索引缺少profile调用边，按当前源码导入及调用点补查，不把图中缺边当成无调用。此轮不改生产符号。

## 入口及测试证据

| 保护 | 当前代码顺序 | 定向测试覆盖 |
|---|---|---|
| 同行三类凭据 | 对每行执行全部原规则 | 两类占位符前后、变体/相邻、长行，多命中API及脱敏输出 |
| 原始行号 | scanForSecrets直接按LF/CRLF分行，没有M0文本替换 | LF/CRLF、非BMP前缀、Unicode分隔字符，基础/profile同一人工内容行号 |
| 采集 | codex-profile walk扫描并收集内存payload；issues存在则在atomically写出前抛错 | 拒绝后快照目录不存在 |
| 恢复读入 | plan先readSnapshot逐文件核对摘要及扫描；restore先计划后备份/写入 | 人工恶意快照摘要一致仍拒绝，目标原文件不变，无备份/基线写入 |
| publish候选 | 逐路径扫描后才assertPrivateGitHub、Git及远端调用 | 同一规则/第2及3行拒绝，spawn调用0，无Git目录 |
| Codex MCP恢复 | config扫描失败continue，先于execute | 返回失败，执行回调0次 |
| Skill恢复报告 | redactString后扫描，失败return，先于mkdir/write | 残留人工凭据不写报告；此项属于既有保护回归 |

M0定向测试还断言占位符独立存在的兼容性，并拒绝M1空默认值/参数引用、M2说明、M3普通API占位符，防止连带扩大允许范围。未发现本次M0引入的实质缺陷。

## 结论限制

以上是M0范围内的审查，不是通用秘密检测正确性证明。profile既有规范化的跨行边界与原始行号问题仍属于下一阶段M1/M3门槛；本轮人工样本通过不证明所有跨行表达式安全。移除整行跳过可能暴露更多历史命中，本轮未重扫真实资料，不预测剩余数量。

RY-03仍阻断，不再次搜索/替换。M1/M3、完整采集、真实恢复、插件安装及GitHub私有资料往返均未执行。

## 首轮全量环境冲突（保留失败）

主对话最初要求同时固定UAGENT_SYNC_WORKSPACE_ROOT和OPENCODE_SYNC_WORKSPACE_ROOT到隔离源码目录。src/cli.ts及src/lib/cache.ts优先读取UAGENT变量，而既有CLI测试只覆盖OPENCODE到各自人工fixture。继承的高优先级UAGENT导致11项断言读错目录；不是M0定向失败，也不能删除日志冒充首轮通过。

恢复限定为只移除进程环境UAGENT_SYNC_WORKSPACE_ROOT，其他用户/应用/TMP隔离和OPENCODE隔离根保持。先重跑失败文件，再完整npm test一次。没有修改源码或测试；实际退出与计数见commands.json及README。

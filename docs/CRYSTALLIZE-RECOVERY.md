# 结晶异常与恢复

适用版本：2.1.2。维护源以 `src/lib/crystallize.ts`、`state.ts`、`guide.ts`、`crystallize-commit.ts` 和 CLI/插件入口为准。

## 本次核验

交接文档中的目标参数疑点已由隔离 CLI 红测试证实：旧入口在 `--target-agent codex` 下导出 OpenCode 状态，损坏的 Codex TOML 也没有被读取。旧 `readSkills` 对失效链接直接 `statSync`，可以使结晶中断；Codex 扫描此前还会跳过有效目录链接。安装日志先写入，后续生成失败会留下记录；旧 Git 阶段也会在“没有新提交”时提前返回，漏掉上次失败的推送。

2026-09-13 只读核对时，真实 `research-skill.legacy-broken-20260826` 是符号链接，目标 `Severin research skill/research-skill` 不存在。旧隔离目录中存在 Crawl4AI 成功记录 `29a9885c-f098-454d-ab36-1fa555d1f132`。这些事实不能证明原始链接为何失效，也不能证明 Crawl4AI 浏览器、抓取或当前接入状态。本修复没有改动该链接、Crawl4AI、Severin Skill 或旧结晶工作区。

## 扫描结果如何解释

- 正常目录和有效目录链接继续扫描，普通文件不作为 Skill。
- `broken-link`：链接目标不存在；`disappeared`：已枚举的条目消失；`permission-denied`：条目访问受限。跳过该条目、记录路径和错误码，其他正常条目继续处理，状态标为 `partial`。
- 根目录无法读取或未知 I/O 错误会阻塞导出，避免把不可靠扫描当成完整状态。普通可选根目录尚未创建不算异常。
- `scanDiagnostics` 保存在状态与指南，并在结晶输出中展示。Codex 指南按 `agents.codex` 生成，不使用 OpenCode 安装说明。缺少来源的 Codex 条目仍需人工恢复依据。

## 失败后怎样继续

修复外部故障后重跑原命令，保持安装字段一致。默认使用目标 Agent 和安装字段识别同一事件；提交说明变化不会追加安装记录。一次新的相同安装使用新的 `--event-id`，重试时保持该 ID 不变。

若要接续旧版本写下的部分日志，先核验实际日志，再用 `--resume-entry-id <精确记录ID>`。程序要求类型、名称、来源、安装状态相符，并保留原记录内容。不能根据组件名称擅自选取一条历史记录，也不需要删除旧记录。

`state/crystallize-operation.json` 保存事件、快照及产物摘要。生成阶段失败保留已写记录和断点；准备完成后的重试复用快照，只继续 Git 交付。若日志或产物已被后来修改，程序拒绝覆盖，需核对变化；确实属于新事件时再使用新的事件 ID。不要把 `install-log.json` 中的安装 `success` 当作结晶或同步完成。

Git 阶段只提交本次产物清单和必要的密钥忽略规则；遇到无关预暂存内容会拒绝提交并保留暂存状态。子仓库先推送，成功后才推父仓库。没有新提交时仍可续推。CLI 的 Git 失败返回非零并显示 `incomplete`；`--skip-push` 仍表示本地提交完成后跳过推送。

修复任务只交付 U同步源码和运行包；不会自动续推历史 Crawl4AI 工作区，也不会把设备同步开发分支整体并入主分支。

# 荣耀 d076fff 复验回传（RY-01）

验证源码：`d076fff50b142b4d09a2fbee9b0b8882b1554b96`。本轮仅整理此前独立执行的结果，没有重跑、改变或扩大原验收结论。

**两项修复在荣耀通过；完整迁移未完成。** 定向 10/10、全量 419/419（隔离用户环境），新 config/rules/memories 快照 98 文件、0 个 Git 元数据文件；完整快照仍被阻断。

## 可跨机核对的证据

- [原复验报告的脱敏副本](RESULT.md)：保留原文事实及“当时仅本地保存”的历史描述；本目录是后续回传。
- [定向日志](focused.log)：`node --import tsx --test test/offline-workspace-copy.test.ts test/codex-profile.test.ts`，退出 0，10/10。
- [全量日志](full-tests.log)：`npm test`（含 pretest 构建），退出 0，419/419，0 跳过；子进程临时 HOME / USERPROFILE / CODEX_HOME。
- [依赖安装日志](npm-ci.log)：独立 checkout 的 `npm ci` 退出 0。日志中的依赖审计提示未删改，本轮未升级依赖。
- [新快照结果](profile-result.json)：部分成功、完整失败；没有上传快照文件或 manifest。
- [受检状态摘要](protected-state-summary.json)：比较原本机两份摘要，前后均221个受检文件、变化0；该计数含原目录 Git 内部文件，不能当作98个可迁移文件计数。
- [完整快照阻断清单](full-snapshot-blockers.txt)：逐处上下文及链接分析由 [RY-02](../honor-2026-09-11-scan-analysis/README.md) 补充。

完整前后文件路径/摘要列表、个人快照和原始报告保留荣耀本机，未上传。报告中的本地路径统一替换 `%HONOR_USERPROFILE%`，不能在惠普照搬。摘要一致仅针对报告明确的采集时段与范围，不证明整个机器或所有时间段零变化。

本目录文件使用 LF 且 Git 不转换字节；SHA256SUMS.txt 校验脱敏发布副本。公开副本经过路径和常见令牌模式检查，不包含个人记忆正文。该检查不等于对任意未来材料的安全保证。

尚未完成：完整 Skill 采集、插件与 Severin 联动安装/宿主加载、真实资料恢复、私有仓库实际往返、双向交接、项目依赖重建和大文件迁移。文档提交不改变已验证源码 SHA。

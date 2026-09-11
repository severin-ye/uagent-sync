# d076fff 荣耀独立目录复验

结论：本轮两项修复通过荣耀复验，完整迁移仍未完成。执行主机用户目录为 %HONOR_USERPROFILE%，不是惠普。

## 验证对象

- 仓库分支：codex/device-sync-validation。
- 用户指定且实际检出的提交：d076fff50b142b4d09a2fbee9b0b8882b1554b96。
- 克隆时远端最新：d2583a49221784423fa81bfd77da47445e256d93，额外提交标题为 docs: record HP revalidation of d076fff fixes。本轮按用户指定 SHA 验证，未把新报告当成本轮执行结果。
- 独立 checkout：%HONOR_USERPROFILE%\AppData\Local\Temp\uagent-recheck-9d7ca348-e488-4c20-839a-e3e93fe47009\source。
- 已读取该 checkout 的 docs/DEVICE-SYNC-ACCEPTANCE.md 首轮反馈后的修复与复验。

## 执行结果

| 检查 | 结果 | 证据 |
|---|---|---|
| npm ci | PASS，退出0 | npm-ci.log |
| 中文路径复制/续传/覆盖保护，Git元数据排除及旧快照拒绝 | PASS，10/10，退出0 | focused.log |
| npm test（含pretest构建） | PASS，419/419，0失败、0跳过，退出0 | full-tests.log |
| 真实配置/规则/记忆重新采集 | PASS，98文件，0个.git文件 | profile-result.json |
| 默认完整快照 | FAIL，82份扫描报告、1处链接问题 | full-snapshot-blockers.txt |
| 采集前后真实受检文件摘要 | 相同，changedProtectedPaths为空 | protected-before.json、protected-after.json |

完整测试运行在子进程临时 HOME、USERPROFILE、CODEX_HOME 中，结束后恢复环境变量；未在真实用户目录重跑全套测试。npm test 的构建编译通过，本轮未额外重复单独typecheck命令。

真实文件摘要检查覆盖config.toml、AGENTS.md、rules、memories；比较区间为2026-09-11 12:44:46至12:44:49 UTC的快照采集，不声称对整个办公目录或所有后台时段证明零变化。本轮没有向真实配置/记忆执行restore，没有安装新版插件、改写安装缓存或上传个人快照。

新部分快照位于独立目录的 fresh-profile；默认完整快照采集失败。没有复用之前含.git的快照，未放宽扫描。构建后git status曾标记src/dashboard/i18n.js，普通git diff无文本变化，保留原状；没有修改被验收源码或测试。

## 尚未完成

完整Skill采集、插件及Severin联动实际安装与宿主加载、荣耀真实资料到惠普恢复、GitHub配置往返和真实双向同步、大文件迁移、项目依赖重建仍未完成。本轮不重新判断惠普旧报告中的记忆变化来源。

本报告与日志仅本地保存，未提交或上传。修复通过不能等同于完整办公环境同步可用。

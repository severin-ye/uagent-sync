# Codex 插件同步 2.3.0 验收记录

日期：2026-10-03。基线：`25b68d714317733482784cbc43c2c498d624801c`（2.2.2）。设计依据：[插件同步设计](CODEX-PLUGIN-SYNC-DESIGN.md)，用户操作见[设备同步用法](DEVICE-SYNC-USAGE.md)。

## 已实现的行为

已有 `export/push → pull/setup → verify` 流程保存真实安装版本、完整市场标识、安装文件内容与摘要，并区分未安装的源码定制。恢复通过 Codex 官方安装器，再用新鲜清单、安装缓存和新的 app-server 核验版本、启停、内容及 Skill 发现。来源无法安全归档时保留有效安装快照并报告 partial。

同版本目标修改或来源冲突拒绝覆盖；未登记的其他版本缓存、目录链接、悬空链接也在安装前拒绝。跨版本回退副本仅留本机，不作为安全导出结果；官方安装器可能清理旧缓存，回退依靠备份。宿主管理插件只做只读核验。安装失败和宿主加载失败不记作恢复成功。

## 验收证据

| 检查 | 实际结果 | 证据范围 |
|---|---|---|
| 最终全量 `npm test` | 972/972，通过，88 个 suite | 包含旧状态兼容、身份、内容、安全、恢复及生产包消费者测试 |
| 类型检查与构建 | 通过 | `npm run typecheck` 与最终 npm pack 的 prepack build |
| 定向插件测试 | 21/21，通过 | 源码/安装区分、凭据扫描、跨版本回退、缓存冲突、链接防护、宿主管理只读 |
| 真实 Codex 双 home | 2/2，通过 | Codex CLI 0.157.0；实际安装、fresh app-server、定制内容、往返、禁用、重复恢复、冲突拒绝和同市场多插件 |
| 最终生产包 | 359 个打包文件；加入匹配锁文件后采集 360 个文件、5 个 Skill | 独立生产目录 `npm ci --omit=dev --ignore-scripts --engine-strict`，34 个依赖包 |
| 本机正式插件 | 2.3.0，enabled=true，安装/版本/启停/内容/Skill 均通过 | 官方安装器与新鲜宿主验收；原配置字节、市场来源身份不变 |
| 本机正式 CLI | 2.3.0；359 个包文件字节匹配 | 最终包安装；`export --help` 不改变当前已保存工作区状态 |
| 本地回退副本 | 1,721 个受检旧文件摘要一致，另保留升级前完整副本 | 回退源码排除 Git/依赖/可再生缓存；有锁依赖可重建，不能承诺任意无锁旧依赖完整恢复 |
| 文档检查 | 未发现所检链接与路径问题 | 检查器不解析 collapsed/shortcut reference links |

最终 tarball SHA256：`4b3daa0c5ad7cd50aa4dbce98a53387232b0a6443c137571ac80296f59237ce8`。版本元数据在 package、锁文件、Codex/Claude 插件和 DSH wrapper 中一致。

独立源码审查发现的字面量凭据绕过、损坏源 manifest、首次安装目录链接越界均已修复并重验；宿主管理只读保护也经过独立复查。GitNexus 索引早于新增辅助文件，影响结果存在 UNKNOWN，部分旧行号映射不完整；不能将它作为全部调用路径已覆盖的证明，实际差异审查、全量回归与真实宿主验收补充此缺口。

保留的本地日志包括 `usync-plugin-delivery-suite.log`、`usync-plugin-final-host.log`、`production-install-delivery.log`、`formal-plugin-delivery.log`、`acceptance.json`、`cli-acceptance.json` 和 `rollback-verification.json`。它们包含本机运行信息，未作为公共源码提交。

## 尚未证明的范围

- 第二台实体电脑的实际安装、配置、项目及完整办公环境迁移：**Not Run**。双 home 验收不能替代两台真实电脑验收。
- Hook 执行、用户信任、MCP 登录与任意插件业务调用：**未验证**。Skill 发现不证明全部业务流程可运行。
- 当前已开启对话的热更新：**未验证**；验收使用新进程。
- 凭据扫描为启发式检查，不能证明任意代码无秘密；原扫描器的部分 backtick 赋值盲区仍存在，未扩大为绝对安全保证。
- 个人配置、规则、记忆仍由 device profile 流程负责；项目文件及离线大文件按已有工作区/搬运流程处理。没有新增登录、会话或活动数据库复制。

源码、设计、测试和公开使用说明进入本次任务提交；运行快照、回退目录、个人数据及用户原开发目录的未提交成果不进入公共提交。

## Git 交付

- 实现提交：[0c074285d669552244443124c1c273b192ea51f0](https://github.com/severin-ye/uagent-sync/commit/0c074285d669552244443124c1c273b192ea51f0)，含 30 个本任务文件；完整文件清单和差异均在该提交中。
- 任务分支 `codex/codex-plugin-sync`，主分支 `master`，原有远端 `https://github.com/severin-ye/uagent-sync.git`。实现提交已 fast-forward 整合并推送，`git ls-remote origin refs/heads/master` 核对完整 SHA 一致。
- 主分支内容与已验收提交相同，没有额外合并差异。原用户开发分支与未提交文件保持在原目录。
- GitNexus 暂存分析列出 34 个变动符号、27 条影响流程，风险为 critical；旧索引的行号映射和新增符号覆盖有限，按实际差异及前述测试/审查完成验收，不把工具等级当作已证明无回归。
- 现有看板的交付回执已获服务器队列确认，实际卡片写回尚未确认；未推断用户接受或完成验收。
- 本次未执行 npm registry 发布；交付为 GitHub 源码、经过核验的本地最终包及本机安装。

# 发布手册

## 版本依据

比较最近一次**实际发布**的 npm tarball 与当前候选，不把源码版本或本地安装版本当作已发布基线。适用的 Severin 发布契约按 X → Y → Z 判断：重大独立能力、核心执行/验收/交付责任变化、架构替换、破坏支持兼容或要求迁移升 X；现有能力内的小功能升 Y；恢复既有承诺的修复升 Z。一批按最高级别只升一次，已发布版本不能覆盖。

2026-11-01 的实际 npm 基线是两个包的 2.1.0。3.0.0 的判级与验收边界见 [发布记录](docs/validation/release-3.0.0.md) 和 CHANGELOG。历史候选日志原样保留，不补造发布历史。

## 双包发布

根包 `uagent-sync` 提供 CLI/OpenCode 入口；`packages/dsh` 的 `uagent-sync-dsh` 提供 DSH bundle。根 package.json 是版本权威源，以下派生字段必须相同：

- package-lock.json 的顶层 version 和 packages[""].version。
- packages/dsh/package.json 的 version 与 dependencies.uagent-sync，后者使用精确版本。
- .codex-plugin/plugin.json 的 version 与 .claude-plugin/marketplace.json 的插件 version。
- 本次 CHANGELOG 入口、文档安装示例和 tarball 文件名。

本仓库没有 `version:sync` 或 `version:check` 脚本，不假称已执行。已有 `release:patch|minor|major` 会立即推送标签，不能用于候选准备或代替双包同步。

## 准备和检查

1. 在独立任务 worktree 固定实际 origin/master，检查本次差异和 npm 已发布基线。
2. 更新根版本和 CHANGELOG 的判级依据，再同步上述派生项。
3. `npm ci`；运行项目要求的 `npm test`（含 build），以及受影响的 typecheck、浏览器检查。无新实现或环境变化时复用已有适用证据，不重复全套测试以增加数字。
4. 用 `npm pack --pack-destination <私有产物目录> --json` 构建根 tarball；在 packages/dsh 使用相同命令构建 bundle。检查**实际产物**的文件清单、权限、凭据/运行数据排除、版本与 SHA-256，不能只引用旧 dry-run。
5. 在隔离 private 消费者目录、独立 npm prefix/cache/config 与唯一 DSH Profile 验证。禁止以源码 link 或覆写依赖的 fixture 冒充正式 registry 分发验收。精确 CLI 依赖未发布时，先保留待发布包与摘要，由获授权的发布者处理；发布后从 registry 重验。
6. 提交本次增量；整合主分支和推送由协调者完成。标签与 GitHub Release 应绑定实际交付提交，并附加两个已核验的 tarball 及摘要。

## 正式 npm 发布

只使用已完成审阅的精确 tarball，先根包后 bundle：

```powershell
npm publish <artifact-dir>/uagent-sync-<version>.tgz
npm view uagent-sync@<version> version dist.integrity --json
npm publish <artifact-dir>/uagent-sync-dsh-<version>.tgz
npm view uagent-sync-dsh@<version> version dependencies.uagent-sync dist.integrity --json
```

发布者还须核验 dist-tags 和实际下载包的完整性。不得打印 npm token、覆盖旧版本或把包已上传等同于安装/启动验收完成。

## 消费方和真实验收

```powershell
npm install --global --prefix <isolated-prefix> uagent-sync@<version>
<isolated-prefix>/uagent-sync.cmd --version
<isolated-prefix>/uagent-sync.cmd --help
dsh plugin --profile <disposable-profile> add uagent-sync-dsh@<version>
```

包已包含 dist，消费者无需源码构建。每个精确 DSH 版本分别记录安装、配置组合、启动、16 个工具和 3 个桥接 Skills 的注册、受控无私人数据工具调用、卸载与版本回退。宿主启动帮助、服务注册和实际模型/备份行为是不同证据；不调用模型或私人备份时明确记录。

`engines.dsh` 的范围匹配不代表精确 `dshReleases: compatible`。固定分发物生命周期证据、供应链/权限审阅和商城准入分别记录；不由作者自审推断商城已接收或可安装。

## 卸载与回退

先保存隔离 Profile 配置及原版本身份，再使用宿主 `plugin remove`，核验 dependency、bundle、patch 与运行注册均已移除。回退使用精确旧包版本重新安装，核验实际加载和 CLI 身份；正式用户配置/注册表/备份仓库不用于测试，也不清空。npm 旧版本保留；不为回退删除历史 Release 或篡改已发布产物。

源码回退通过常规 revert 和新提交交付，不强推。发布及 registry 验收尚未完成时，报告包已准备与剩余步骤，不称正式发布完成。

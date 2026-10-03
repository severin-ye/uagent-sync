# 多设备同步：当前可运行入口

本文保留历史设备验收范围；本次 2.3.0 在既有设备和工作区流程中加入 Codex 插件固定内容恢复与实际安装验收。各机须分别确认实际安装来源与 CLI 版本，不能由源码版本推定已经升级。源码运行时执行 `npm run build`，以下 `uagent-sync` 用 `node <源码绝对路径>/dist/cli.js` 代替。

## 设备配置

设备资料独立保存在指定配置仓库 `sync/devices/<id>.json`；本机连接默认是 `~/.codex/uagent-device.json`。该连接不进入快照，避免覆盖另一台的身份。配置仓库应是本机已有 checkout，支持复用私有 dotfiles 仓库。

```powershell
uagent-sync device register --registry <配置仓库本地目录> --remote <私有GitHub仓库HTTPS地址> --name <设备别名> --workspace-id main --workspace-root <本机工作区>
uagent-sync device list
uagent-sync device show <设备ID或别名>
uagent-sync device rename --name <新别名>
uagent-sync device reconnect --registry <新配置仓库本地目录> --remote <新仓库HTTPS地址>
```

每台设备在自己机器上 register，重复执行保留身份。可用 `--connection <文件>` 指定独立连接文件；用户目录与 Codex 目录可用 `--user-home`、`--codex-home` 显式指定。多个工作区通过登记接口的 `workspaces` 管理，CLI 使用 `--workspace-id` 选择已登记项。当前平台首轮实测为 Windows。

## 覆盖清单与离线搬运

```powershell
uagent-sync device audit --output <不存在的报告JSON路径>
powershell.exe -NoProfile -File <源码目录>/scripts/copy-offline-workspace.ps1 -ReportPath <报告JSON> -TargetRoot <移动硬盘或共享目录中的暂存目录>
```

audit 只读取文件元数据和 Git 状态，不读取办公资料内容。报告涵盖普通文件、依赖、未跟踪/忽略文件、大文件、链接与失败项。Git 内部对象不计入文件体积，链接不跟随；仓库检测失败也会报告。`readyForGitOnlyTransfer=false` 不表示扫描失败，表示不能仅凭普通 Git 完整迁移。

`transferFiles` 列出大文件和未跟踪/忽略文件，**不包含**依赖重建目录、识别为凭据的文件、链接和 Git 内部对象，因此不是全环境备份清单。源内容变更后应重新 audit。

搬运脚本默认仅预览；追加 `-Apply` 才复制。目标必须是新空暂存目录，或者属于同一报告的可续传目录。逐文件校验 SHA256，拒绝覆盖不同内容，不向运行中的惠普工作区直接覆盖。它只生成离线暂存副本，不代表已完成目标机项目合并或环境重建。

## Codex 个人文件快照

```powershell
uagent-sync device snapshot
uagent-sync device snapshot --components config,rules,memories --output <新的快照目录>
uagent-sync device restore --snapshot <快照目录>
uagent-sync device restore --snapshot <快照目录> --apply
```

默认采集配置、规则、记忆及本地 Skill 文件。可通过 `--components config,rules,skills,memories` 明确选择；未选择项会记录为排除，不能据此宣称全部迁移。snapshot 不覆盖已有快照目录，输出包含内容摘要和未覆盖项。

所有层级的 `.git` 目录与 Git worktree 指针均排除并记录；旧快照若含这些条目，恢复会拒绝，必须重新采集。文件计数不能把 Git 内部文件算作个人配置或记忆。

restore 默认只预览。无基线且目标内容不同会冲突；首次用户明确指定以源机为准时，可追加 `--prefer-source --apply`，会先备份原文件。后续源与目标均改动时阻断覆盖，仅本地改变而源未变则保留本地。源删除的文件暂不自动删除，会报告保留项。备份和基线位于目标 Codex 目录的 `uagent-device-state/`。

路径转换用于受支持的 TOML 配置；文档和记忆原文不替换。现有目标配置中的机器专属内容保留。登录、宿主信任、sessions/SQLite、自动化、插件缓存和运行状态不复制。插件配置条目写入不代表插件已经安装；插件内容恢复使用下面的 Codex 工作区备份/恢复入口。

## Codex 插件内容备份与恢复（2.3.0）

设备个人文件快照仍负责配置、规则、记忆和独立 Skill。插件在已有工作区 `export/push → pull/setup → verify` 流程中处理，使用同一 `usync-dotfiles/state/workspace-state.json`，无需另一套设备登记。

```powershell
# 源机：先导出到工作区状态文件并检查 completeness / snapshotError
uagent-sync export --target-agent codex --json
# 已登记私有工作区可用 push 导出并传输
uagent-sync push --target-agent codex --json
# 目标机：拉取状态；setup 实际安装并验收选定插件
uagent-sync pull --target-agent codex --json
uagent-sync setup --target-agent codex --json
uagent-sync verify --target-agent codex --json
```

清单从真实 `codex plugin list` 获得完整插件标识与安装版本，保存安装文件摘要和内容；可访问的源码副本单独归档，避免把未安装的源码修改当成已运行内容。恢复后核对版本、启用状态、文件摘要及新 Codex 进程的 Skill 发现。目标端同版本内容存在未接受的修改时拒绝覆盖，旧缓存和受控备份保留回退条件。

独立源码不安全、不可访问或清单损坏时，有效安装快照仍可保存和恢复，但导出标为 partial，并列出未归档源码；不能把这项缺口当作备份完成。安装内容本身不安全或损坏时继续拒绝，不使用源码降级来绕过检查。

跨版本升级前做仅留本机的回退源码副本，旧内容不能安全导出时仍可安装经过检查的新内容；回退副本不作为可上传快照。Codex 安装器可能清理旧版本目录，回退使用备份。依赖和可再生缓存不复制，有锁文件的运行依赖可按锁重建；无锁文件时不能保证依赖回退完整。目标版本的缓存目录若已有内容但未被登记，也会拒绝覆盖。

快照拒绝已检测到的凭据、链接、路径逃逸、大小超限与损坏内容；`.git`、`node_modules` 排除。扫描是启发式检查，不能证明任意代码均无凭据。生产依赖按锁文件安装且禁用安装脚本，无法安全重建时报告错误。旧状态没有内容快照时仍可按来源恢复，但会明确报告未校验精确内容。个人本地市场可以恢复，官方宿主管理组件仍保留宿主边界。

Hook 信任、MCP 登录和业务调用需要目标机自己的验收；不会复制登录或自动批准信任。禁用插件保持禁用，因此不会声称已加载。`device restore` 单独完成不等于插件内容已恢复，也不等于完整办公环境迁移完成。详细规则见 [插件同步设计](CODEX-PLUGIN-SYNC-DESIGN.md)。

早期221文件恢复与82文件扫描阻断属于历史阶段。固定公开来源文件随后已完成精确核验及受控恢复，后续资料接收另有回执；这些结论只适用于受检固定内容，不自动放行未来修改。完整环境仍需项目、依赖、安装、信任与实际使用验收，不能整体关闭扫描。

## 配置仓库传输

```powershell
uagent-sync device publish --path sync/devices/<本机ID>.json --path sync/profiles/<本机ID>/<快照目录名>
uagent-sync device fetch
```

publish 只接受显式设备/快照目录，检查 origin 与连接一致、GitHub PRIVATE、候选文件密钥规则、已有暂存改动和远端分叉。它不会提交工作区所有项目，不会强推；失败可能保留尚未推送的本地提交，必须检查 Git 状态后处理。fetch 要求配置仓库干净，使用 fast-forward。

正式Git传输、隔离恢复和冲突拒绝已有两机批次证据；仍应对每个新快照按当前规则核对。密钥检查是启发式检查，不是任意文件均可安全上传的证明。不要把未来生成的快照目录与之前已审查目录混为一谈。

## Severin 联动与完成边界

U同步提供 `uagent-sync-device` Skill；Severin 的 Agent 运维 Skill 按需调用设备交接工作流。两者共用 U同步设备表，不写死别名、路径或仓库地址。惠普固定设备包已被新宿主发现；各机统一版本安装、信任和加载仍须分别确认，不能由源码或打包结果推定。

完整完成仍需：处理 Skill 采集阻断、发布/安装新版本、传输项目与离线文件、在真实目标机恢复、安装与运行验证、双向回传。历史对话继续作为可选项。

## 已核验公开Skill源码的精确复核入口

2026-09-14新增 `scripts/verified-public-profile.mjs`。它使用随应用代码维护的 `data/reviewed-public-skills.json`，从三个公开仓库独立获取固定blob，并验证SHA256；不读取快照内的允许名单或从待扫描内容生成规则。仅当逻辑Skill路径和完整字节完全匹配时，原扫描命中由该公开来源复核解决。变更、新文件、策略失败继续原扫描；普通 `device snapshot` 不会自动开启此机制。

```powershell
node <源码或安装包>/scripts/verified-public-profile.mjs check --home <用户目录> --codex-home <Codex目录> --workspace-root <工作区> --cache <新的绝对缓存目录> --report <新的绝对报告路径>
```

同样参数支持 `snapshot --snapshot <新快照目录>`、`restore-preview --snapshot <快照目录>`；`restore-copy`只允许不存在的新用户目标目录，Codex和workspace路径必须在其中，不覆盖真实办公目录。每次缓存与报告使用新目录/文件。报告可能含本地路径，不直接上传。清单没有该设备上的文件会明确报告缺失；这不是私密凭据识别结果。

本次82历史文件（约定范围，非所有用户文件）在荣耀本地副本全部通过且恢复摘要一致。其余文件、链接、插件安装及两机往返仍各自验收；该入口不会修复缺失链接目标，不复制宿主信任或登录。

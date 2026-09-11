# 荣耀 M0 独立复核通过（含首轮环境失败记录）

交接输入：31c849a563b78f3edaa988f1531884a912d98422。
**独立验证源码：11237d974ce42f3377cf06faf01e351b8f20cc3d。** 只标记荣耀M0复核通过；完整采集、迁移尚未完成。

## 实际执行

全新本地clone使用--no-hardlinks --no-checkout，随后detached checkout固定SHA；未使用主工作树构建。所有执行命令、时间及退出码见[commands.json](commands.json)，隔离目录映射见[isolated-environment.json](isolated-environment.json)。原日志留本机，公开副本替换用户路径及token形态值，原始日志摘要见raw-log-manifest.json。

| 检查 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 依赖准备 | npm ci --ignore-scripts --no-audit --no-fund | 0 | 仅独立源码依赖，不是设备插件安装 |
| 构建 | npm run build | 0 | [构建日志](build.log) |
| M0定向 | node --import tsx --test test/secret-scan-m0.test.ts | 0 | [14/14](focused.log) |
| 首轮全量 | npm test | 1 | [422/433，11失败](first-full-failed.log)，保留失败 |
| 环境修正后失败组 | node --import tsx --test，五文件完整参数见commands | 0 | [79/79](recovery-focused.log) |
| 环境修正后全量 | npm test（含pretest构建） | 0 | [433/433，85 suites](full.log)，失败/跳过/取消0 |

初始同时设置UAGENT_SYNC_WORKSPACE_ROOT和OPENCODE_SYNC_WORKSPACE_ROOT为clone。前者优先，阻止既有测试在子进程内通过后者切换到人工fixture，造成11个错误断言。这是主对话隔离设定冲突。仅取消UAGENT变量后，五个失败文件及完整回归通过，未改源码或测试。

USERPROFILE/HOME、APPDATA/LOCALAPPDATA、CODEX_HOME、XDG_CONFIG_HOME、TMP/TEMP及npm配置/缓存均在全新隔离目录；OPENCODE仍指向clone。子进程测试自行覆盖到各自临时fixture。没有真实采集或恢复，没有安装运行中的插件，没有读写真实配置、记忆或链接。打包测试的临时安装不等于设备插件安装。

## 源码及保护审查

[REVIEW.md](REVIEW.md)记录逐入口拒绝顺序、边界、原始行号及限制。修复提交仅基础扫描器一行行为变更与新增测试；与交接HEAD的src/test/scripts/package及lock差异为空。M1/M3未夹带。

独立clone最终git diff --quiet退出0，内容diff为空；git status仍标记src/dashboard/i18n.js，伴有换行提示，属于构建后的状态现象。没有将其提交或声称状态完全clean。主仓只提交本报告与荣耀复核记录，未改生产源码。

CRITICAL是惠普上游影响分析结论，本轮已核对报告并以源码和运行结果审查调用者；荣耀本地图索引缺profile边，已明确限制，不冒称重新完成完整影响图。

## 下一轮

交惠普按已收敛CURRENT-PLAN及TEST-DESIGN-V2启动HP-03-M13-R→F→V：仅完整环境/参数引用与精确占位符候选；先红后绿、保留跨行非空回退/拼接、边界和原始行号拒绝保护，必要回归与npm test通过后独立提交，交荣耀复核。无法安全证明的候选保留阻断，不为凑16项扩大允许范围。**本轮未启动M1/M3。**

RY-03继续阻断，无新证据不重搜或替换。M2、未知项、完整新快照、插件与Severin联动安装、真实恢复、私有GitHub往返、双向同步和大文件迁移仍未完成。M0通过只证明本次修复范围。

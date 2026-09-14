# 荣耀集中收尾：Node18兼容与生产依赖消费者

基线交接：38c3dbbc0e2c5c50654c62aee77550b16181d0c2。该基线包含已验证M2空白修复57b852f，本轮不改扫描器、不读真实模板、不重扫真实文件、不操作真实链接/采集/安装/恢复/发布快照。

独立修复源码：`ce6780faa0995c3c3587658aa46a161b4b5e4bcf`。

## 本轮改动

1. 三个生产位置（插件skills路径、dashboard资源、已知MCP数据）及既有测试用Node18兼容的fileURLToPath(import.meta.url)与dirname定位资源，保持原路径语义。
2. 已锁定的@opencode-ai/plugin 1.18.15从开发依赖移为运行时依赖，修复omit-dev安装无法加载包主入口。锁文件包版本无新增、删除或升级，仅依赖用途标记改变。
3. 打包消费者先建立private package.json再明确prefix安装，新增真实import与插件config调用；新增两项运行路径回归，覆盖数据后备查找、skills定位与幂等性。
4. [收尾清单](../../DEVICE-SYNC-CLOSEOUT.md)和[开发规则](../../DEVELOPMENT-WORKFLOW.md)明确先做完本机可做工作，再交接真正依赖另一端的任务。

本批是开发分支修复及验收，不发布新版本，不改变真实宿主安装。不能把隔离npm安装与config调用冒充OpenCode/Codex宿主实际加载。

## 红态与验证

- Node18新运行路径测试修复前2项全部失败，原因是路径参数undefined；修复后2项通过。
- 新增omit-dev入口测试修复前因缺@opencode-ai/plugin失败，原两个打包测试通过；日志保留。
- 当前Node全量855/855。Node18全量同样855/855、0失败、0取消；两份完整日志与退出码保留。
- 完整npm test包含构建、原M2回归、dashboard服务资源、CLI、打包生产依赖消费者；不重复已通过的旧原型或无变化消费者矩阵。
- GitNexus对loadKnownMcps报告HIGH：3个直接依赖、7个受影响符号；startDashboardServer为LOW，插件入口为LOW。按实际路径和完整回归验证，索引不代替运行证据。测试文件不在当前索引，不能将索引缺项当作无影响。

## 隔离与复验

证据目录含实际执行run.mjs（路径已脱敏）及通用replay.mjs。通用脚本参数依次为源码目录、证据目录、Node可执行路径、唯一标签和该Node参数的JSON数组。标签必须新建，源码必须有package.json。它隔离HOME/USERPROFILE、应用、Codex、XDG、TMP/TEMP/TMPDIR和npm配置/缓存，清除顶层工作区变量与NODE_PATH/NODE_OPTIONS，并正确处理Windows Path大小写。公开只保留必要环境字段；原始环境日志本机保留。

惠普先在短路径checkout固定独立源码，再运行类似命令（用真实本机路径替换尖括号；不复制为PowerShell可执行占位符）：

    node replay.mjs <源码目录> <证据目录> <Node绝对路径> ci <npm-cli.js及ci/--prefix参数JSON>
    node replay.mjs <源码目录> <证据目录> <当前Node路径> full-current <该Node的npm-cli.js及test/--prefix参数JSON>
    node replay.mjs <源码目录> <证据目录> <Node18路径> full-node18 <Node18的npm-cli.js及test/--prefix参数JSON>

命令参数具体格式见*-commands.json。不要使用脱敏别名直接执行。每个子命令status分别判断，wrapper完成不等于子命令成功。两个全量串行执行，避免共享dist打包/清理冲突。消费者根祖先不得有宿主SDK污染；正常生产依赖自身包含SDK不属于污染。

## 剩余与下一批

惠普一次完成最终SHA的双Node独立验收和其npm用户目录事件的已有证据核对，再集中回传。未知旧状态不删除、不重建；若缺必要备份，写出最小缺失输入。真实M2四处、HP-006、HP-022/023、172未知项、RY-03与历史记忆变化继续保持阻断。真实模板和真实迁移步骤须明确受控范围及必要输入；本轮不自动启动。

子代理仅草拟清单，曾写入原工作区且沿用旧M2状态；主协调者已复制到独立交付目录并按最新证据重写，未采纳其过时结论。原工作区草稿不作为交付依据。历史m2_replay仍pending_init，本轮未依赖或声称回收它。

入口：惠普可用本目录run-batch.ps1一次执行隔离安装与双Node完整验收；每个输出目录必须新建。replay.mjs仅用--version验证过通用参数入口，实际两次全量使用run.mjs，同一隔离逻辑；不将脚本存在当成惠普已运行。

run-batch.ps1已通过PowerShell语法检查，未重复端到端运行；通用replay.mjs的--version烟测退出0。源码已使用实际run.mjs完成双运行时全量，不将包装脚本语法检查当作再次运行验收。

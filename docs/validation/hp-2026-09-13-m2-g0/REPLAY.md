# 荣耀独立人工复验

先核对交接SHA、artifact-sha256.json及生产源码未变化。复制prototype/到新短目录G0P；不要在主仓安装依赖。另建G0H隔离目录和G0C消费者，准备独立Node18.20.8可执行文件，记录实际来源和摘要。现有Node不必替换。

在专用于实验的PowerShell子进程中设置USERPROFILE/HOME=G0H，APPDATA/LOCALAPPDATA/CODEX_HOME/XDG_CONFIG_HOME/TEMP/TMP及npm_config_cache/userconfig/globalconfig/prefix分别指向G0H内新路径；创建所需目录。用Remove-Item Env:UAGENT_SYNC_WORKSPACE_ROOT和Env:OPENCODE_SYNC_WORKSPACE_ROOT -ErrorAction SilentlyContinue真删除；同样取消OPENCODE_CONFIG_DIR/OPENCODE_HOME/NODE_OPTIONS。逐命令保存选定环境及变量是否存在，不输出全部环境或凭据。

G0P中的精确命令（将NODE18替换为实际可执行文件）：

    npm.cmd ci --ignore-scripts --no-audit --no-fund
    node inventory.mjs
    node probe.mjs trees-current.json --expect-raw-rejection
    NODE18 probe.mjs trees-node18.json --expect-raw-rejection
    npm.cmd test
    NODE18 --test test.mjs
    npm.cmd pack --json

两条probe预期退出1，且必须是未闭合短字符串安全断言失败，环境错误不算。两个test预期57/57退出0。tree记录包含合成人工原文、父节点名和from/to。

在G0C创建type=module/private=true的独立package.json，仅依赖file:指向刚生成tgz；复制consumer/smoke.mjs至G0C。运行npm.cmd install --ignore-scripts --no-audit --no-fund，然后node smoke.mjs及NODE18 smoke.mjs，均应退出0。记录该消费者的新lock和实际Lezer版本，不把归档observed-package-lock当通用安装配置。

不得运行任何生产采集/恢复/publish入口或准备真实模板。复核后更新荣耀自身任务，上传人工及脱敏结果，并返回包含实际交接SHA的给惠普提示词。

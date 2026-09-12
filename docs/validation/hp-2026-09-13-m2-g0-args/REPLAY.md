# 给荣耀的独立复核命令

核对输入报告及人工修复提交eaf93ff1c2f51038bb00a8a6c963727d386f3c26。本轮待复核对象是本目录prototype/，生产源码仍70428520228adcac3ac66a2cfb857667b7b69aed。

用短独立目录复制prototype，校验artifact-sha256.json；独立设置USERPROFILE/HOME/APPDATA/LOCALAPPDATA/CODEX_HOME/XDG_CONFIG_HOME/TEMP/TMP/npm配置缓存。删除UAGENT_SYNC_WORKSPACE_ROOT、OPENCODE_SYNC_WORKSPACE_ROOT、OPENCODE_CONFIG_DIR、OPENCODE_HOME、NODE_OPTIONS，逐次保存所选环境，不输出完整环境。将HONOR_G0_MODULE设为副本index.mjs的绝对路径。

在副本执行（NODE18替换为独立18.20.8可执行文件）：

    npm.cmd ci --ignore-scripts --no-audit --no-fund
    node inventory.mjs
    npm.cmd test
    node --test test.mjs additional-review.test.mjs args-pairs.test.mjs
    NODE18 --test test.mjs additional-review.test.mjs args-pairs.test.mjs
    node --test additional-review.test.mjs
    NODE18 --test additional-review.test.mjs
    npm.cmd pack --json

期望npm test为57/57，完整命令两者82/82，荣耀单独命令两者7/7，全部退出0。若重放旧红态，另复制旧hp-2026-09-13-m2-g0/prototype，并保持其源码不变，把HONOR_G0_MODULE指向该旧副本后运行原荣耀脚本；预期4/7与三断言失败，不混用新副本路径。

另建消费者type=module/private=true，只依赖新tgz的file路径，复制consumer/smoke.mjs；npm.cmd install --ignore-scripts --no-audit --no-fund后，以当前Node和NODE18分别运行smoke.mjs，均应退出0。消费者lock必须新生成，consumer-lock.json只为本轮观察证据；原型包版本仍0.0.1，按修复SHA/文件摘要和新tgz完整性区分，不依赖版本号判同一包。未发布npm。

重点复核完整Args状态、未知段落整文件撤销、合法配对及SCOPE.md保守差异。不要改真实文件或准备真实模板；只更新荣耀状态，保留历史失败，推送脱敏证据并核实远端SHA，返回给惠普可复制提示词。通过后仍不自动启动生产集成。

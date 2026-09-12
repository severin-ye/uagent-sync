# 人工反例重放

在新短隔离根创建src子目录，固定待检源码；先有该源码package.json，再用明确`npm ci --prefix <src> --ignore-scripts`准备依赖。只在独立目录执行，不改真实用户目录。

把artificial中的honor-residual.mjs、honor-formfeed-gates.mjs和run-honor-probes.ps1复制到src的父目录。运行：

```powershell
& <隔离根>/run-honor-probes.ps1 -NodeExecutable <待测Node绝对路径> -Label <本次唯一标签>
```

wrapper读取同目录src，在新的probe标签目录创建人工用户/配置/TMP/npm路径，删除workspace变量及NODE_PATH/NODE_OPTIONS，记录实际Node子进程的缺失状态。两脚本退出码分别记录，wrapper本身退出0不代表反例通过。重复执行必须使用新标签，不覆盖旧人工产物。

416120af上的预期红态：每个Node纯内容24次检查16通过8失败；三入口配对6组4通过2失败。修复后应先让这批人工拒绝通过，再跑原115项及全量；不能仅删掉换页字符或改测试预期。JSON的source字段通过JSON解析后包含实际U+000C，不能把反斜杠和字母f两字符当作同一输入。

runtime脚本和日志含脱敏路径别名，不可不替换路径就执行。完整生产重放继续遵守惠普REPLAY：双运行时、Node18 npm与子进程同PATH；打包消费者先private manifest并明确prefix，祖先无宿主SDK，omit-dev与明确宿主两类分开。原始失败、惠普环境事件及真实数据阻断均保留。

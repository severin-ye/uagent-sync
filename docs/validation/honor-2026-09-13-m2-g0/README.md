# 荣耀 RY-15：G0独立复核未通过

**原57项和打包重放通过，但新增Args归属反例失败，不能进入生产集成。** 交接c25f06c441cf0dbd3345e0475ed6c3ecd4540760；生产源码仍70428520228adcac3ac66a2cfb857667b7b69aed，无生产改动。

| 验证 | 荣耀结果 |
|---|---|
| 标准人工测试 | 当前Node v24.16.0及Node v18.20.8各57/57，退出0；当前版本与惠普v24.19.0不同，分别实测不混称同版本 |
| strict风险probe | 两运行时退出1，明确是未闭合短字符串安全假设断言失败；shortBefore/shortAfter接受且无错误节点，不是环境错误 |
| 打包消费者 | 新独立消费者安装本轮tgz，两运行时import、允许、原始闭合弃权、缺模板弃权均退出0 |
| 荣耀附加7项 | 两运行时各4通过/3失败，退出1；LF/CRLF均出现同样Args归属问题 |
| 后置错误保护 | 后置语法、短字符串、非法参数能撤销；后置未知Args嵌套语境未撤销，错误返回2跨度 |

具体根因、边界和下一步见[REVIEW.md](REVIEW.md)，可重放人工反例见[additional-review.test.mjs](additional-review.test.mjs)及[run-extra.py.txt](run-extra.py.txt)。附加原始输出保存在荣耀私有实验目录，公开副本仅做路径脱敏。标准命令及摘要见[replay/summary.json](replay/summary.json)、[replay/commands.json](replay/commands.json)，逐命令环境见logs/；[additional-current.log](additional-current.log)及[additional-node18.log](additional-node18.log)保留新增失败。

原附件10/10摘要匹配，隔离复制9/9匹配（旧consumer lock只核对、不复用）。Node18官方ZIP与独立下载的SHASUMS256一致，来源见[replay/runtime-source.json](replay/runtime-source.json)。同一归档原型的代码未被修改。

读取并保留惠普旧provider初版2失败、参数gap 1失败日志；不将它们计入荣耀新红态。标准复制路径首轮失败后修正，以及汇总器误认reporter格式，属于本轮基础设施/汇总问题；未修改原型来迎合测试，真实测试日志57/57保持。

本轮仅人工数据和依赖实验，隔离用户/应用/Codex/TMP/npm且真正删除workspace变量，逐命令环境与退出码见重放材料。原型返回字段跨度不等于基础扫描拒绝或三入口无副作用通过；未运行生产npm test、真实入口或真实文件扫描。

下一轮建议惠普只修人工原型RY-G0-01，先保留荣耀反例红态，再有限修正Args状态，双运行时及打包回归后回传。既有更保守的顶层普通函数参数检查可以保留并注明。生产集成、真实模板、实际CLI/plugin兼容性仍未开始。

M2四项、HP-006、HP-022/023、172未知项、RY-03继续阻断。未读取或准备真实模板、不重扫真实文件、不搜索/替换链接、不采集/安装插件/恢复/发布快照。配置、记忆、原文、历史证据保持，HP-03/HP-04及环境迁移未完成；仅更新荣耀RY-15。

公开副本路径已脱敏，统一LF并去除行尾空白；首次diff检查曾因CR/日志行尾空白失败，格式整理后重验。私有原始输出及惠普历史材料不改，格式检查不是安全红测。

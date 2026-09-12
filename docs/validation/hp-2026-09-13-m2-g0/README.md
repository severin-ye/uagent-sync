# 惠普 HP-03-M2-G0：隔离人工原型

已完成本轮人工原型门槛，待荣耀独立复核；没有生产集成或真实M2放行。工作跨越2026-09-12/13，报告按完成日期归档。

输入交接：1e46e346579de0e9f8ee69b042cdffabb4c5ac42。生产验证对象仍为70428520228adcac3ac66a2cfb857667b7b69aed；src/test/scripts/package.json/package-lock.json相对该对象无差异。本轮原型仅作为本报告附件归档，不是独立生产修复。

## 实测结果

| 项目 | 结果与证据 |
|---|---|
| 固定依赖 | @lezer/python 1.1.18；common 1.5.2、lr 1.4.10、highlight 1.2.3，均MIT；实际lock/resolved/integrity见dependencies.json和prototype/package-lock.json，许可证见licenses/ |
| strict风险 | 两个运行时均接受候选前/后未闭合短字符串，无错误节点；安全假设断言退出1。见logs/risk-*.log、trees-*.json；未闭合三引号则strict抛错 |
| 原型初始失败 | provider初版47项45通过2失败：普通对象冒充模板、非JSON空白。后续增加私有WeakSet标记与JSON限定空白；原失败日志保留 |
| 参数附加失败 | 两运行时57项56通过1失败：直接树遍历遗漏未命名的/，导致不支持签名获得跨度。增加参数区间原文覆盖门槛后通过；见logs/signature-red-*.log |
| 最终人工测试 | Node v24.19.0及v18.20.8各57/57，退出0；见logs/final-*.log |
| 最终打包import | npm pack后装入另一独立消费者，两运行时import、精确允许、短字符串整文件弃权、缺模板弃权均退出0；见logs/pack-final.log及packed-final-*.log |
| Node18来源 | 官方win-x64压缩包与下载的官方SHASUMS256相符；runtime.json、logs/runtime-check.log；未全局安装或切换Node |

运行记录不是安全通过的一种计数：risk退出1是预期安全断言失败；prototype-initial和signature-red是原型自身的实际失败；最终57/57才是修正后人工测试。旧生产704/704与以往失败记录均保留，未重跑或改写它们。

原型只返回7个UTF16单元的字段名跨度，不执行掩码或基础扫描。邻接人工赋值原文处于跨度外；这不等于基础扫描拒绝它，更不等于三入口无副作用已验收。完整边界、保守差异及未执行项见PROTOTYPE-REVIEW.md。

## 隔离与复验

实际命令、cwd和退出码见commands.json；逐命令执行前环境见logs/*-pre-env.json。公开路径前缀统一替换为<LOCAL>，原日志仍在惠普本地。用户、应用、Codex、TMP及npm均隔离，两个顶层workspace变量是真删除，不是空值。

原型临时包与独立消费者之外，只在独立克隆生成本报告、共同清单和本地GitNexus索引。未读真实Skill或D正文；未准备私有模板；未修改生产依赖、扫描器、入口或实际工作区配置、记忆、链接。运行时下载和npm安装仅用于本轮独立人工实验，不是安装U同步插件。

荣耀复验请按REPLAY.md使用新的短目录，核对artifact-sha256.json。不要在主仓根安装原型依赖。检测结果与生产差异见change-check.json及detect-changes.json。

本报告目录的.gitattributes仅关闭证据文本换行转换，保留附件原始字节与摘要。GitNexus detect_changes退出0，仅报告清单2个文档符号、0条流程；它未把新增docs原型纳入完整调用图证明。另以Git路径差异确认生产目录/依赖未变化，人工附件逐文件审查；索引记录的流程截断不能用于声称生产影响全面覆盖。

首次diff --check提示日志自带行尾空白/CR；公开日志随后统一LF并移除行尾空白，runtime.json统一LF，再通过格式检查。仅公开副本进行路径脱敏和上述格式整理，本地原始日志不变；这属于证据格式检查，不是安全红测。prototype附件及锁文件的Git暂存字节已逐项对照artifact-sha256.json。

## 下一步

请荣耀执行RY-15人工G0独立复核：核对双运行时树形、原始闭合、参数缺口、provider合同及打包import；重点尝试候选后错误是否能泄漏早先跨度。明确判定原型合同和保守差异能否进入下一次集成范围讨论，本轮不自动授权实现。

M2四项、HP-006、HP-022/023、172未知来源、RY-03继续阻断。真实三入口、真实文件采集、CLI/plugin生产兼容、真实模板、插件安装、恢复、双向同步和大文件迁移均未执行；HP-03、HP-04和迁移不完成。未替荣耀填写状态。

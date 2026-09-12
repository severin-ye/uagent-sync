# 惠普 M1/M3 有限范围修复验收

**HP-03-M13-R/F/V 已在下述有限范围完成：实现11处候选对应的Python语法，另5处暂缓。最终定向56/56、隔离全量474/474通过；待荣耀独立复核，不代表真实采集或迁移完成。**

- 交接及独立checkout基线：`9fbde1326eac7ccdf1793c5bec1c314fdc0acb7a`。
- 两机已通过的M0源码：`11237d974ce42f3377cf06faf01e351b8f20cc3d`。与本轮checkout基线的src/test/scripts/package及lock差异为空。
- 独立M13修复SHA：`ec827170ec24d78fd27e213d3cc3ff1d678a6377`。本目录后续文档提交不能代替这个源码验证对象。
- 荣耀RY-08的README/REVIEW/commands及相关日志已核对，12项公开文件SHA256校验通过。保留其首轮422/433失败及单变量修正后433/433事实，没有重写荣耀证据或状态。

## 实现范围与剩余候选

| 分类 | 本轮处理 |
|---|---|
| 7处args.api_key引用 | 支持Python中api_key的完整引用赋值/参数值；拒绝属性后缀、索引、调用、拼接、回退、元组等更大表达式 |
| 2处环境空默认值 | 仅Python、精确字段api_key、os.environ.get的大写环境变量名和空字符串默认值；不扩展到token/password/apiKey字段或getenv双参数 |
| 2处Python API示例 | 仅调用参数位置、精确api_key、完整单/双引号your-api-key字面量；顶层赋值、前后缀、大小写变体、拼接及相邻字符串不获豁免 |
| 5处其他语言API示例 | PHP的HP-001、Ruby的HP-004/005、TypeScript的HP-007/008继续暂缓；没有借Python识别器自动放行 |

逐ID映射见[candidate-scope.json](candidate-scope.json)。11是历史候选的语法范围映射，**不是11处真实文件重新扫描通过**；本轮没有读取或采集真实Skill。完整文件的其他命中仍可能阻断。原16处候选没有全部实现，不能因本轮阶段验收通过将余下5处销账。

## 修复方式及明确限制

生产改动仅新增`profile-expressions.ts`并替换`assertProfileContentSafe`的宽泛正则规范化；基础`scanForSecrets`及采集/恢复/publish入口不改。

识别器只处理支持语言的源文件或Markdown内明确、闭合的已知语言围栏；这是选择语法规则，不是文件或目录白名单。整个原文仍扫描，未知围栏、未闭合围栏、注释、docstring和普通Markdown不获得新表达式豁免。非Python的JS/C#/Java保留受限的既有单参数环境读取形式，不扩展M3；未经证明的原有跨语言/纯文本正则匹配也不继续盲目放行。这可能增加保守阻断，不保证此前所有文本形式仍被接受。

识别完整token序列及其终止位置；Python括号内和反斜杠续行不能只取第一行，JS换行后运算/索引/模板等后缀不能按自动分号直接放行。顶层逗号可能构成元组，只在调用参数上下文接纳逗号终止；闭括号必须与所在容器匹配。括号包装等未支持候选形态保持拒绝，不声称实现完整Python或其他语言语法解析。

只在内存中将已识别token逐UTF-16码元替换为空格，保持原有CR/LF及Unicode分隔字符；不吞注释、换行或邻接值，不写回原文。除保留既有精确ghp文档占位符处理外，Bearer和已知token前缀检查未被表达式掩码处理的内容；例如长token形态的环境变量名仍拒绝。对会避开旧assignment正则的括号/续行候选，补充同规则、原始行号的拒绝结果。这不是通用凭据检测完备性证明，也未把函数名/目录名当作真实性证据。

M0测试中的“profile尚未支持M13”阶段性断言已调整为基础扫描器仍拒绝这些原文，同时明确保留profile的M2拒绝断言；其余同行凭据、行号、三入口和Codex保护继续运行。不是删除原拒绝测试来伪造绿态，而是将新授权的profile语法与未改的基础扫描规则分开验证。

## 实际影响分析、红测与回归

修改既有生产符号前，在独立目录及隔离用户根完成GitNexus 1.6.11索引和实际上游impact：**HIGH，11符号，3直接调用点（walk/readSnapshot/scan），4受影响入口组**。辅助函数新增后，边界修订前也分别完成lex/terminated/atom的影响分析，均HIGH；均在修改前告知用户。见[impact.log](impact.log)及相应辅助影响日志。

图工具存在执行流预算截断及跨语言字段未关联提示，跳过1个大于512KB的荣耀历史证据JSON；不将缺边作为无影响证据。提交前CLI detect_changes和结构化调用均退出0，报告4文件/44符号/15相关执行流，风险high。[完整结构化结果](detect-all.json)与Git逐路径差异共同核对：图未为M0测试的匿名回调另建changed symbol，Git仍明确包含该测试文件。

| 阶段 | 命令 | 退出 | 结果 |
|---|---|---|---|
| 独立依赖/基线构建 | npm ci --ignore-scripts --no-audit --no-fund；npm run build | 0 | 仅临时源码依赖，基线可构建 |
| 初始M13红测 | node --import tsx --test test/profile-secret-scan-m13.test.ts | 1 | M0基线33项中21通过、12预期失败，含允许候选被拒和旧跨行规范化漏拒绝 |
| 补充边界红测 | 同一定向命令（新增边界样本） | 1 | 中间实现38项中33通过、5失败；覆盖元组、闭括号和下一行独立if语句 |
| 范围红测 | 同一定向命令（增加字段范围样本） | 1 | 中间实现41项中38通过、3失败；随后收紧空默认值字段范围 |
| 最终定向 | node --import tsx --test test/profile-secret-scan-m13.test.ts test/profile-secret-scan.test.ts test/secret-scan-m0.test.ts | 0 | 56/56（M13共41项、既有profile 1项、M0 14项） |
| 最终全量 | npm test，含pretest构建 | 0 | **474/474，85 suites，失败/取消/跳过0** |
| 提交前 | git diff --cached --check；detect_changes --scope staged --repo hp-m13 | 0 | 仅2生产文件和2测试文件 |

详细命令、退出码和原日志摘要见[commands.json](commands.json)；最终证据是[focused-final.log](focused-final.log)及[full-final.log](full-final.log)。中间版本的471/471全量日志也保留，并标记为非最终结果；字段范围修订后已重新完整运行474项。红态原始日志、补丁及初始测试副本仅留惠普本地，公开材料只列统计与摘要，未提交失败测试作为修复交付。

三入口使用同一人工文件：允许内容可采集并恢复到临时目标，字节保持原样；允许publish只到被mock的Git门槛，未联网。拒绝内容在采集前不建快照目录，摘要一致的恶意快照恢复不改临时目标及baseline，publish不增加外部命令调用。完整回归同时覆盖原Git元数据、旧快照、路径逃逸/junction、中文搬运、备份冲突、Codex配置/报告与导出/push保护。

用户/应用/Codex配置、TMP/TEMP、npm配置及缓存隔离，顶层UAGENT_SYNC_WORKSPACE_ROOT明确UNSET，OPENCODE变量指向独立clone且允许测试覆盖fixture，见[isolation.json](isolation.json)。真实配置、记忆、链接和插件缓存未改；构建生成的i18n换行状态未提交。打包测试的临时前缀安装不等于设备插件安装；没有对并发真实环境作全机摘要不变保证。

## 剩余阻断与下一步

5处非Python候选、M2四处说明、2密码示例、1未确认令牌，以及荣耀172项未知值来源继续不获自动放行；25项RHS未解析、81fixture真实性未确认没有被本轮代码消除。历史13文件/23命中与82文件/195命中没有重扫，不预测新的剩余命中数。

RY-03仍缺失效链接原版本绑定证据；无新证据或用户明确选择替代基线，不重搜、不替换。新版插件/Severin联动、完整新快照、荣耀资料真实恢复、私有资料GitHub往返、双向同步、大文件迁移和惠普首轮记忆变化来源均未完成。

下一轮交荣耀在独立目录固定上述M13修复SHA，核对11/5范围及语法边界，执行构建、最终定向与完整npm test，独立记录失败和通过证据。先不进行真实采集、安装、恢复或链接操作；如发现问题回传惠普修订。复核通过后再提出处理余下5处候选的明确下一步，不将HP-03整体或迁移提前结项。

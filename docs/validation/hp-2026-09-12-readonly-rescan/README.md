# 惠普 HP-04-PRE：既有13份Skill只读复扫

**5文件扫描通过，8文件仍阻断，10次命中；13份均与旧摘要一致，无漂移。** 本轮只读检查，不生成快照；HP-03、HP-04及迁移未完成。

输入交接552f3471f9da3f799dee860621809ca38a37ca20。独立clone先核对输入与af3f79c2c66a3d3c17fea20de0b12cc5577faf0f在src/test/scripts/package/lock无差异并构建，随后实际detach固定af3f79c执行纯内容扫描。扫描后源码差异为空，回到交接分支仅编写报告。没有代码修复提交。

已读取荣耀php-ruby-comments的README、REVIEW、RESULT、commands及定向/全量/原反例日志，接受216/634/2项有限复核。本轮未重跑全量程序回归：源码未变，当前任务是完整真实文件纯扫描，不把荣耀回归记作本轮惠普测试。

## 方法与边界

输入严格取既有hp-2026-09-11-scan-plan/hp-findings.json的13路径及旧摘要；仅映射到本机既有Skill目录，不递归扩扫。逐文件读取完整UTF-8内容，调用固定源码的assertProfileContentSafe(content, originalRelativePath)，保留扩展名及围栏语境。没有摘出候选片段单独扫描来代替完整文件。

逐文件读取前内容摘要与旧current_sha256比较，扫描后再次读取核对摘要。13/13旧摘要匹配，13/13前后匹配，无法读取0，漂移0。只表示受检13文件这两个读点内容一致，不声明全机配置/记忆无并发变化。原始摘要及绝对路径留本机，公开只含核对布尔结果、原有相对路径、规则和行号，不上传原文或凭据。

扫描命令退出0表示完成检查，**不表示13份全部安全**；扫描器拒绝被捕获为脱敏rule@line结果。命中按规则/原始行号计数，10项均精确映射旧ID，无新增未映射项。字节摘要一致，映射没有跨漂移猜测。旧23项变为10项，13项不再报告。

[逐文件与全部23项ID映射](scan-result.json)、[统计](RESULT.json)、[命令](commands.json)、[执行前环境](scan-pre-env.json)、[实际扫描脚本](scan-script.txt)。构建0，纯扫描0。脚本只调用纯扫描入口，不导入快照/恢复/发布模块；原日志摘要另存。

## 完整语境的候选结果

| 组 | 旧候选结果 | 完整文件结果 |
|---|---|---|
| Python11：HP-002/003/011/012/014/015/016/017/019/020/021 | 11项均不再命中 | 涉及5文件；两份claude-api文档与ncbi脚本通过，openalex/openfda仍有M2命中 |
| TS2：HP-007/008 | 2项均不再命中 | 两份完整文档通过 |
| PHP/Ruby3：HP-001/004/005 | 3项仍命中 | 三份完整文档均阻断 |

PHP/Ruby三个围栏同时含导入、默认客户端、显式参数客户端，超过当前整区仅单条构造语句限制。实际围栏及三类语句行号见region-summary.json。此处是预期复杂区域弃权，不能把人工单语句通过当整文件已支持；本轮没有发现新的漏拒绝反例，也未证明扫描器可识别所有秘密。

## 残留10项

| ID | 文件（agents/skills/下） | 原始行号 | 规则 | 分类与处理 |
|---|---|---:|---|---|
| HP-001 | claude-api/php/managed-agents/README.md | 22 | sensitive-assignment | 复杂多语句围栏，继续阻断 |
| HP-004 | claude-api/ruby/claude-api/README.md | 20 | sensitive-assignment | 同上 |
| HP-005 | claude-api/ruby/managed-agents/README.md | 22 | sensitive-assignment | 同上 |
| HP-006 | claude-api/shared/managed-agents-tools.md | 263 | known-token-prefix | 来源/真实性未确认，保留阻断 |
| HP-009/010/013 | literature-search-openalex/scripts/openalex_cli.py | 100/125/344 | sensitive-assignment | M2参数说明，继续暂缓 |
| HP-018 | openfda-database/scripts/openfda_query.py | 158 | sensitive-assignment | M2参数说明，继续暂缓 |
| HP-022 | pdf/SKILL.md | 216 | sensitive-assignment | 固定密码示例，继续拒绝，不是已确认真实凭据 |
| HP-023 | pdf/reference.md | 340 | sensitive-assignment | 同上 |

规则合计：sensitive-assignment 9，known-token-prefix 1。分类继承旧证据且文件摘要匹配；没有把示例或未确认项改判真实凭据，也没有把未确认改判安全。荣耀额外172项不在本轮13文件集合中，未复扫、未放行。RY-03链接未重搜、未替换。

## 最小下一步（方案，尚未实施）

1. 荣耀先执行RY-04-PRE，仅对两机共同13份文件做同源码只读复扫与旧摘要核对，验证本轮5/8/10及候选映射能否复现；有漂移独立列出，不用惠普统计代替本机结果。
2. 双方据实际三个围栏审阅一个受限语句序列方案：导入/默认构造/显式构造的完整边界、词法模式与相邻凭据拒绝。未来如获启动，仅补人工失败测试后实现，不支持任意多语句，不解码或执行导入，不以行白名单解决。当前只提方案，不扩写解析器。
3. M2四项单列未来专属文档语法设计与红测门槛，不混入PHP/Ruby；HP-006需要可验证来源或本机私密真实性复核，未获得前继续阻断；HP-022/023不因常见密码或示例身份全局豁免。172项和链接来源继续既有阻断。

没有真实采集、安装插件、恢复、快照发布或文件搬运；npm仅安装隔离clone构建依赖。真实配置、记忆、原始报告不改。HP-04-PRE完成仅表示只读预检完成，HP-03继续进行中、HP-04仍待办、迁移未完成。只新增惠普任务行，不替荣耀勾选。

提交前detect_changes退出0，仅任务文档映射2符号、0执行流程；新增报告由Git暂存差异核对，未修改生产符号。索引存在流程预算截断及大JSON跳过，缺边不代表无影响。source-equivalence退出0再次核对固定源码与交接分支的受检代码一致。

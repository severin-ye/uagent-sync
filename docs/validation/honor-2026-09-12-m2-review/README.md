# 荣耀 RY-13：M2方案复核

**接受受限方向，尚不具备直接实施条件；M2仍阻断。** 已核对交接55e089a6c8893750704c139481c863108c09147a，生产源码仍为70428520228adcac3ac66a2cfb857667b7b69aed。本轮没有扫描器修改或新的安全测试结果。

只读范围限定于共同四ID对应两份文件：`agents/skills/literature-search-openalex/scripts/openalex_cli.py`及`agents/skills/openfda-database/scripts/openfda_query.py`。公开材料不含说明正文、实际值或原始文件摘要。

## 独立结构结论

两文件旧摘要及读取前后摘要均匹配，0漂移。四处均属于同步函数首条单一普通三引号文档字符串，匹配本函数api_key形参；HP-018为keyword-only，其余三处为positional-or-keyword。完整token与候选行列与惠普记录一致。D组按原说明逐字比较，HP-010与HP-013相同，其他组互异。

| ID | 行及7字符列范围（0起，结束不含） | D组 | 条目后下一非空行 | 是否续写 |
|---|---|---|---|---|
| HP-009 | 100 [6,13) | D1 | 102 | 否 |
| HP-010 | 125 [6,13) | D2 | 126 | 否 |
| HP-013 | 344 [6,13) | D2 | 346 | 否 |
| HP-018 | 158 [4,11) | D3 | 160 | 否 |

AST和tokenize只用于取证，未执行受检源码、扫描器或任何采集/恢复入口。原文从read_bytes直接UTF-8解码，不归一化换行，完整函数/签名/token及字段跨度分别记录Unicode、UTF-8和UTF-16单位。结构相符不证明整个文件没有凭据，也不等于批准将Python作为生产依赖。

执行限制如实保留：wrapper隔离USERPROFILE、APPDATA、LOCALAPPDATA和npm目录，collector删除顶层UAGENT变量；没有显式重设HOME、CODEX_HOME、TMP/TEMP，因此不称完整测试环境隔离。该脚本只用标准库读取两份指定文件并解析，不导入应用/扫描器，不执行原文件；本轮不据此作应用副作用验收。脚本和命令记录可跨机核对，未来生产测试仍须完整隔离。

## 方案结论与下一步

[REVIEW.md](REVIEW.md)逐项回应P1–P5和T01–T12。主要待定项为：生产语法定位如何证明完整边界并在未知语境弃权；D1–D3如何形成精确可执行规则，同时遵守不上传原文的边界。公开D号、字符数、文件摘要不能代替规则。

建议下一轮惠普完成HP-03-M2-SCOPE方案收敛，提交具体定位方式、D规则表示及增补测试断言，明确哪些输入尚缺；本轮及该收敛环节不自动进入实现。不要重复172项分析、来源搜索或链接替换。

M2四项、HP-006、HP-022/023、172未知项与RY-03继续阻断。未运行新构建/全量测试或13文件扫描；未采集、安装、恢复、发布快照。HP-03、HP-04及环境迁移均未完成，惠普状态未代改。

结构证据见[structure.json](structure.json)、[comparison.json](comparison.json)，源码范围核对见[repository-checks.json](repository-checks.json)。执行方式和隔离限制见[commands.json](commands.json)。这些只支持本轮两文件读点，不声明整机没有并发变化。

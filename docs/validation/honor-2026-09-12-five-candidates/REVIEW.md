# RY-C5-01：TS相邻带引号apiKey漏拒绝

复核源码04672a6314d66c745bb11819e90f71b5ced0d3d0，相对1ad915b9b9a45289dd9540408907ce593982e227。生产只新增typescriptPlaceholders及调用处31行，原90测试没有改；新增31测试。惠普30份公开材料摘要全部匹配，已读取要求的报告、命令、wrapper、执行前环境、红绿全量和detect。惠普impact/detect为HIGH，不冒称荣耀重新建图。

## 已证实的范围

TS只允许.ts或闭合ts/typescript围栏中的行首、深度0、完整const client = new Anthropic({ apiKey: 精确引号占位符 });。额外字段、改名、缺分号、嵌套与尾接表达式不获新增允许；只把精确字面量码元改为空格，保留其他内容、换行与UTF-16长度。原11处Python形式、M0、B1逻辑未改。两个历史候选只得到形式实现，不代表真实文件采集通过。

现有测试检查注释和普通邻接凭据、LF/CRLF及原始行号，单纯无引号apiKey的未识别冒号值被保守拒绝。但它不能覆盖下面的等价带引号字段。

## 人工失败证据

安全对照第一行如下；第二行分别追加注释值或模板值，均是合法JS/TS子集（new Function仅解析、不执行）：

```typescript
const client = new Anthropic({ apiKey: "your-api-key" });
const other={"apiKey": /* note */ "SYNTHETIC_NONEMPTY"};
```

第二行也可为：

```typescript
const other={"apiKey": `SYNTHETIC_NONEMPTY`};
```

当前两者均通过assertProfileContentSafe。裸apiKey加相同模板值拒绝；带引号apiKey加直接普通字面量由基础规则拒绝。纯函数对照见pure-probe.json；基线对照见baseline-comparison.json。

根因在src/lib/profile-expressions.ts:148：只匹配key.text === 'apiKey'，未识别词法token中的带引号字段。基础逐行正则不能跨过值前注释或模板起始符。新掩码只遮蔽占位符，没有遮蔽非空值；漏洞属于既有漏检被新允许形式暴露。单独危险第二行在旧基线也允许，而两行组合旧基线因第一行阻断、当前整体允许，不能将全部根因归咎本次掩码。

three-gates.test.ts来自现有三入口测试的独立人工变体，导入固定clone源码；全部数据为TEMP人工fixture，publish mock不发真实Git/网络请求。两个变体均退出1：7条拒绝/副作用断言各自失败，安全允许对照先通过。具体为采集未拒绝且出现快照目录、恢复未拒绝且目标字节及基线变化、publish未拒绝且mock调用由1增为2。最终断言收集失败，避免首条失败阻止后续观察。原始文件保存本机；公开脚本改为仓库相对导入方便重现。

执行：node --import tsx --test docs/validation/honor-2026-09-12-five-candidates/three-gates.test.ts（应在隔离目录和环境下执行；修复前预期失败）。已存在自动回归与附加安全失败必须分别记录。

## 结论及下一轮

HP-007/008精确形式能运行，但相邻凭据保护不完整，荣耀RY-10复核阻断，新增RY-C5-01。下一轮先修带引号的精确apiKey字段拒绝边界，不新增允许，不混入PHP/Ruby。红测至少覆盖单双引号字段、注释/模板/跨行非空值、行号及完整三入口；对照安全原形式仍允许，其他未知结构继续拒绝。无需把字符串任意解码为代码，也不能以此要求通用语言解析器；修复限字段token及完整冒号值语境。

HP-001(PHP)、HP-004/005(Ruby)暂缓依据成立：当前codeRegions不支持它们，已有lexer不区分heredoc/nowdoc、百分号字符串、语言专属注释及插值。不能简单增加扩展名别名。后续准入范围保持仅这3项历史语法：PHP Client命名参数apiKey与Ruby Anthropic::Client.new关键字api_key，精确引号占位符完整值。先做专属词法红测：代码与字符串/注释/文档块分离、插值与语言拼接续行拒绝、参数闭合及邻接字段、原始跨度行号、三入口配对；不识别结构保守拒绝。该阶段须等RY-C5-01修复并复核后开始。

M2、172项未知来源、RY-03继续保留。没有真实采集、安装、恢复、链接搜索或替换；HP-03整体与环境迁移未完成。

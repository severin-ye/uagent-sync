# 静态审阅意见

## 1. 实际调用路径

按交接提交的源码核对，生产内容与7042852相同：

| 对象 | 源码证据 | 结论 |
|---|---|---|
| create | src/lib/codex-profile.ts:108、118–122 | 全部收集扫描通过后才写payload/manifest；末尾文件扫描拒绝不会留下本次快照 |
| plan/restore | 同文件:125–138、164–182、200–210 | readSnapshot扫描早于规划及备份、目标、基线写入；内部session helper可复用一次加载 |
| publish | src/lib/device-git-transport.ts:26–43 | 所有指定路径扫描通过才进入assertPrivateGitHub；此后才首次Git/gh调用 |
| CLI | src/entrypoints/device-cli.ts:29、41、46–49 | 当前调用同步操作；改接异步操作后必须等待返回值再读取conflicts或序列化 |
| Codex扩展恢复 | src/lib/codex-restore.ts:252–270、304–430；src/lib/workspace.ts:237–268 | tombstone和安全条目可能先执行；危险MCP基础扫描后跳过本项，不是整批回滚 |

接受CALL-PATHS。扫描前已有读取、路径检查、哈希等动作，不能称完全无I/O。拒绝保护指本次快照/目标/基线写入和外部执行。已有并发文件变化边界不因冻结模板得到全面解决。

## 2. 接口和可信来源

接受INTERFACE：同步默认函数保持现有无M2语义；异步工厂在每次操作开始加载一次，内部扫描保持同步纯内容接口。restore内部规划不调用另一个会重新加载的公开工厂方法；独立preview/apply各加载并重新规划。并发操作各自冻结，不把上下文存到业务选项或文件。

可信provider只能由宿主代码装配；品牌context防误用，不等于隔离任意恶意宿主代码。普通CLI参数、环境变量、manifest及被检内容不得选择模板。加载缺失/错误/版本或schema无效时形成不启用M2的会话，继续原扫描，不重试每个文件；只捕获provider/M2边界内失败，不能吞掉基础扫描、M13或文件读取错误。对异常信息也不得输出真实模板正文/私有模板路径。

**补充C1：异步传播合同。** CLI snapshot、restore preview/apply、publish分支必须await，之后才序列化、访问conflicts或返回退出码。人工测试使用延迟resolve/reject，证明无Promise被当成结果、拒绝被现有错误出口接住，且CLI不额外begin。现有runDeviceCli已经async，不需改变其公开返回类型。

## 3. 扫描组合

接受SCAN-ORDER。src/lib/profile-secret-scan.ts:5–15现有两个精确ghp示例替换先于检测；Prefix/Bearer只看该处理后的原文，不看表达式掩码。M13归一化仅影响assignment，rejectedLines最后补回；按原行号及固定规则顺序输出。

src/lib/profile-expressions.ts:141–190使用UTF16单元数组保留位置。接入时仍应防御性检查归一化结果长度及换行位置未变；M2始终解析原始C，不解析已掩码字符串。全量校验跨度、长度7、原切片api_key、不重叠/不跨行、未被M13修改后，才能应用全部跨度；失败撤销全部M2，不能留下先前跨度。原始正文和payload不变；不能撤销同原始行M13拒绝。

接受缺模板与旧findings逐项相等、前缀/Bearer/邻接赋值、LF/CRLF/非BMP、后置错误撤销、并发/一次加载等人工门槛。byte适配只在有效M2上下文的.py路径启用fatal UTF8，必须在任何有损解码前取得字节；纯string API不能声称验证了编码。BOM、lone CR及其他原型保守格式保持弃权。

## 4. 人工入口验收的范围澄清

**补充C2：测试替身必须覆盖全部外部调用。** O03/O06方向接受，但当前transport直接spawnSync（device-git-transport.ts:6–18），setup直接run/scan/restore（workspace.ts:237–268）。实施前选定一种可验证办法：独立测试进程在模块导入前完整拦截外部调用，或明确内部依赖注入接口及改动文件。优先复用已有隔离测试办法；不是必须新增公开API。若选内部setup接缝，须显式补入GATES允许文件，默认行为不变。任何未匹配的外部命令测试中必须抛错，绝不能回落真实Git/gh/安装命令。版本探测计数与危险MCP执行计数分开；替换掉整个restore函数不能证明真实基础扫描保护。

O03首次抛错Git替身应准确为remote get-url调用，计数1；拒绝配对Git与gh均0；完整协议测试保留。O05单危险MCP、无tombstone/其他条目时execute=0；混合批次仅危险条目无执行，安全条目既有副作用不能伪称不存在。恢复报告仍用基础扫描器，M2加载0。

**补充C3：O01“末尾失败”限定为末尾文件扫描失败。** HP原文未明确写磁盘写入失败，不将歧义当成已发现漏洞。现有atomically逐文件落盘（codex-profile.ts:44–48、121–122），不能由静态扫描顺序推出磁盘故障后无半快照。建议本范围明确为扫描拒绝；不自动增加临时根事务/回滚重构。磁盘故障的全快照原子性不是本轮新增承诺。

这些是接口及验收可执行性补充，没有要求扩大允许格式。未运行人工入口测试，不能标记O01–O06通过。

## 5. 依赖、格式缺口与最小输入

接受固定生产@lezer/python 1.1.18、独立lock、Node18/当前Node、完整生产回归、omit-dev消费者及宿主SDK分开的门槛。当前package-lock.json:831–839锁定@opencode-ai/plugin 1.18.15和其SDK 1.18.15；建议该版本作首个明确宿主测试基线，不追逐未核对版本。src/plugin.ts:12是type import，:13是运行时tool import，HP行号须微调。当前devDependency分类意味着不能以纯内容import成功代替plugin主入口可导入；本轮未运行打包或宿主测试，也未决定调整依赖分类。

原型仍对正文前导概述、说明跨行、复杂返回类型、嵌套/未知段落、行内闭合、tab等保守弃权。本轮不读取真实四处，不能声称实际M2文档符合受限格式，也不能为覆盖率删去拒绝门槛。

人工集成最小待定输入只有：明确实施授权，以及在实现方案中落实C1–C3/选定C2替身方式；真实模板正文不属于人工接入的前置输入。真实启用另需授权的私有模板来源、操作者、扫描/同步目录之外的部署位置及宿主注入安排。SDK验证先用已有lock基线即可，若失败再如实说明具体兼容阻断，不预先扩大依赖调整。

下一轮惠普可一次性把C1–C3纳入范围，记录无新增架构分歧即可，不必再轮询相同方案或重跑原型。没有用户明确生产实施指令时止于范围定稿；取得该指令后按S1→S2先人工红测再最小接入，之后交荣耀固定源码复核。真实模板和真实迁移仍另行验收。

## 6. 本轮证据与限制

执行git fetch/ff同步及rev-parse，交接HEAD精确匹配；git diff 7042852 HEAD -- src test scripts package.json package-lock.json为空。读取HP六份范围文档、RESULT/check-result及上述生产源码与已有transport测试。一次定位误用不存在的profile-secret-expressions.ts，随后按profile-secret-scan真实import找到profile-expressions.ts；这是查找路径错误，不是测试失败。

未执行构建/npm test/原型/打包/宿主测试，未改任何生产符号或依赖，未读取真实模板或重扫真实文件。所有运行验收保持未执行，历史失败证据不改。公开材料只包含仓库源码位置、方案意见与状态。

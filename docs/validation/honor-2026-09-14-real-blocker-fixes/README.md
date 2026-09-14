# 荣耀集中修复：真实82文件阻断及安装声明

基线交接 `14a90c178f9f1556e73c1a6d3cfde54eb5ed7b38`；此前生产为 `ce6780faa0995c3c3587658aa46a161b4b5e4bcf`。本次有新生产修复，以本报告所在提交及[source-sha256.json](source-sha256.json)固定对象。用户本轮要求集中修完，不再逐个请求处理真实副本的许可。

## 实际结果

- 82份历史受检文件全部与旧摘要一致；默认扫描74文件阻断、188命中。[只读副本扫描](scan.json)。
- 从garrytan/gstack、anthropics/skills、google-deepmind/science-skills的公开Git对象独立获取全部原文：67份字节完全一致，15份仅LF转CRLF后完全一致；逐项SHA256亦核对。[公开来源核验](verified-public.json)。仓库目录、下载blob、原文及个人副本不上传。
- 新可信宿主provider绑定逻辑Skill路径和**完整字节SHA256**。三个入口正常扫描后，仅精确匹配到独立核验公开原件才由来源复核解决误报。文件改变、路径改变、假context、错误provider仍不继承放行。不是路径/目录白名单，不从受检原文自动学习规则，不改变默认扫描，不输出或修改原文。
- 这82份受控副本82/82通过、0命中；快照82文件、0个.git，隔离恢复后82/82摘要一致，真实原件82/82未变。[实际副本往返](roundtrip.json)。这覆盖旧M2四处、HP-006/022/023及172项的固定版本，不能外推未来修改。
- 原受限M2解析器仍对真实文件f-string弃权，未把它改成通用Python解释器。四处参数说明由完整公开文件来源证明解决；私有模板仅在本机试验，未上传。
- 根Node安装声明与锁文件对齐依赖要求，未升级依赖；见[安装契约修复](../honor-2026-09-14-engine-contract/README.md)。

## 验证及保留失败

初版新增provider测试6项因接口尚无失败；实际默认扫描74/82阻断是本次行为红态。新增两文件初绿12/12。独立审查发现未清单PNG也被fatal UTF8拒绝，主对话复现为原6项通过+新1项失败；修复后13/13。[独立意见与处置](REVIEW.md)、[红态](binary-red-binary-red.log)、[绿态](binary-green-binary-green.log)。坏UTF8已清单文件仍拒绝；不影响未清单二进制默认行为。

三入口允许/变更拒绝配对均覆盖：拒绝时无快照产物、目标和既有基线不变、无新增mock Git调用；允许发布只走严格mock，无真实远端副作用。主对话从空缓存实际下载82blob运行新命令check，退出0。第一次普通fetch blob失败，修为promisor fetch语义后通过，旧失败日志保留。

Node24.16.0最终全量 **869/869，0失败/取消，退出0**；[最终全量日志](full-final-full-final.log)。此前并行工作期间的一次869日志也保留，但最终以全部改动冻结后的重跑为准。独立engine批次856/856是该子批次结果，不与869混用。Node18不满足新安装声明，没有重复全量测试。最终合并包另在private manifest消费者以显式prefix和engine-strict安装，退出0；已安装公开复核脚本import、82项数据清单检查通过，祖先依赖检查干净。[最终安装包](packaged-consumer.json)。

GitNexus调用已执行，但当前索引未收录新增函数，impact返回UNKNOWN/not found；detect的零symbol不能视为无影响证明。人工调用核对定位采集/规划/恢复/发布；按高风险范围覆盖测试。既有dashboard生成文件仅行尾索引状态变化、实际diff为空，未纳入提交。

## 可运行入口

[scripts/verified-public-profile.mjs](../../../scripts/verified-public-profile.mjs)随包发布，使用[data/reviewed-public-skills.json](../../../data/reviewed-public-skills.json)中固定公开对象。设备路径均由参数提供，不写死荣耀/惠普。命令只读检查示例：

```powershell
node scripts/verified-public-profile.mjs check --home <用户目录> --codex-home <Codex目录> --workspace-root <工作区> --cache <新的绝对缓存目录> --report <新的绝对报告文件>
```

详细snapshot、restore-preview和仅新目标目录restore-copy见[使用说明](../../DEVICE-SYNC-USAGE.md)。普通CLI不会自动启用此独立复核；不可将私有内容拷入manifest或把快照作为可信provider来源。缺失文件记录为缺失，清单只覆盖这82份，不代表其他内容已经验收。

## 不能凭代码修出的旧现场

旧链接的136份归档已经逐项校验并解包到隔离候选目录，[候选核验](legacy-candidate-check.json)。未改真实链接，仍无法证明9月归档等于8月旧目标；缺原版本时不能伪造等价。惠普npm事前状态和历史记忆写入归因缺证据，荣耀无法代替持有现场的一端恢复。

没有真实插件注册、全工作区迁移、惠普真实恢复或GitHub个人快照发布。HP-03/HP-04及完整迁移不标完成。只推本轮代码、人工测试和脱敏报告，不推原文/模板/归档/个人快照。旧失败证据保留，惠普只做新机制和本机实际范围，不重做旧M2语法实验或来源搜索。

公开日志副本已脱敏并裁掉行尾空白，退出码/断言/失败保留；原始日志仍留本机。source-sha256.json按UTF8文本统一LF计算，跨Windows checkout不以换行差异冒充源码漂移。

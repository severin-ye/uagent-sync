# 推荐接口与可信宿主边界（尚未实现）

## 纯内容接口

拟新增scanProfileContent(content: string, source: string, context?: ProfileM2Context): ProfileScanResult。结果包含脱敏findings及M2状态原因码；findings仍rule/原始line/evidence=<redacted>，不含模板正文或私有路径。现有assertProfileContentSafe保留同步void/throw包装及两参数默认调用；无上下文结果必须与7042852一致。

content为未归一化JS字符串，接口不读文件/环境/模板、不网络、不执行代码、不自行加载provider。source只用于语言调度和诊断，不能凭路径、摘要或候选ID允许；首批仅扩展名.py（大小写无关）整文件，非.py返回无M2掩码。普通对象假冒context不能激活M2。纯字符串接口不声称证明原字节UTF8。

新增profile-m2-docstrings.ts移植eaf93ff有限识别与原始跨度合同；返回所有跨度或空集合。版本与私有数据类型校验留在provider；profile基本findings汇总留在profile-secret-scan。M2异常只令M2弃权，不吞掉基础规则/M13拒绝或整体扫描异常。

## 操作工厂与加载边界

推荐新增createProfileOperations(trustedProvider)，返回async create/plan/restore/publish方法。provider.begin(): Promise<冻结模板或无模板状态>继续使用原型的异步合同。每个方法先await一次begin，再进入同步内部实现；枚举payload/扫描之前已经固定结果。factory可长期复用provider对象，但不得缓存上次模板值。

为避免破坏现有同步API，当前createCodexProfile/planCodexProfileRestore/restoreCodexProfile/publishDevicePaths保留为“无M2”的同步兼容包装；内部抽出接收session的实现供工厂使用。原库调用者不提供provider时不增加文件读取。内部helper不从src/sync.ts公开导出，不允许options/manifest的任意属性变成session。宿主有执行代码权限本身不是安全沙箱，进程内品牌只隔离数据伪造。

restore工厂方法只调用一次begin，内部restore→plan→readSnapshot复用同一session；不能再调用会begin的公开plan工厂方法。独立preview完成后再apply时，apply重新begin并重新规划；不接受预览产生的计划作为免扫描凭证。所有文件共用冻结对象，加载计数不随文件数增加；并发两操作分别begin，后续源变化只影响后续操作。缺失/失败亦不在文件循环中重试或复用旧缓存。

## 注入位置

在src/entrypoints/device-cli.ts的宿主构造层提供createDeviceCliHandler({profileOperations})一类依赖工厂；现有runDeviceCli保持默认入口，由缺模板provider组成默认operations。解析action、连接和设备后，由选中的snapshot/restore/publish方法开始操作；audit/fetch/register等不加载M2。

人工集成测试由测试宿主显式构造provider并调用该handler或operations。普通CLI选项、device连接JSON、registry manifest、同步配置、扫描source、被检目录及环境变量均不能选模板文件或传入provider。先不新增--template或环境路径入口，不从被检目录寻找模板，不将真实模板打包进npm。

session和模板正文不得写入manifest、恢复基线、连接配置或持久缓存，也不得随快照发布。操作完成即不再复用该session；只可返回固定原因码和必要版本状态，不把私有数据挂入可序列化业务结果。

未来真实启用还缺“获授权本机操作者＋不在扫描/同步/发布根内的私有路径＋已审核正文及来源＋宿主配置交付方式”。未有这些输入，生产默认provider始终缺失；本轮不准备它们。人工集成不需要真实正文，可使用独立合成provider。真实路径接入须另一次范围及授权。

## 缺失和错误

默认无模板、读取失败、重复JSON键/未知字段、版本/内容错误、复制冻结失败：本次操作得到无M2的冻结session，继续既有扫描；不是“文件默认通过”，也不是“所有操作都被禁止”。真实四处若原有敏感赋值命中，仍阻断；原无命中文件保持可用。原因码可区分missing/unavailable，禁止输出模板值或私有路径。闭合schema、D组精确相等和资源上限沿用原型，不以D编号或摘要代替规则。

生产payload字节适配器拟仅在有有效模板且.py将尝试M2时严格UTF8解码（fatal，保留BOM给识别器）；坏UTF8立即拒绝本文件/操作并给固定原因码，不把替换字符后的文本当原文批准。无模板兼容路径保留既有读取行为；合法U+FFFD不等于解码错误。M2的BOM/loneCR/格式异常导致无M2跨度。此字节接线是新验收点，未由原型纯字符串测试证明。

# HP-03-M2-INTEGRATION-SCOPE 范围定稿

2026-09-13，惠普。核对交接40febddab4a2c78aa80da278108951d8591bc38a。生产基线仍为70428520228adcac3ac66a2cfb857667b7b69aed；本轮只有文档，没有独立修复SHA。

荣耀RY-16与惠普无新增架构分歧。接受C1–C3，更新原范围的GATES、ACCEPTANCE与SCAN-ORDER；本文件是补充合同，旧运行证据及原提案RESULT保留。S0范围收敛结束，S1/S2未启动。唯一人工实施前置输入是用户明确的生产实施指令，不要求真实模板，也不再轮询同一方案。

## C1：异步等待

device-cli.ts的snapshot、restore preview/apply、publish分支必须await操作后再读取conflicts、序列化与返回退出码。runDeviceCli已是async，保持公开返回类型。每个分支各测延迟resolve/reject：settle前无最终输出/完成退出，成功后是结果而非Promise，拒绝进入现有错误出口且无未处理rejection；加载次数等于操作一次，CLI不额外begin。拒绝时无对应写入或外部调用。以上均为未来验收，尚未运行。

## C2：外部调用替身的确定方案

选定独立测试子进程、导入生产模块前拦截的方案，不新增生产内部接缝，不替换整个restore、setup或基础扫描器。拟新增测试文件test/helpers/m2-external-sandbox.ts和test/fixtures/m2-operation-worker.ts，并扩展相应入口测试。父进程只启动受控Node worker；worker先安装替身、调用syncBuiltinESMExports，再动态导入生产调用链，禁止静态导入提前捕获原函数。

替身覆盖node:child_process的spawnSync、execSync、execFileSync、spawn、exec、execFile、fork，ChildProcess.prototype.spawn作为漏网拒绝后备；绝不调用原方法。按API、完整命令或可执行路径、全量argv、cwd和关键选项精确匹配人工协议，不按git/gh名称整体允许。execSync接收的shell字符串只做精确比对，不执行或解析成真实命令。模拟同步返回/回调/事件时必须保留调用者所需协议；未覆盖协议导致测试失败，不增加真实回落。

任何未匹配调用记录到独立violation列表并抛错，worker退出前及父进程必须断言列表为空。run.ts会捕获execSync异常，故仅抛错不足以保证测试失败。禁止实际网络：worker的fetch、http/https request/get、net连接（包括Socket.prototype.connect）、tls.connect及dgram创建均设拒绝后备，同样记录violation。安装替身自检需证明已匹配只返回人工结果、未匹配必失败，命名与默认ESM导出均被拦截；Node18与当前Node分别验证，不能以某个入口偶然没调用证明拦截完整。

核对的实际调用包括transport的spawnSync、workspace→run.ts的execSync、state扫描调用链、codex-restore的spawnSync，以及监控技能安装时启动Node后再spawn的路径。监控器外层spawnSync也只返回人工协议，绝不启动该嵌入脚本。人工fixture提供所需文件/可信shim解析条件，不利用本机已安装工具。其他新遇到命令一律失败并补明确人工协议后重验。

O03允许控制的第一条命令必须为git -C <人工仓库> remote get-url origin，抛出预定哨兵且计数1；拒绝配对git/gh均0。完整发布协议另保留明确顺序与输出的替身测试。O06执行真实setup/扩展扫描/restore业务函数，仅文件来自人工隔离环境、外部调用受上述替身控制；版本探测与危险MCP执行分别计数。O05混合批次只证明危险条目不执行，不宣称安全条目或tombstone无副作用。

## C3：扫描失败范围

O01末尾失败严格指最后一个文件内容扫描拒绝，断言无本次快照产物。逐文件atomically写入不承诺磁盘故障后的全快照事务性；磁盘故障回滚/临时根重构不在本次范围。不得把未覆盖磁盘故障描述成已发现的新漏洞或已解决问题。

## 其他已接受合同

应用M2前检查M13归一化结果UTF16长度及每个CR/LF位置保持一致，再验证全部7字符api_key跨度；异常时整文件M2弃权，原始prefix/Bearer与M13拒绝不消失。只捕获provider/M2边界错误，不吞基础扫描、M13或读取错误；有效M2的.py字节入口须在任何有损解码之前fatal UTF8验证。缺模板保持原扫描，可信操作工厂每操作加载一次且并发隔离，真实模板部署另行授权。

首轮宿主基线固定现有lock的@opencode-ai/plugin 1.18.15及@opencode-ai/sdk 1.18.15。omit-dev干净消费者验证实际生产依赖、纯内容/工厂/CLI；另一个显式提供宿主SDK的隔离消费者验证plugin导入，记录版本及解析位置。src/plugin.ts:12是type import、:13是运行时tool import。若缺依赖或不兼容，如实记录，不默认授权变更依赖分类。Lezer生产依赖接入仍待S1/S2授权。

## 本轮结果与下一步

已做：Git交接核对、静态调用链/lock复核、文档合同定稿、文档差异与提交前变更检测。未做：构建、npm test、原型重跑、打包/宿主运行、生产实现、真实模板读取及真实复扫。没有新的运行通过或失败结论；历史82/82等只是既有人工证据。

M2、HP-006、HP-022/023、172未知来源及RY-03继续阻断；HP-03、HP-04与环境迁移未完成。荣耀只需接收定稿，无新增实质问题不再重复审阅；等待明确实施指令后惠普按S1有效人工红态→S2影响分析及最小接入/回归，推送独立源码后再交荣耀复核。不启动真实采集、安装、恢复或快照发布。

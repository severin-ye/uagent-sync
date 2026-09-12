# 后续人工接入验收设计（本轮全部未执行）

## 纯内容/组合测试

| ID | 允许配对 | 拒绝/弃权及必须断言 |
|---|---|---|
| I01 | 合成精确D1–D3、.py直接Args、已有允许空行/多参数/Returns/Raises | 缺模板、假context、错版本、JSON重复键/未知字段不启用；无模板findings与当前实现逐项相等 |
| I02 | 原82项与荣耀附加8项移植到生产纯内容组合层 | 嵌套Example、未知段落、后置错误清空所有M2跨度；不能删除原测试，新增组合断言不是本轮重跑原型 |
| I03 | 既有M0/M13安全形式与M2同文件 | 大小写敏感键、带引号字段、注释/模板、非空回退/拼接、跨行&&拒绝保持；M13 rejectedLines不能被M2覆盖 |
| I04 | 仅字段7字符改变，原说明不变 | 前缀/Bearer在说明、变量名及注释内都保留检测；精确ghp旧例外边界前后缀拒绝保持，不扩大例外 |
| I05 | LF/CRLF、非BMP、合法U+FFFD、确定未归一化跨度 | 非法跨度/重叠一律撤销M2；有效provider下坏UTF8先于写入拒绝；纯string与byte层断言分开 |
| I06 | 操作一次begin、多文件复用、预览和应用分别加载 | 并发各自冻结、不回用上次模板、provider失败不重试每文件；普通CLI/config/manifest/env不能注入模板 |

## 入口允许/拒绝与无副作用

每组使用纯人工文件，先运行允许控制证明真正穿过扫描；再以同一fixture替换为危险/未知语境，不能由路径错误或checksum mismatch冒充安全拒绝。恢复人工坏payload须同步更新人工manifest摘要，以到达内容门槛。

| ID | 入口/允许控制 | 拒绝配对及无副作用 |
|---|---|---|
| O01 | 工厂create人工skills .py，产物字节/manifest摘要等于原输入；源文件摘要前后一致 | M2候选＋邻接人工凭据、未知Args、缺模板的命中内容；snapshot根不存在，无payload/manifest/临时文件，源不变；多文件末尾失败也无半快照 |
| O02 | 工厂plan人工快照返回计划，工厂restore在隔离目标写入并建立人工基线 | plan和apply分别测内容拒绝；目标/已有基线/备份目录树字节及存在性均不变；从未存在目标也不创建目录。测试apply只begin一次并复用内部plan |
| O03 | 工厂publish允许控制到达第一个抛错Git mock，计数精确增加1；不执行真实Git/gh/network | 危险文件单独和安全文件后危险文件，Git/gh mock新增0；暂存/index/HEAD/工作树不变，无真实.git可变更。另以完整mock协议覆盖正常add/commit/push和分叉/已有暂存拒绝，但不把mock成功称真实往返 |
| O04 | device CLI工厂注入合成provider，对snapshot/restore预览/apply/publish做上述各组 | 证明CLI没有另加载一次；缺模板默认CLI仍拒绝M2命中。JSON/普通options伪造provider不起作用；输出不含私有模板/路径/实际值 |
| O05 | restoreCodexExtensions仅一个安全MCP（环境变量名形式），execute mock观察原命令 | 仅一个人工危险MCP、无其他条目/tombstone时execute=0；同含placeholder＋另一凭据仍拒绝。M2 provider加载次数=0；不把MCP JSON送入profile M2。混合批次只承诺危险条目无执行，不改造全批事务 |
| O06 | setupWorkspace(codex)用人工state并mock环境命令/扩展扫描/执行 | 区分版本探测mock与危险MCP新增执行；不能宣称整个setup从零调用。恢复报告仍由基础scanForSecrets检测，测试只检查人工输出，不安装扩展 |

快照验证字节仍为原payload，不能把空格掩码写入快照或目标；portableConfig现有转换与本地凭据合并保持独立，不能为M2对合并后含本地凭据配置做全量覆盖/导出。路径穿越、链接、.git拒绝、源/目标变动、冲突和回滚沿用现有测试。

## 构建与发布包

- 批准后才在独立源码工作树增加@lezer/python精确1.1.18为生产dependency，记录lock实际common/lr/highlight、integrity/license；不加Python运行依赖。当前生产只有smol-toml/zod，原型lock不能代替生产lock。
- 运行生产typecheck/build及完整npm test（pretest会build）；定向含现有secret-scan-m0/profile全部文件、codex-profile/device-git-transport/codex-restore与新增组合/操作工厂测试。双运行时Node18.20.8与实际当前Node，不设固定“82就够”。不让顶层workspace环境覆盖fixture。
- npm pack会prepack构建；新干净消费者npm install --omit=dev本次tgz，在两Node核对dist新模块与声明、实际Lezer版本、纯内容/工厂import、CLI help及人工CLI适配；避免与清理dist并发测试。无真实发布。
- package.json主入口dist/plugin.js；src/plugin.ts:12运行时import @opencode-ai/plugin，但包当前将其列为devDependency。这是已有宿主依赖验证点，不能因原型import通过而宣称生产plugin可导入。分别测纯生产安装的实际结果，以及提供明确宿主SDK版本的隔离plugin导入；缺失记录为独立发布兼容阻断，额外依赖调整须说明，不能借本范围悄改。
- .codex-plugin/plugin.json通过skills暴露入口，检查包内skills和CLI引用、无真实模板/个人文件。plugin导入测试不得调用安装配置hook修改宿主；实际宿主加载另行授权验收。

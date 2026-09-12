# RY-17：人工M2接入独立复核

复核源码：`416120afbf2446463864e8292d1423e493055944`；比较基线：`70428520228adcac3ac66a2cfb857667b7b69aed`；输入交接：`cdefb187a2b00c0c92304cdea4330a8c40c518d6`。

## 阻断发现 RY-M2-01

固定源码的残留敏感赋值检查遗漏Python合法换页空白U+000C。`src/lib/profile-secret-scan.ts:32–38`只用空格/tab连接键、赋值符和值，并用非空白前瞻要求值紧接其后。以下完全人工的尾部不会命中该残留规则：

```python
# 这里展示的是转义记号；附件源字符串实际插入U+000C
PASSWORD=\f("SYNTHETIC_NONEMPTY")
```

在精确人工Args说明后追加此语句，Lezer返回候选，M2掩码说明中的api_key，基础扫描器又不识别括号包裹值，最终findings为空。`PASSWORD\f=(...)`、注释中第二赋值、函数参数默认值同样复现；Python AST只做语法验证，8个LF/CRLF组合均合法，不执行Python文件。

根因边界：括号值单独漏检是既有基础扫描盲点；**启用M2后组合文件由原说明阻断变为放行**是本次接入缺口。不是M2把真实值删掉，也不是缺模板默认行为改变。源字符串全部为人工数据，无真实凭据。

`artificial/honor-residual.mjs`有12种输入×LF/CRLF，共24次纯内容检查。当前Node为16通过、8失败；`withoutM2`、原行号、解析跨度及完整人工字符串逐项保留。常规括号值、None后第二赋值、显式续行、注解和Prefix/Bearer控制仍拒绝。

`artificial/honor-formfeed-gates.mjs`进一步执行人工安全/普通括号危险/换页危险×LF/CRLF配对：前四组控制通过，换页两组失败。失败时create生成了人工快照，plan未拒绝，restore写入人工目标及基线，publish到达首个外部调用替身，新增调用数1；正确拒绝控制新增0。替身一律抛错，未执行真实Git/gh。所有源文件摘要保持一致；人工产物保留隔离目录，**未上传快照或目标**。

建议惠普下一轮只修本缺口：先原样保留上述红态，再对不支持的合法空白保守撤销全部M2跨度，或提供完整词法证据的受限识别；不采用整行跳过，不扩大None或其他允许形式。至少覆盖键前后、值前、注释第二赋值、函数参数、LF/CRLF、正常候选在前时整文件撤销，保留已有空格/tab允许与拒绝配对。修复后重跑现有定向、全量与人工三入口。

## 已核对的合同与实际限制

- `profile-scan-operations.ts:6–13`各操作恰好调用一次begin；`codex-profile.ts`恢复内部调用带同一context的规划helper。provider以WeakSet识别冻结模板/会话，复制输入字节；缺失、加载异常或伪造会话不启用M2。并发操作没有全局模板缓存。已有人工测试包含逆序完成、preview/apply重新加载及restore成功只加载一次。
- `device-cli.ts`四分支await，保留async公开类型；人工worker有八组延迟成功/失败，settle之前不完成/不输出。加载次数由操作测试与CLI调用次数分别证明，不把CLI mock当真实模板读取。
- `profile-secret-scan.ts`先保留Prefix/Bearer原文本发现，assignment单独组合，最后补回M13拒绝行。跨度逐项检查整数、边界、7字符api_key及与M13结果相同；长度及CR/LF位置先验。byte入口有效上下文.py才fatal UTF8，原payload不改。本次RY-M2-01发生在后续残留规则，不否定这些有限检查，但足以阻断整体复核。
- 原型解析器与组合层不是同一允许范围：注解参数等可能被原型识别，组合层仍弃权；不为覆盖真实四处扩大格式。本轮未读取真实模板或原文件。
- worker在动态导入生产链之前拦截外部调用；未知调用写入violation，业务catch不能清掉最终检查。自检后的显式reset只用于自检阶段。它是所列调用路径的测试替身，不是操作系统级任意代码沙箱。
- O06执行真实setup/inventory/restore代码，拒绝断言匹配`Unsafe secret value in MCP recovery entry unsafe`；安全控制达到拦截的defaultExecute。不是缺来源的错误冒充基础扫描。O05的单个危险MCP有零执行配对；混合批次仍不承诺全批事务性，不能由单条测试推得其他条目无副作用。
- 宿主SDK缺失和Node18历史全量失败单列；人工纯内容/工厂测试通过不能代表独立插件可加载或真实迁移完成。

## 执行记录边界

固定短目录独立clone；主对话只读其src/lib，用自己的脚本进行人工复现，不修改生产代码或原测试。正式probe wrapper隔离用户、应用、Codex、TMP/npm目录，删除两个workspace变量与NODE_PATH/NODE_OPTIONS，保存白名单执行前环境。`*-probe-commands.json`中各probe退出1是预期拒绝断言不满足，不是命令环境失败；wrapper本身记录完证据退出0，不替代子命令退出码。

初探第一次把Windows绝对路径直接传给Node --import，发生ERR_UNSUPPORTED_ESM_URL_SCHEME；改用file URL后运行。随后为补齐完整环境记录重放正式probe，原始早期结果本机保留，公开正式结果。Python AST验证仅人工字符串，不添加生产Python依赖。

惠普的npm误定位事件继续独立未解决：未保存其用户目录操作前完整状态，本轮未触碰或代恢复惠普文件。荣耀消费者必须以自身独立前缀、private manifest及无宿主SDK的祖先链取证，不沿用惠普受污染的中间安装结果。

M2真实四处、HP-006、HP-022/023、172未知项、RY-03，以及兼容性与惠普环境事件继续保留。HP-03、HP-04和迁移未完成。

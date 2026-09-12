# 荣耀 M13 独立审查

对象ec827170ec24d78fd27e213d3cc3ff1d678a6377，输入交接eb620a67169d6f8672e4ab5af7ea1deb7c8e334b。修复提交4文件：profile-expressions.ts、profile-secret-scan.ts、profile-secret-scan-m13.test.ts、secret-scan-m0.test.ts。生产改动仅前两文件。

## 已核对范围

11处历史候选对应形式为Python args.api_key 7处、api_key=os.environ.get大写变量名加空默认值2处、调用参数中精确your-api-key 2处。它们只代表实现形式，不代表真实文件采集通过。

HP-001(PHP)、HP-004/005(Ruby)、HP-007/008(TypeScript)共5处API示例继续暂缓，不得因Python实现通过销账。M2与172项未知来源继续保留。

M0测试改为基础assertNoSecrets拒绝原文、profile层继续拒绝M2，符合基础规则与新profile允许语法分离；其余M0拒绝测试没有删除。这个调整本身不是发现的缺陷。

代码按token掩码保留原始换行，注释没有进入掩码；已知token前缀和Bearer先扫未掩码文本。现有定向覆盖Python跨行回退、拼接、元组、闭括号、邻接字面量、注释凭据、行号以及人工三入口副作用保护。它们不证明未覆盖的续行操作都安全。

## RY-M13-01：JS合法跨行逻辑与被误当终止（高优先级）

位置：src/lib/profile-expressions.ts的terminated换行分支（约第100–108行）；其following前缀拒绝集合未包括逻辑与的&。assertProfileContentSafe会据此掩码第一行的敏感赋值，第二行的普通长字面量又没有字段名，基础赋值规则因此漏检。

人工示例：

```javascript
const token = process.env.KEY
  && "SYNTHETIC_NONEMPTY";
```

这是合法JavaScript表达式；环境值为真时token得到人工非空字面量，不能当作纯环境引用。示例不含真实凭据。主对话只读probe观察跨行&&放行、同一行&&拒绝、跨行||拒绝；主工作树相关源码已与修复SHA核对一致。初次probe因Windows ESM导入URL格式失败，改为file URL后实际运行成功，导入失败不算漏洞证据。

固定clone的独立复现、语法确认及三入口结果见附加probe记录；测试命令与退出见README。此问题属于受保留JS环境表达式的拒绝保护，不是要求提前支持5处暂缓M3候选。

## 处理范围

本轮只复核，不修改生产代码。惠普下一轮先为合法&&续行及三入口加入失败复现，再最小修正表达式终止条件，并核对其他合法续行操作的完整边界；不能只用已有样本全绿来证明拒绝列表完整。保持Python11处范围与5处暂缓，不借此扩大允许集合。

修复后重新运行原56项、附加红测、相关入口与完整npm test，独立提交并交荣耀复核。仅在该问题解决后再推进5处其他语言占位符的受限实现；先做逐语言完整字面量/位置/相邻表达式红测，不使用整行或文件白名单。

RY-03保持阻断，不重复来源搜索，不改真实链接。真实采集、安装、恢复、私有往返与整体迁移均未执行。

# 扫描组合及原始位置合同

现状不是对绝对原文C做所有规则：profile-secret-scan.ts先精确替换两种ghp文档示例，再运行扫描。为保持M0/M13行为，明确保留这个既有例外，不新增或扩大它。

1. C为完整未归一化输入；D仅执行当前ghp_your_github_token / ghp_your_new_github_token精确边界的等长替换。禁止整行跳过。
2. 先在D上收集known-token-prefix和authorization-bearer；这份文本没有M13/M2掩码。即使模板恰好匹配了含前缀/Bearer的说明，也不得让M2移除这些发现。
3. 保持recognizeProfileExpressions(D, source)返回的normalized和rejectedLines，含PHP/Ruby、TS及既有M13拒绝保护。不要让M2先改它的解析输入。
4. M2独立解析C与冻结context，不使用D或M13.normalized来批准文档。只有.py和完整有限格式才可能返回api_key的7个UTF16单元跨度；未知归属/候选后错误则整个文件M2跨度清空。
5. 先防御性检查M13归一化结果与输入UTF16长度及每个CR/LF位置一致；异常不得应用M2。再检查全部M2跨度：整数、界内、长度7、C切片恰为api_key、不含换行、无相互重叠。若对应M13.normalized切片已变化，保守弃权全部M2跨度，不据两份变形文本重新解析或扩大区间。完整核对成功后，才在M13.normalized副本对这些位置填7个空格。
6. 对该最终副本仅收集sensitive-assignment，再并入步骤2发现和所有M13 rejectedLines；M2不能删除拒绝行。按既有line及rule顺序排序/去重，原始行号不变。M2说明正文、注释、邻接赋值保持可见。

“M2弃权”只撤回M2允许，不撤销M13已验证规则，也不自动产生安全通过。若未识别内容本来触发基础规则就必须拒绝；未触发规则则不能把“零M2跨度”冒称新增凭据检测能力。未确认来源172项不因这次组合获得豁免。

测试必须分别覆盖：无模板时原行为相等；同文件M13允许＋M2允许；M13拒绝与M2同一原始行的强制拒绝；M2说明/注释中的人工前缀和Bearer；7字符以外的邻接赋值；LF/CRLF、非BMP前缀；M2边界非法导致全部跨度撤销但原始发现仍保留。

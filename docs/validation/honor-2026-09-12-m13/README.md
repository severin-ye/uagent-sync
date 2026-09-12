# 荣耀M13独立复核：未通过

输入交接eb620a67169d6f8672e4ab5af7ea1deb7c8e334b；固定验证源码 **ec827170ec24d78fd27e213d3cc3ff1d678a6377**。

**原定自动测试全绿，但RY-M13-01附加复现证实跨行逻辑与漏检，并能穿过采集、隔离恢复及publish扫描。不能标记M13完整复核通过。**

## 运行结果

全新clone --no-hardlinks --no-checkout并detached checkout目标SHA；相关4文件范围已核对。用户/Codex/应用/TMP/TEMP/npm配置缓存隔离，顶层UAGENT_SYNC_WORKSPACE_ROOT取消，OPENCODE允许测试覆盖fixture。[命令与退出](commands.json)、[隔离](isolation.json)、[结果](RESULT.json)。

| 项目 | 退出码 | 结果 |
|---|---|---|
| npm ci --ignore-scripts --no-audit --no-fund | 0 | 仅独立源码依赖 |
| npm run build | 0 | 构建通过 |
| 三个定向测试文件 | 0 | 56/56，失败0 |
| npm test（含pretest构建） | 0 | 474/474，85 suites，失败/取消/跳过0 |
| 人工语法对照probe | 0 | JS语法可解析；跨行&&未拒绝，同行&&与跨行逻辑或拒绝 |
| 三入口确认probe | 0 | 确认缺陷仍存在：快照已创建、人工字节已恢复、到达mock Git门槛，网络未调用 |

probe退出0表示诊断脚本执行成功并确认上述观察，**不是安全验收通过**。主对话追加严格断言以排除“其他错误也被误当未阻断”：采集必须有manifest、恢复必须字节相同、发布必须恰到mock门槛且无.git目录。详见11-confirmed-gates.log及[m13-three-gates-confirmed.mjs](m13-three-gates-confirmed.mjs)。

## 缺陷、范围与下一步

[REVIEW.md](REVIEW.md)给出位置、原因和最小人工示例。11处Python形式有原定测试支持，但存在整体profile拒绝保护缺口，不声称11处真实文件通过。5处HP-001/004/005/007/008继续暂缓；先修RY-M13-01，再考虑逐语言占位符测试和实现。

惠普下一轮先在该固定源码增加合法跨行&&拒绝红测及三入口配对，再收紧完整表达式终止边界。保持原56项、11/5范围、注释/原始行号保护；必要完整回归通过后给独立修复SHA并交荣耀复核。不要用单纯扩大放行/删除失败测试解决。

## 复现与证据边界

两个mjs是人工诊断材料，不是正式测试修复。将其复制到新的验证根，其下repo为固定SHA已构建clone，按isolation.json映射全新临时目录后执行node；confirmed脚本的临时子目录须尚不存在。它会创建人工快照和隔离恢复文件，Git始终mock，不得指向真实用户根。源码导入相对./repo/dist。

惠普公开材料的22项校验和已核对；commands、RESULT、candidate-scope、isolation、detect-all及最终日志已读取。主对话只读审查工作树src/test/scripts/package及lock与修复SHA一致。惠普HIGH影响分析为其执行证据，荣耀本地图未找到新符号，不能冒称重新完成图分析；本轮没有修改生产符号。

独立clone构建后仅src/dashboard/i18n.js显示生成状态，未提交。原始日志留荣耀TEMP，公开日志用户路径/token形态脱敏并归一化尾部空白，原日志摘要保留。没有读取/采集真实Skill或修改真实配置记忆链接，没有设备插件安装或真实恢复。

RY-09记录阻断，HP任务状态不代改。RY-03、M2、172项未知来源及完整快照、插件联动安装、真实恢复、私有往返、双向同步、大文件迁移等继续未完成。测试通过不等于迁移完成。

# 接入范围、必要输入与实施门槛

## 提议范围

新增profile-m2-docstrings.ts（原型有限识别移植）、profile-m2-provider.ts（封闭schema/品牌/冻结session）、profile-scan-operations.ts（async操作工厂）。修改profile-secret-scan.ts纯结果/包装组合、codex-profile.ts内部session传递及同步兼容包装、device-git-transport.ts内部scan传递、entrypoints/device-cli.ts宿主工厂适配；package.json/lock在明确批准后增加固定生产依赖。必要时单独的内部payload解码helper归入同一profile范围。

不改基础secret-scan.ts或其src/sync.ts导出语义，不扩profile-expressions/PhpRuby规则，不改Codex扩展恢复业务逻辑，不引入新模板CLI/环境/manifest字段，不扫描或修链接，不改原型历史附件。测试可扩Codex调用者回归；生产部署/安装/真实恢复不在范围。

实施前需对上述每个实际修改符号运行impact并报告风险，对抽取同步helper的所有调用者复核；本文静态调用核对不替代未来修改前impact。每次提交前detect_changes，红态只留隔离证据；必要检查通过后独立修复提交，报告另提交。

C2确定为导入前独立测试进程拦截，详见[定稿](../hp-2026-09-13-m2-integration-final/README.md)。只新增test/helpers/m2-external-sandbox.ts、test/fixtures/m2-operation-worker.ts及入口测试，不新增workspace/state/run/codex-restore生产接缝。未匹配调用必须使测试失败，不得真实回落。C1要求CLI等待延迟成功/失败；C3只覆盖扫描拒绝。

## 门槛分阶段

| 阶段 | 进入条件 | 完成证据 |
|---|---|---|
| S0 范围复核 | RY-16已接受且C1–C3已纳入 | S0已收敛，见范围定稿；没有新分歧不再重复复核，等待明确实施指令 |
| S1 人工生产接入红测 | 用户另行明确授权生产接入；S0结论收敛 | 独立源码固定SHA；新增I/O组合真实断言失败与已过拒绝回归分列，尚未存在接口导致import失败不算安全红测；不得提前真实模板准备 |
| S2 最小实现与生产回归 | S1有效红态、impact完成 | 有限接口/依赖实现；原扫描与所有新组合门槛通过；包依赖/SDK缺口如实阻断，不靠扩大格式取得通过 |
| S3 荣耀独立复核 | 独立源码及脱敏证据已推送 | 固定源码双运行时及打包/人工入口复核。此时仍不等于真实四处覆盖 |
| S4 真实模板及只读验收另行范围 | 已审核正文/来源、获授权操作者、私有位置、宿主交付与启用方式均明确；用户另行授权 | 才讨论真实读取/只读复扫；不默认启用采集或迁移。本轮不执行 |

## 目前最小缺失输入

人工接入目前只缺用户新的明确实施授权；荣耀复核及C1–C3合同定稿已完成，不需要真实D正文。真实启用还缺私有provider部署方式与上述本机输入；公开仓库不得出现原说明或用短文本摘要代替安全脱敏。隔离宿主首轮固定现有lock的plugin及SDK 1.18.15；omit-dev消费者与提供宿主SDK的plugin导入分开验证。依赖缺口出现后记录具体失败，不预先授权依赖分类调整。

保守格式缺口：摘要、多行说明、复杂返回类型、嵌套/未知段落、同一行结束引号、tab布局及FormatString等仍弃权。82/82及8/8不能证明真实四个M2候选所在完整文件满足这些条件；本轮没有核查其真实布局。任何未来兼容扩展应有新范围、先行拒绝与允许配对，而不是在真实文件失败后临时放宽。

持续阻断：M2四处、HP-006、HP-022/023、172未知来源、RY-03；HP-03、HP-04、真实资料恢复/安装/双向同步/大文件迁移未完成。

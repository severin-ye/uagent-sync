# 根 Node engines 一致性修复

本批基于源码基线 `14a90c1`，对应生产源码 `ce6780faa0995c3c3587658aa46a161b4b5e4bcf`。范围只包含根 `package.json`、`package-lock.json`、Node 兼容说明、对应配置测试和本脱敏报告；未修改 TODO/CLOSEOUT、生产源码、真实配置或记忆，也未提交或推送。

## 修改

- 根 `package.json` 与锁文件根包的 `engines.node` 从 `>=18` 对齐为 `^22.22.2 || ^24.15.0 || >=26.0.0`。
- 依赖版本、resolved、integrity 和依赖声明保持不变，证据见 [dependency-version-check.json](dependency-version-check.json)。
- [NODE-COMPATIBILITY.md](../../NODE-COMPATIBILITY.md) 改为说明已对齐的严格安装边界，并保留 Node18 历史行为证据不外推为安装支持。
- [package-metadata.test.ts](../../../test/package-metadata.test.ts) 锁定 manifest 与 lockfile 根 engines 必须一致。

## 验证

- 配置红测：退出码 1，旧 `>=18` 被断言拒绝，见 `logs/red-config-assertion.log`。
- 配置绿测：退出码 0，见 `logs/green-config-assertion.log`。
- 静态锁文件引擎区间：退出码 0；Node18/20/22.22.1/24.14.0 被 `ini` 或 `toml` 阻断，22.22.2、24.16.0、24.19.0、26.0.0 无声明阻断，见 [engine-ranges.json](engine-ranges.json)。
- 隔离当前 Node 全量 `npm test`：退出码 0，85 suites、856 pass、0 fail、0 cancelled，见 `logs/full-npm-test-clean-temp.log`。第一次使用仓库内临时目录导致既有 ignored-fixture 测试触发祖先污染保护，退出码 1；随后改用仓库外专用临时根重跑并通过，首跑证据保留在 `logs/full-npm-test.log`。
- engine-strict 消费者：先创建 private manifest，再用明确 `--prefix` 安装打包产物，安装退出码 0；生产包 import/config smoke 退出码 0；祖先目录安装前后均无 `uagent-sync` 或 `@opencode-ai/plugin`，见 [consumer-engine-strict.json](consumer-engine-strict.json)。

Node18 本批未执行严格安装或全量测试：它不满足已对齐的安装声明，既有 Node18 行为证据仍由历史报告保留。

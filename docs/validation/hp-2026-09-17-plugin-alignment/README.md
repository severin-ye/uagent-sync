# 惠普插件版本对齐：知行固定2.0.1

本批知行已从1.16.0实际升级为2.0.1，安装版核心检查通过；两机全插件内容等价、Hook信任及全部业务仍未完成。

## 来源和安装

既有可信私有仓库 `severin-ye/Severin-skill` 的固定发布提交 `ddc1dc26a64e47dba7531586417df331fc16d49c`，不是跟随latest。后续main的Board改动未混入。发布记录中的荣耀ZIP摘要为 `e163526eb156ea495dbb1194352b272e7e5001d1dedb918a72fbce18c2fa23a1`，本机没有收到该ZIP；从固定源码既有构建产物按原发布清单导出243文件，安装缓存逐份一致。HP清单与tree摘要保留私有，不能称两机原ZIP已字节对齐。

沿用 `severin-skill@hp-fixed-20260915` 身份，以新版本目录作为本地marketplace源，经正式 `codex plugin add` 安装。运行中的旧源无法重命名，因此保留旧源，不覆盖其文件。清理本轮新建嵌套副本被自动审批审核拒绝，该副本未作为新插件入口，保留待后续合法清理。

## 验收与未通过项

- 新宿主：知行2.0.1，17个Skill启用，MCP版本2.0.1、3工具、面板资源可读。没有旧知行重复Skill入口。
- 243文件与本机固定源码导出包一致。配置、AGENTS、设备身份、两个记忆索引摘要不变；没有导入荣耀配置、认证或信任。未发现单独运行状态文件不等于历史无数据，插件ID未改变。
- TypeScript编译、Node9/9、源码包与安装缓存的隔离运行门禁通过。科研schema依赖原缺失，补充用户级jsonschema4.23.0及所需新增依赖；实际py -3校验通过。
- 原npm test因隔离环境缺py/Store Python启动109失败，保留记录；改用显式解释器运行对应版本/编译/Node/包检查，不冒称原npm test通过。
- Python非浏览器254通过、1项既有跳过；实际安装缓存的Windows注册Hook命令在人工PLUGIN_DATA中通过（1测试覆盖PowerShell/CMD两种处理器命令）。这不授予宿主信任。
- HTML批注6项在setUpClass的Edge启动处受阻；补依赖及有界环境恢复后仍未执行断言。记录为未验收，不称产品红测或全量通过。
- 新宿主13个Hook仍untrusted。惠普可运行Codex交互终端后输入 `/hooks`，在具体处理器页核对来源 `severin-skill@hp-fixed-20260915`、实际2.0.1路径与命令后逐项审核；不要直接信任全部，不修改trusted_hash。本机CLI为0.154.0-alpha.6.2；具体按键以界面提示为准。

## 其他插件集中结果

| 分组 | 惠普观察 | 对齐判断 |
|---|---|---|
| U同步 | 正式2.2.0；旧回退包入口禁用 | 已对齐，复用上一批固定包验收 |
| 知行 | 固定2.0.1已安装 | 版本追平；荣耀原243文件清单待比对，Hook/浏览器/C2C业务未全验收 |
| AutoDL | 1.0.1；固定源码32文件中31相同，唯一.mcp.json为已知HP Windows启动适配；26工具可发现 | 源码版本对齐，账户业务未验收；不覆盖本地适配 |
| documents/pdf/spreadsheets/presentations/template-creator | 26.909.11809 | 与9月14日荣耀旧清单版本相同；当前两机字节/业务未验收 |
| sites/visualize/codex-app-tools | 0.1.70 / 1.0.37 / 0.1.4 | 与旧清单版本相同，未证明最新内容等价 |
| computer-use/browser/chrome/unified-computer-use | 26.908.70816 | 高于旧清单26.908.40834，不降级；待荣耀当前宿主清单 |
| 惠普其余连接器及开发插件 | 已保留现有状态 | 荣耀旧清单未覆盖，来源/当前目标缺失，未验收 |
| superpowers/ponytail/旧severin-research及24停用项 | 不激活 | 不据旧清单重新安装或启用 |

除已处理的知行外，没有足够当前证据证明其他在用插件需要升级。旧清单不能作为卸载依据。知行C2C是外部独立依赖，本机检查的PATH及2_Business根未找到对应CLI/checkout，缺其固定来源/版本与连接验收；不复制荣耀OAuth。

## 持续同步缺口

见 [实际源码入口](SYNC-SCOPE.md)。`update --target-agent codex --components plugins`不更新这些Codex插件；`sync`硬编码更新U同步本体。export/profile只传配置/元数据，排除cache/runtime/trust；setup虽有远端marketplace/plugin add，但hp-fixed本地源被标为runtime-managed并跳过。本批是手工固定版本升级，尚无知行及所有插件的持续固定版本跨机安装与验收闭环。没有在本批扩写该机制。

133离线、207研究父子版本、24停用边界不变；未重跑930、重收7415或marker往返。HP-03、HP-04及完整环境迁移仍未完成。

私有回执 main 已推送并核实：`c03abd9b7cb844e1d30f724ceb266ff6d5731f09`，目录 `handoffs/hp-honor-20260917-plugin-alignment/`。本批无U同步生产代码修改。

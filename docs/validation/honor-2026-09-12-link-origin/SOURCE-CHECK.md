# RY-03 来源核验：有归档候选，仍不能证明旧链接版本等价

## 范围与停止边界

2026-09-12荣耀只读取证：子代理12次定向查询，范围为两份指定安装记录、父仓精确旧路径Git历史、Severin-skill已有归档及关联维护记录、当前候选文件树、链接元数据。主对话追加3次归档清单结构/逐项摘要核查，不解压、不写原件。未全盘递归，未搜索所有聊天或所有备份，不将本次未找到表述为全机不存在。到此停止重复来源搜索。

路径以`<USER_ROOT>`代替用户目录，`<WORKSPACE>`表示其Codelib-severin。仓库/归档内容及个人快照未上传。

## 可复核观察

| 对象 | 本轮观察 | 证明边界 |
|---|---|---|
| `<USER_ROOT>/.agents/skills/research-skill.legacy-broken-20260826` | SymbolicLink；目标为`<WORKSPACE>/2_Business/Severin research skill/research-skill`且不存在；查询前后类型/目标未变，mtime为2026-08-25T04:27:12Z | mtime和名称不是版本标识；未修改链接 |
| `.agents/.skill-lock.json`及`usync-dotfiles/state/install-log.json` | 没有定位到旧research-skill来源条目 | 不能用其他第三方研究Skill条目替代 |
| 父仓精确旧路径的Git历史 | `--all`范围未找到该路径记录 | 仅指本地已有引用，不证明不存在外部备份 |
| `2_Business/Severin-skill/sources/archive/severin-research-2026-09-05.zip` | 在提交`b56d2d1ecd759e75cfcb430e6bc45e4741e6324d`纳入；相关维护文档称源于旧Severin research skill | 文档来源叙述与可核对归档并存；尚无证据绑定到失效链接当时确切版本 |
| `sources/research-archive.json` | 136项，包含path/sha256/bytes；主对话在内存读取ZIP核对所有136项大小、摘要及完整成员集合，全部通过 | 证明归档与该清单一致，不证明清单与8月旧链接内容一致 |

ZIP SHA256：`dc5f2cf8de3664243f974269b6eb7c77e9f462b8db875ce4eb904463cec4960a`。
清单文件SHA256：`7ffc532d28138b77a826858fc9f9233dae7c268f095a386982b1a2451f54294e`。
摘要核查命令为Python标准库zipfile/hashlib，只读内存、不解压，退出0。这里只发布元数据，原ZIP和清单仍留本机原仓库。

## 当前Skill不是精确等价副本

归档中旧`skills/research-skill`有92个普通文件。当前候选`skills/severin-research-skill`所属本地HEAD为`de3294a200a35485d35e71e695e357c778ed694f`，该Skill Git tree为`c749f3a48611d50485c938b898836ece1cbdb29d`，候选跟踪路径干净。

按旧路径映射比较：75文件内容相同、17不同（SKILL.md与16个schema）、0缺失；另2个新增源文件（references/governance-entry.md、workflows/idea-history.md）及7个忽略的__pycache__文件。此为子代理实际逐文件比较结果，主对话未重复整项比较。计数区分源文件与运行缓存，不能直接把当前目录整体作为旧版本。

可称当前Skill与归档有内容谱系关联、功能相似；不能称精确等价。更关键的是，9月归档与8月链接所代表版本之间，尚没有原始文件清单/版本记录可比，不能由文件夹同名或维护文档直接补出该关联。

## 阻断与最小输入

RY-03保持**阻断**，不是“找到ZIP即可恢复”。二选一的最小后续输入为：

1. 提供旧链接原目标的可定位版本或备份（仓库提交/归档及文件清单），用于与已找到归档建立内容等价关系；不要求用户重新给出本机已知路径。
2. 若原版本无法提供，用户明确选择以本次已核对摘要的9月归档作为新的恢复基线。这属于选择替代版本，不是证明旧版本等价，也不自动授权本轮真实写入。

若选择当前Severin Skill作为替代，则另需明确接受17处内容变化和2个新增源文件，仍不能算等价搬运。未获上述信息前，不改指向、不删除链接、不实体化到真实Skill目录。

即使来源确认，仍须先在新临时目录验证完整普通文件树的资源/相对引用、两个不同用户根的采集恢复及清单摘要；本轮没有执行该实验。现有链接拒绝保护保持，未来链接映射功能不进入M0/M1/M3。

来源阻断不妨碍惠普下一轮独立执行HP-03-M0-R/F/V。当前仍有扫描未知项、插件安装、完整快照、真实恢复及双向同步等迁移项目未完成。

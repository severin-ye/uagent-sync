# RY-11 PHP/Ruby 独立复核

复核源码 e3153d9075bfc19219071e3cfd87a5f7ed2ab38f，基线 c96ee5bb130ad89e31f3d37724161c6ac80c2983。生产与测试差异仅四文件：新增专属词法模块与测试、接入 profile-expressions、调整旧 five 测试。文档差异另行保留，不混作源码。

## 已核对的范围

- PHP 与 Ruby 各自词法处理，未复用 JS/Python 词法别名放行。整段 token 数量、变量/构造调用/参数/括号/结束符精确匹配；仅精确单双引号 your-api-key 掩码，保持 14 个 UTF-16 单元长度和原文前后内容。
- .php/.rb 整文件或闭合的对应 Markdown fence 为识别区；整个区多语句、import/require、附加字段、不同方法、拼接/回退、未闭合均弃权拒绝。真实 Skill 的复杂区域不能套用单语句允许结论。
- PHP 开标签边界、注释中关闭标签、heredoc/nowdoc、Ruby 百分号/文档块、插值、转义、续行、嵌入字符串/示例的拒绝有明确词法或整体模式边界及测试。没有运行 PHP/Ruby 解释器，本轮审查不证明所有语言语法都被识别。
- LF/CRLF、非 BMP 前缀、原始长度与行号保护由原测试覆盖；补充对照也记录注释原文和总长度未变。
- 旧 five 删除的是两条“原形暂缓”拒绝断言，新增 PHP/Ruby 原形允许红绿测试接管；其余拼接、heredoc、百分号等拒绝断言保留。
- 原 PHP/Ruby 三入口允许/拒绝配对包含采集、恢复、publish；允许 publish 仅进入 mock Git，不触发真实 Git/网络。原有拒绝配对通过不覆盖下述新反例。

## RY-PR-01：注释键名检查不一致（本轮复核不通过）

位置：src/lib/profile-php-ruby.ts 第 101 行的 parsed.comments 扫描。正则区分大小写，且键名范围比 secret-scan.ts 的大小写无关 api[_-]?key/token/secret/password/authorization 更窄。

人工内容均为 SYNTHETIC_NONEMPTY：安全构造语句后第二行加 PHP `// PASSWORD=("SYNTHETIC_NONEMPTY")` 或 Ruby `# PASSWORD=("SYNTHETIC_NONEMPTY")`。小写 password 触发 sensitive-assignment@2；大写 PASSWORD、authorization、api-key 未触发。这是本轮有界反例，不是实际凭据。

根因边界：危险尾部单独在旧基线也漏检，因为基础赋值正则不越过值前括号；旧组合文件由占位符阻断，本轮允许原形后组合改变为放行。掩码只改安全占位符，危险尾部原文仍在。不能写成“掩码删除了真实值”或“本轮首次引入所有注释漏检”。

compare.json 保存两语言、四键、LF/CRLF共16项对照。three-gates.test.ts/log 将大写反例送入三入口并独立记录全部拒绝与副作用断言；失败日志保留为补充证据，不覆盖178/596的既有测试结果。

## 下一轮最小任务（交惠普实施，未代勾状态）

| 事项 | 现在是什么样 | 准备改成什么 | 依据和理由 |
|---|---|---|---|
| HP-03-M13-PR-C 注释键范围 | 大小写与键名覆盖不一致 | 对齐基础扫描器的敏感键语义，保留专属词法和原始偏移 | 先红测 password/PASSWORD/混合大小写、authorization、api-key/api_key/apiKey，在两语言与换行格式中覆盖 |
| 拒绝副作用 | 新反例可能走过三入口 | 原允许配对继续通过，新反例拒绝且无产物/目标或基线变化/新增Git调用 | 红测要独立检查全部入口，避免第一项失败提前终止 |
| 范围与回归 | 单语句形式实现有边界 | 不扩多语句、import、PHP/Ruby复杂模式或占位符范围 | 定向七文件和全量回归通过后回传荣耀独立复核 |

M2、172项未知来源、RY-03、多语句真实文件及真实采集/安装/恢复/双向同步/大文件均未解决。本轮没有操作真实配置、记忆、原始报告或链接，也不以环境哈希未变冒称全机无并发变化。

## 执行环境与原始证据

叶代理首次 PowerShell 将 git clone 正常 stderr 判为失败，恢复后克隆及固定 HEAD 成功；随后未解析 npm.cmd 导致 install 退出1，叶代理按其恢复预算停止。主对话接管同一独立 clone，使用绝对 node 与 npm-cli.js，npm ci --ignore-scripts 及构建成功。该依赖安装只作用于临时 clone，不是插件安装。

主对话首轮全量595/596，唯一失败为深层隔离TEMP下本地Git对象路径 Filename too long；只缩短TMP/TEMP后重跑全量。保留首轮原始日志，不将环境失败混称扫描回归。执行前环境逐命令保存，UAGENT_SYNC_WORKSPACE_ROOT显式取消，OPENCODE冲突变量取消，测试可自行覆盖fixture。未输出整个宿主环境。

构建曾令隔离clone的dashboard/i18n.js被Git状态报告为修改，后续git diff为空（换行/索引刷新）；未修改受检扫描源码与测试，未清理该现象以伪造干净状态。最终状态与差异日志如实保存。主仓原有AGENTS/CLAUDE及其他未跟踪资料不进入提交。

公开wrapper中的本机路径已替换为USER_HOME标记，需要按隔离目录替换后执行；three-gates.test.ts使用仓库相对源码导入，可在固定源码副本中运行。全部例子是人工占位字符串，未读取真实Skill或凭据。

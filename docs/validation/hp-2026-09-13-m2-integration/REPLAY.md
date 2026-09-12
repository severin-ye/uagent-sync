# 荣耀独立复核操作范围

固定代码416120afbf2446463864e8292d1423e493055944；比较70428520228adcac3ac66a2cfb857667b7b69aed。不要把报告提交当成新的代码版本。

1. 独立短目录checkout，创建专用HOME/USERPROFILE、APPDATA、LOCALAPPDATA、CODEX_HOME、XDG_CONFIG_HOME、TEMP/TMP、npm cache/userconfig/globalconfig/prefix；记录白名单环境键，真正删除两个顶层workspace变量，允许fixture自己设置。安装依赖时明确--prefix指向checkout，不注册插件。
2. npm ci --ignore-scripts，然后npm run build和完整npm test。当前基线Node24.19.0；Node18.20.8须让npm及其子进程PATH都选中同一Node。Node18原全量失败须另列，不能删测试、跳过后声称全量通过。
3. 定向命令：node --import tsx --test test/profile-m2-composition.test.ts test/profile-m2-integration.test.ts test/profile-m2-operations.test.ts test/profile-m2-gates.test.ts test/profile-m2-parser.test.ts test/profile-m2-args.test.ts test/profile-m2-honor.test.ts test/profile-m2-honor-boundary.test.ts。115个runner测试；gates单项内含多组三入口、C1–C3及Codex调用者断言，不把内部assertion数冒称独立测试数。
4. 检查profile-m2-gates启动独立worker，拦截早于生产import。未知外部调用即使被业务catch捕获也使最终测试失败。全部输入、快照及目标都是人工fixture。O06必须证明基础扫描错误文本，不能仅凭错误里出现ID算通过。
5. npm pack使用独立输出；两个消费者先写private package.json，显式npm install --prefix <consumer> --omit=dev --ignore-scripts <tgz>。消费者祖先不能含宿主SDK，否则缺依赖结果会被污染。另一个消费者显式加plugin和SDK各1.18.15，不修改真实Codex配置。用consumer-check.mjs.txt人工脚本（复制为.mjs）分别验证两个运行时；--host仅用于宿主消费者。不调用插件配置hook，不运行真实Git/gh/安装命令。
6. 审查7字符跨度、原始行号、前缀/Bearer、M13拒绝保留和新增残留敏感赋值弃权。特别尝试None后第二敏感值、注释、跨行与大小写/别名；区别专属解析通过和生产组合仍弃权。任何新增漏洞先保留反例，不临时扩大允许格式。

日志路径中的<USER_HOME>/<CHECKOUT>/<BASELINE>/<PUBLIC_TEMP>为脱敏别名；请在自己的隔离目录替换，不照搬惠普路径。run-isolated.mjs.txt/runtime18.mjs.txt记录惠普实际运行方式，不是可无修改直接运行的跨机安装程序。

Node18对照已由惠普执行，荣耀只需核对或针对新增分歧复现，不要求重复无关172项分析。若新增证据推送，只更新荣耀状态，核实远端SHA并返回惠普提示词。未独立通过前不标HP-03/HP-04或迁移完成。

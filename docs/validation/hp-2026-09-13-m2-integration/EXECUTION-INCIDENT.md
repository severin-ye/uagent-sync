# 消费者隔离执行偏差：尚未恢复未知原状态

本轮首次消费者安装在空目录仅设置cwd，没有显式--prefix，也没有本地package.json。npm向上找到用户目录的包根，执行了两次install；日志分别显示added 7 / removed 36及added 27。它们退出0，但不能计为隔离验收通过。

受影响位置为<USER_HOME>/package.json、package-lock.json及node_modules。观察到manifest当前列有plugin/SDK 1.18.15和指向本轮人工tarball的uagent-sync。未保留操作前这三个位置的完整状态，不能证明已还原，也不能凭猜测删除或重建旧依赖。本轮保留现场、相关命令和日志，列为独立未解决项。公开不上传用户目录manifest、lock或其依赖内容。

未执行插件注册/配置hook或真实同步恢复；这不等于“真实环境完全未受影响”。之前“消费者安装已隔离”的假设撤回。这一操作偏差与M2程序测试、Node18兼容失败分开记录。

修正后的消费者先创建private package.json，并显式--prefix。由于用户目录的node_modules可能污染子目录模块解析，最终采用不位于该用户目录祖先链下的独立公共临时目录，核对其祖先没有目标SDK，再验证：纯omit-dev插件import确实报ERR_MODULE_NOT_FOUND；显式提供SDK后的消费者在两Node均可import。包不包含真实模板，未调用安装配置hook。

中间在用户目录下执行的prefix安装只算准备，不作为最终消费者隔离证据。尝试根目录新建临时消费者遇到访问拒绝，未更改权限；随后使用可写的独立临时位置。完整环境与命令记录保留。后续必须始终同时使用明确prefix和已创建的private manifest，并检查消费者祖先依赖，不能只依靠HOME隔离npm项目定位。

后续：在有可靠操作前证据或用户指定的目标状态之前，保持该偏差未解决；不把现有配置/依赖当成已恢复，更不据此宣称环境迁移完成。

# 本轮实际命令和证据

源码工作目录：%USERPROFILE%/AppData/Local/Temp/uagent-hp-revalidation-d076fff。Node 调用 npm-cli.js 等价于 npm 命令；日志为完整输出的脱敏副本。

## head

- 退出码：0
- UTC：2026-09-11T09:13:09.305Z
- USERPROFILE：%USERPROFILE%
- 命令：`git "rev-parse" "HEAD"`
- 日志：[logs/head.log](logs/head.log)

## npm-ci

- 退出码：0
- UTC：2026-09-11T09:13:09.357Z
- USERPROFILE：%USERPROFILE%
- 命令：`C:\node.exe "C:/node_modules/npm/bin/npm-cli.js" "ci"`
- 日志：[logs/npm-ci.log](logs/npm-ci.log)

## build

- 退出码：0
- UTC：2026-09-11T09:13:16.634Z
- USERPROFILE：%USERPROFILE%
- 命令：`C:\node.exe "C:/node_modules/npm/bin/npm-cli.js" "run" "build"`
- 日志：[logs/build.log](logs/build.log)

## device-help

- 退出码：0
- UTC：2026-09-11T09:13:23.107Z
- USERPROFILE：%USERPROFILE%
- 命令：`C:\node.exe "dist/cli.js" "device" "help"`
- 日志：[logs/device-help.log](logs/device-help.log)

## targeted

- 退出码：0
- UTC：2026-09-11T09:13:23.564Z
- USERPROFILE：%USERPROFILE%
- 命令：`C:\node.exe "--import" "tsx" "--test" "test/offline-workspace-copy.test.ts" "test/codex-profile.test.ts"`
- 日志：[logs/targeted.log](logs/targeted.log)

## test-real

- 退出码：0
- UTC：2026-09-11T09:13:30.600Z
- USERPROFILE：%USERPROFILE%
- 命令：`C:\node.exe "C:/node_modules/npm/bin/npm-cli.js" "test"`
- 日志：[logs/test-real.log](logs/test-real.log)

## typecheck

- 退出码：0
- UTC：2026-09-11T09:15:44.808Z
- USERPROFILE：%USERPROFILE%
- 命令：`C:\node.exe "C:/node_modules/npm/bin/npm-cli.js" "run" "typecheck"`
- 日志：[logs/typecheck.log](logs/typecheck.log)

## c01-git-version

- 退出码：0
- UTC：2026-09-11T09:15:49.420Z
- USERPROFILE：%USERPROFILE%
- 命令：`git "--version"`
- 日志：[logs/c01-git-version.log](logs/c01-git-version.log)

## c02-npm-version

- 退出码：0
- UTC：2026-09-11T09:15:49.492Z
- USERPROFILE：%USERPROFILE%
- 命令：`C:\node.exe "C:/node_modules/npm/bin/npm-cli.js" "--version"`
- 日志：[logs/c02-npm-version.log](logs/c02-npm-version.log)

## c03-codex-version

- 退出码：0
- UTC：2026-09-11T09:15:49.690Z
- USERPROFILE：%USERPROFILE%
- 命令：`C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe "-NoProfile" "-Command" "codex --version"`
- 日志：[logs/c03-codex-version.log](logs/c03-codex-version.log)

## c04-register-real-paths-in-temp

- 退出码：0
- UTC：2026-09-11T09:15:52.780Z
- USERPROFILE：%USERPROFILE%
- 命令：`C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-d076fff\\dist\\cli.js" "device" "register" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\real-readonly-connection.json" "--registry" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\real-readonly-registry" "--remote" "https://github.com/example/private-registry.git" "--name" "惠普" "--workspace-id" "main" "--workspace-root" "%USERPROFILE%/Codelib-severin" "--user-home" "%USERPROFILE%" "--codex-home" "%USERPROFILE%/.codex"`
- 日志：[logs/c04-register-real-paths-in-temp.log](logs/c04-register-real-paths-in-temp.log)

## c05-real-full-snapshot

- 退出码：1
- UTC：2026-09-11T09:15:53.023Z
- USERPROFILE：%USERPROFILE%
- 命令：`C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-d076fff\\dist\\cli.js" "device" "snapshot" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\real-readonly-connection.json" "--output" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\hp-profile-full"`
- 日志：[logs/c05-real-full-snapshot.log](logs/c05-real-full-snapshot.log)

## c06-real-selected-snapshot

- 退出码：0
- UTC：2026-09-11T09:15:54.162Z
- USERPROFILE：%USERPROFILE%
- 命令：`C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-d076fff\\dist\\cli.js" "device" "snapshot" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\real-readonly-connection.json" "--components" "config,rules,memories" "--output" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\hp-profile-no-skills"`
- 日志：[logs/c06-real-selected-snapshot.log](logs/c06-real-selected-snapshot.log)

## c07-register-backup-target

- 退出码：0
- UTC：2026-09-11T09:15:54.432Z
- USERPROFILE：%USERPROFILE%
- 命令：`C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-d076fff\\dist\\cli.js" "device" "register" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\hp-backup-target-connection.json" "--registry" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\real-readonly-registry" "--remote" "https://github.com/example/private-registry.git" "--name" "本机备份隔离验证" "--workspace-id" "main" "--workspace-root" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\hp-backup-restore-target/work" "--user-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\hp-backup-restore-target" "--codex-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\hp-backup-restore-target/.codex"`
- 日志：[logs/c07-register-backup-target.log](logs/c07-register-backup-target.log)

## c08-local-backup-preview

- 退出码：0
- UTC：2026-09-11T09:15:54.682Z
- USERPROFILE：%USERPROFILE%
- 命令：`C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-d076fff\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\hp-backup-target-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\hp-profile-no-skills"`
- 日志：[logs/c08-local-backup-preview.log](logs/c08-local-backup-preview.log)

## c09-local-backup-restore

- 退出码：0
- UTC：2026-09-11T09:15:55.002Z
- USERPROFILE：%USERPROFILE%
- 命令：`C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-d076fff\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\hp-backup-target-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-revalidation-evidence-d076fff\\hp-profile-no-skills" "--apply"`
- 日志：[logs/c09-local-backup-restore.log](logs/c09-local-backup-restore.log)

## final-head

- 退出码：0
- UTC：2026-09-11T09:17:40.805Z
- USERPROFILE：%USERPROFILE%
- 命令：`git "rev-parse" "HEAD"`
- 日志：[logs/final-head.log](logs/final-head.log)

## source-diff

- 退出码：0
- UTC：2026-09-11T09:17:40.876Z
- USERPROFILE：%USERPROFILE%
- 命令：`git "diff" "--stat"`
- 日志：[logs/source-diff.log](logs/source-diff.log)

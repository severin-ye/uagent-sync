# Actual commands and exit codes

All commands ran in isolated source unless cwd below says otherwise. `node C:/node_modules/npm/bin/npm-cli.js test` invokes npm test directly, avoiding an initial cmd quoting failure. Original environment was never changed in the parent process. Logs retain complete output with credential-pattern redaction.

Initial acquisition/build (before command recorder):
- `git clone --branch codex/device-sync-validation --single-branch https://github.com/severin-ye/uagent-sync.git "%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source"`: exit 0; HEAD verified in source-head log.
- `npm.cmd ci`: exit 0; logs/npm-ci.log.
- `npm.cmd run build`: exit 0; logs/build.log.

## source-head — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:36:55.771Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `git "rev-parse" "HEAD"`
- Evidence: [logs/source-head.log](logs/source-head.log)

## original-checkout-before — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:36:55.827Z
- cwd: `%USERPROFILE%/Codelib-severin/2_Business/uagent-sync`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `git "status" "--porcelain=v1" "--untracked-files=normal"`
- Evidence: [logs/original-checkout-before.log](logs/original-checkout-before.log)

## device-help — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:36:55.890Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:\node.exe "dist/cli.js" "device" "help"`
- Evidence: [logs/device-help.log](logs/device-help.log)

## test-real-home — FAIL (harness/setup; retained and retried)

- Exit: 1
- Time (UTC): 2026-09-11T08:36:56.074Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:/Windows/System32/cmd.exe "/d" "/c" "npm.cmd test"`
- Evidence: [logs/test-real-home.log](logs/test-real-home.log)

## test-real-home-retry — FAIL

- Exit: 1
- Time (UTC): 2026-09-11T08:37:31.977Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:\node.exe "C:/node_modules/npm/bin/npm-cli.js" "test"`
- Evidence: [logs/test-real-home-retry.log](logs/test-real-home-retry.log)

## test-isolated-home — FAIL

- Exit: 1
- Time (UTC): 2026-09-11T08:39:58.376Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421/regression-home`
- Actual executable and argv: `C:\node.exe "C:/node_modules/npm/bin/npm-cli.js" "test"`
- Evidence: [logs/test-isolated-home.log](logs/test-isolated-home.log)

## typecheck — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:41:38.933Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:\node.exe "C:/node_modules/npm/bin/npm-cli.js" "run" "typecheck"`
- Evidence: [logs/typecheck.log](logs/typecheck.log)

## b01-register-alpha — FAIL (harness/setup; retained and retried)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:04.887Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "register" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha-connection.json" "--registry" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\registry" "--remote" "https://github.com/example/private-registry.git" "--name" "北斗" "--workspace-id" "main" "--workspace-root" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha\\work" "--user-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha" "--codex-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha\\.codex"`
- Evidence: [logs/b01-register-alpha.log](logs/b01-register-alpha.log)

## d01-utf8-no-bom-repro — FAIL

- Exit: 1
- Time (UTC): 2026-09-11T08:42:05.127Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe "-NoProfile" "-File" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\scripts\\copy-offline-workspace.ps1" "-ReportPath" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\offline-diagnostic\\utf8.json" "-TargetRoot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\offline-diagnostic\\utf8-target"`
- Evidence: [logs/d01-utf8-no-bom-repro.log](logs/d01-utf8-no-bom-repro.log)

## d02-bom-preview — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:07.060Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe "-NoProfile" "-File" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\scripts\\copy-offline-workspace.ps1" "-ReportPath" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\offline-diagnostic\\bom.json" "-TargetRoot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\offline-diagnostic\\bom-target"`
- Evidence: [logs/d02-bom-preview.log](logs/d02-bom-preview.log)

## d03-bom-copy — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:08.352Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe "-NoProfile" "-File" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\scripts\\copy-offline-workspace.ps1" "-ReportPath" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\offline-diagnostic\\bom.json" "-TargetRoot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\offline-diagnostic\\bom-target" "-Apply"`
- Evidence: [logs/d03-bom-copy.log](logs/d03-bom-copy.log)

## d04-bom-resume — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:09.756Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe "-NoProfile" "-File" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\scripts\\copy-offline-workspace.ps1" "-ReportPath" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\offline-diagnostic\\bom.json" "-TargetRoot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\offline-diagnostic\\bom-target" "-Apply"`
- Evidence: [logs/d04-bom-resume.log](logs/d04-bom-resume.log)

## d05-bom-overwrite-protection — PASS (expected refusal)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:11.204Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe "-NoProfile" "-File" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\scripts\\copy-offline-workspace.ps1" "-ReportPath" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\offline-diagnostic\\bom.json" "-TargetRoot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\offline-diagnostic\\bom-target" "-Apply"`
- Evidence: [logs/d05-bom-overwrite-protection.log](logs/d05-bom-overwrite-protection.log)

## d06-copy-mutation-protection — PASS (expected refusal)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:12.599Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe "-NoProfile" "-File" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\offline-diagnostic\\fault-injection.ps1" "-Script" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\scripts\\copy-offline-workspace.ps1" "-Report" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\offline-diagnostic\\race.json" "-Target" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\offline-diagnostic\\race-target"`
- Evidence: [logs/d06-copy-mutation-protection.log](logs/d06-copy-mutation-protection.log)

## b01-register-alpha-attempt2 — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:29.122Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "register" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha-connection.json" "--registry" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\registry" "--remote" "https://github.com/example/private-registry.git" "--name" "北斗" "--workspace-id" "main" "--workspace-root" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha\\work" "--user-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha" "--codex-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha\\.codex"`
- Evidence: [logs/b01-register-alpha-attempt2.log](logs/b01-register-alpha-attempt2.log)

## b02-register-beta — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:29.316Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "register" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\beta-connection.json" "--registry" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\registry" "--remote" "https://github.com/example/private-registry.git" "--name" "南星" "--workspace-id" "main" "--workspace-root" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\beta\\work" "--user-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\beta" "--codex-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\beta\\.codex"`
- Evidence: [logs/b02-register-beta.log](logs/b02-register-beta.log)

## b03-register-repeat — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:29.518Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "register" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha-connection.json" "--registry" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\registry" "--remote" "https://github.com/example/private-registry.git" "--name" "北斗" "--workspace-id" "main" "--workspace-root" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha\\work" "--user-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha" "--codex-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha\\.codex"`
- Evidence: [logs/b03-register-repeat.log](logs/b03-register-repeat.log)

## b04-rename — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:29.712Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "rename" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha-connection.json" "--name" "晨光"`
- Evidence: [logs/b04-rename.log](logs/b04-rename.log)

## b05-list — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:29.897Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "list" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha-connection.json"`
- Evidence: [logs/b05-list.log](logs/b05-list.log)

## b06-show — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:30.084Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "show" "晨光" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\beta-connection.json"`
- Evidence: [logs/b06-show.log](logs/b06-show.log)

## b07-snapshot-default — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:30.267Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "snapshot" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha-connection.json" "--output" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\b07-snapshot-default"`
- Evidence: [logs/b07-snapshot-default.log](logs/b07-snapshot-default.log)

## b08-preview-no-write — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:30.484Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\beta-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\b07-snapshot-default"`
- Evidence: [logs/b08-preview-no-write.log](logs/b08-preview-no-write.log)

## b09-initial-conflict-preview — PASS (expected refusal)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:30.690Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\beta-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\b07-snapshot-default"`
- Evidence: [logs/b09-initial-conflict-preview.log](logs/b09-initial-conflict-preview.log)

## b10-initial-conflict-apply — PASS (expected refusal)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:30.878Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\beta-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\b07-snapshot-default" "--apply"`
- Evidence: [logs/b10-initial-conflict-apply.log](logs/b10-initial-conflict-apply.log)

## b11-first-prefer-source — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:31.077Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\beta-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\b07-snapshot-default" "--apply" "--prefer-source"`
- Evidence: [logs/b11-first-prefer-source.log](logs/b11-first-prefer-source.log)

## b12-reverse-snapshot — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:31.310Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "snapshot" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\beta-connection.json" "--output" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\b12-reverse-snapshot"`
- Evidence: [logs/b12-reverse-snapshot.log](logs/b12-reverse-snapshot.log)

## b13-reverse-no-baseline-preview — PASS (expected refusal)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:31.530Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\b12-reverse-snapshot"`
- Evidence: [logs/b13-reverse-no-baseline-preview.log](logs/b13-reverse-no-baseline-preview.log)

## b14-reverse-no-baseline-apply — PASS (expected refusal)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:31.739Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\b12-reverse-snapshot" "--apply"`
- Evidence: [logs/b14-reverse-no-baseline-apply.log](logs/b14-reverse-no-baseline-apply.log)

## b15-reverse-manually-reconciled-preview — FAIL (harness/setup; retained and retried)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:31.954Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\alpha-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture\\b12-reverse-snapshot"`
- Evidence: [logs/b15-reverse-manually-reconciled-preview.log](logs/b15-reverse-manually-reconciled-preview.log)

## b01-register-alpha-attempt3 — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:46.435Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "register" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha-connection.json" "--registry" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\registry" "--remote" "https://github.com/example/private-registry.git" "--name" "北斗" "--workspace-id" "main" "--workspace-root" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha\\work" "--user-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha" "--codex-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha\\.codex"`
- Evidence: [logs/b01-register-alpha-attempt3.log](logs/b01-register-alpha-attempt3.log)

## b02-register-beta-attempt2 — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:46.645Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "register" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\beta-connection.json" "--registry" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\registry" "--remote" "https://github.com/example/private-registry.git" "--name" "南星" "--workspace-id" "main" "--workspace-root" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\beta\\work" "--user-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\beta" "--codex-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\beta\\.codex"`
- Evidence: [logs/b02-register-beta-attempt2.log](logs/b02-register-beta-attempt2.log)

## b03-register-repeat-attempt2 — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:46.828Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "register" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha-connection.json" "--registry" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\registry" "--remote" "https://github.com/example/private-registry.git" "--name" "北斗" "--workspace-id" "main" "--workspace-root" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha\\work" "--user-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha" "--codex-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha\\.codex"`
- Evidence: [logs/b03-register-repeat-attempt2.log](logs/b03-register-repeat-attempt2.log)

## b04-rename-attempt2 — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:47.012Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "rename" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha-connection.json" "--name" "晨光"`
- Evidence: [logs/b04-rename-attempt2.log](logs/b04-rename-attempt2.log)

## b05-list-attempt2 — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:47.194Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "list" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha-connection.json"`
- Evidence: [logs/b05-list-attempt2.log](logs/b05-list-attempt2.log)

## b06-show-attempt2 — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:47.374Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "show" "晨光" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\beta-connection.json"`
- Evidence: [logs/b06-show-attempt2.log](logs/b06-show-attempt2.log)

## b07-snapshot-default-attempt2 — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:47.566Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "snapshot" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha-connection.json" "--output" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b07-snapshot-default"`
- Evidence: [logs/b07-snapshot-default-attempt2.log](logs/b07-snapshot-default-attempt2.log)

## b08-preview-no-write-attempt2 — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:47.780Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\beta-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b07-snapshot-default"`
- Evidence: [logs/b08-preview-no-write-attempt2.log](logs/b08-preview-no-write-attempt2.log)

## b09-initial-conflict-preview-attempt2 — PASS (expected refusal)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:47.985Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\beta-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b07-snapshot-default"`
- Evidence: [logs/b09-initial-conflict-preview-attempt2.log](logs/b09-initial-conflict-preview-attempt2.log)

## b10-initial-conflict-apply-attempt2 — PASS (expected refusal)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:48.227Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\beta-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b07-snapshot-default" "--apply"`
- Evidence: [logs/b10-initial-conflict-apply-attempt2.log](logs/b10-initial-conflict-apply-attempt2.log)

## b11-first-prefer-source-attempt2 — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:48.424Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\beta-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b07-snapshot-default" "--apply" "--prefer-source"`
- Evidence: [logs/b11-first-prefer-source-attempt2.log](logs/b11-first-prefer-source-attempt2.log)

## b12-reverse-snapshot-attempt2 — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:48.703Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "snapshot" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\beta-connection.json" "--output" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b12-reverse-snapshot"`
- Evidence: [logs/b12-reverse-snapshot-attempt2.log](logs/b12-reverse-snapshot-attempt2.log)

## b13-reverse-no-baseline-preview-attempt2 — PASS (expected refusal)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:48.930Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b12-reverse-snapshot"`
- Evidence: [logs/b13-reverse-no-baseline-preview-attempt2.log](logs/b13-reverse-no-baseline-preview-attempt2.log)

## b14-reverse-no-baseline-apply-attempt2 — PASS (expected refusal)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:49.140Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b12-reverse-snapshot" "--apply"`
- Evidence: [logs/b14-reverse-no-baseline-apply-attempt2.log](logs/b14-reverse-no-baseline-apply-attempt2.log)

## b15-reverse-manually-reconciled-preview-attempt2 — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:49.342Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b12-reverse-snapshot"`
- Evidence: [logs/b15-reverse-manually-reconciled-preview-attempt2.log](logs/b15-reverse-manually-reconciled-preview-attempt2.log)

## b16-reverse-establish-baseline — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:49.547Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b12-reverse-snapshot" "--apply"`
- Evidence: [logs/b16-reverse-establish-baseline.log](logs/b16-reverse-establish-baseline.log)

## b17-reverse-second-snapshot — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:49.757Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "snapshot" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\beta-connection.json" "--output" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b17-reverse-second-snapshot"`
- Evidence: [logs/b17-reverse-second-snapshot.log](logs/b17-reverse-second-snapshot.log)

## b18-reverse-with-baseline-preview — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:49.981Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b17-reverse-second-snapshot"`
- Evidence: [logs/b18-reverse-with-baseline-preview.log](logs/b18-reverse-with-baseline-preview.log)

## b19-reverse-with-baseline-apply — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:50.176Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b17-reverse-second-snapshot" "--apply"`
- Evidence: [logs/b19-reverse-with-baseline-apply.log](logs/b19-reverse-with-baseline-apply.log)

## b20-both-changed-snapshot — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:50.381Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "snapshot" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\alpha-connection.json" "--output" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b20-both-changed-snapshot"`
- Evidence: [logs/b20-both-changed-snapshot.log](logs/b20-both-changed-snapshot.log)

## b21-both-changed-preview — PASS (expected refusal)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:50.609Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\beta-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b20-both-changed-snapshot"`
- Evidence: [logs/b21-both-changed-preview.log](logs/b21-both-changed-preview.log)

## b22-both-changed-apply — PASS (expected refusal)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:50.829Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\beta-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b20-both-changed-snapshot" "--apply"`
- Evidence: [logs/b22-both-changed-apply.log](logs/b22-both-changed-apply.log)

## b23-prefer-source-rejected-after-baseline — PASS (expected refusal)

- Exit: 1
- Time (UTC): 2026-09-11T08:42:51.044Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\fixture-complete\process-home`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\beta-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\fixture-complete\\b20-both-changed-snapshot" "--apply" "--prefer-source"`
- Evidence: [logs/b23-prefer-source-rejected-after-baseline.log](logs/b23-prefer-source-rejected-after-baseline.log)

## c01-git-version — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:59.833Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `git "--version"`
- Evidence: [logs/c01-git-version.log](logs/c01-git-version.log)

## c02-npm-version — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:42:59.886Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:\node.exe "C:/node_modules/npm/bin/npm-cli.js" "--version"`
- Evidence: [logs/c02-npm-version.log](logs/c02-npm-version.log)

## c03-codex-version — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:43:00.041Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe "-NoProfile" "-Command" "codex --version"`
- Evidence: [logs/c03-codex-version.log](logs/c03-codex-version.log)

## c04-register-real-paths-in-temp — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:43:07.477Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "register" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\real-readonly-connection.json" "--registry" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\real-readonly-registry" "--remote" "https://github.com/example/private-registry.git" "--name" "惠普" "--workspace-id" "main" "--workspace-root" "%USERPROFILE%/Codelib-severin" "--user-home" "%USERPROFILE%" "--codex-home" "%USERPROFILE%/.codex"`
- Evidence: [logs/c04-register-real-paths-in-temp.log](logs/c04-register-real-paths-in-temp.log)

## c05-real-full-snapshot — FAIL

- Exit: 1
- Time (UTC): 2026-09-11T08:43:07.692Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "snapshot" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\real-readonly-connection.json" "--output" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\hp-profile-full"`
- Evidence: [logs/c05-real-full-snapshot.log](logs/c05-real-full-snapshot.log)

## c06-real-selected-snapshot — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:43:08.608Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "snapshot" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\real-readonly-connection.json" "--components" "config,rules,memories" "--output" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\hp-profile-no-skills"`
- Evidence: [logs/c06-real-selected-snapshot.log](logs/c06-real-selected-snapshot.log)

## c07-register-backup-target — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:43:08.958Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "register" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\hp-backup-target-connection.json" "--registry" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\real-readonly-registry" "--remote" "https://github.com/example/private-registry.git" "--name" "本机备份隔离验证" "--workspace-id" "main" "--workspace-root" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\hp-backup-restore-target/work" "--user-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\hp-backup-restore-target" "--codex-home" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\hp-backup-restore-target/.codex"`
- Evidence: [logs/c07-register-backup-target.log](logs/c07-register-backup-target.log)

## c08-local-backup-preview — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:43:09.146Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\hp-backup-target-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\hp-profile-no-skills"`
- Evidence: [logs/c08-local-backup-preview.log](logs/c08-local-backup-preview.log)

## c09-local-backup-restore — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:43:09.448Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:\node.exe "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\source\\dist\\cli.js" "device" "restore" "--connection" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\hp-backup-target-connection.json" "--snapshot" "%USERPROFILE%\\AppData\\Local\\Temp\\uagent-hp-acceptance-20260911-173421\\hp-profile-no-skills" "--apply"`
- Evidence: [logs/c09-local-backup-restore.log](logs/c09-local-backup-restore.log)

## original-checkout-after — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:43:41.736Z
- cwd: `%USERPROFILE%/Codelib-severin/2_Business/uagent-sync`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `git "status" "--porcelain=v1" "--untracked-files=normal"`
- Evidence: [logs/original-checkout-after.log](logs/original-checkout-after.log)

## source-status-after — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:43:41.802Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `git "status" "--porcelain=v1"`
- Evidence: [logs/source-status-after.log](logs/source-status-after.log)

## dependency-audit — FAIL

- Exit: 1
- Time (UTC): 2026-09-11T08:43:41.867Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:\node.exe "C:/node_modules/npm/bin/npm-cli.js" "audit" "--json"`
- Evidence: [logs/dependency-audit.log](logs/dependency-audit.log)

## source-generated-diff — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:44:09.478Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `git "diff" "--" "src/dashboard/i18n.js"`
- Evidence: [logs/source-generated-diff.log](logs/source-generated-diff.log)

## windows-powershell-version — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:46:48.752Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe "-NoProfile" "-Command" "$PSVersionTable.PSVersion.ToString(); [Text.Encoding]::Default.WebName"`
- Evidence: [logs/windows-powershell-version.log](logs/windows-powershell-version.log)

## source-final-head — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:46:49.811Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `git "rev-parse" "HEAD"`
- Evidence: [logs/source-final-head.log](logs/source-final-head.log)

## source-final-diff-stat — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:46:49.862Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `git "diff" "--stat"`
- Evidence: [logs/source-final-diff-stat.log](logs/source-final-diff-stat.log)

## source-final-status — PASS

- Exit: 0
- Time (UTC): 2026-09-11T08:46:49.927Z
- cwd: `%USERPROFILE%\AppData\Local\Temp\uagent-hp-acceptance-20260911-173421\source`
- USERPROFILE: `%USERPROFILE%`
- Actual executable and argv: `git "status" "--porcelain=v1"`
- Evidence: [logs/source-final-status.log](logs/source-final-status.log)

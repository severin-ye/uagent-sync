# Codex 新电脑端到端重试指南

## 唯一入口

在 Windows PowerShell 中执行下面一条命令。它只需要 U同步和 dotfiles 两个仓库地址；脚本会自动安装或修复 Git、GitHub CLI、Node/npm、Codex CLI，随后构建、测试、打包、安装插件并恢复 Codex 环境。

```powershell
$ErrorActionPreference = 'Stop'
$script = Join-Path ([IO.Path]::GetTempPath()) 'uagent-bootstrap.ps1'
try {
  Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/severin-ye/uagent-sync/master/scripts/bootstrap.ps1' -OutFile $script -ErrorAction Stop
} catch {
  Write-Error "Bootstrap download failed: $($_.Exception.Message)"
  exit 1
}
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -UagentRepo 'https://github.com/severin-ye/uagent-sync' -DotfilesRepo 'https://github.com/severin-ye/usync-dotfiles' -TargetAgent codex
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

私有 dotfiles 尚未授权时，脚本会自动启动 GitHub 的浏览器登录；用户只需完成 GitHub 身份确认，不需要手工执行修复命令。认证、仓库不存在或权限不足会明确失败，不会继续伪报成功。

## 先看计划（不修改电脑）

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -UagentRepo 'https://github.com/severin-ye/uagent-sync' -DotfilesRepo 'https://github.com/severin-ye/usync-dotfiles' -TargetAgent codex -PlanOnly
```

计划和最终结果都包含 `ok`、`warnings`、`errors`、`skipped`、`targetAgent`。任何必需步骤失败均返回非零退出码。

## 失败后重试

直接重复同一条入口命令。进度保存在 `%USERPROFILE%\UagentWorkspace\.uagent-bootstrap-state.json`；已完成且通过真实版本检查的步骤会安全复用。下载和网络步骤执行有界重试，winget 失败会切换到当前用户的 portable 工具目录。

脚本会保存并复用经过验证的 npm `codex.cmd` 和 Node `npx.cmd` 入口，不会回退到 WindowsApps 假命令。Codex personal marketplace 已存在但版本陈旧时，脚本会先核验其 Git origin，再执行可重试的 fast-forward 更新。

每个 skill 仓库来源也会独立进行最多 3 次有界网络重试；每次安装命令结束后立即按规范化来源重新扫描全部 selected skill，只有来源一致且逐项齐全才成功。单次安装期间每 15 秒输出 heartbeat，默认 120 秒超时，并受来源级总时限约束。权限、认证、仓库不存在和无效 manifest 会立即失败；无诊断文本的 clone 失败仍可在限额内重试。进度终态明确为 `succeeded`、`failed` 或 `already-complete`。最终失败的完整脱敏明细保存在 `usync-dotfiles/state/recovery-reports/`，包括失败阶段、最后有效诊断、重试决定和原因；终端显示准确的 present/missing 数量及最多 3 个缺失示例。

不要删除状态文件，也不要手工复制旧机器配置。若确需从头验证，请使用新的 `-WorkspaceRoot`，保留原目录作为故障证据。

## 成功判据

最终验证必须同时满足：

- `codex plugin list --json` 中 `uagent-sync` 为 `installed=true` 且 `enabled=true`；
- 全局 `uagent-sync --version` 和核心 CLI 命令可运行；
- `state/workspace-state.json` 为 `targetAgent=codex` 且清单完整；
- 清单选中的 skills 均可见，Codex MCP（包括 runtime 管理项）均真实存在；
- 需要认证的 MCP 只保存变量名，最终验证要求对应环境变量已由用户安全配置；
- `codebase-memory-mcp` 不在配置中，tombstone 仍存在；
- OpenCode 配置未被检查、创建或修改；
- 输出和提交前 secrets 扫描没有发现密钥值。

安装完成后新建一个 Codex 任务，让新安装的 skills 进入新任务上下文。

## 独立复核命令

bootstrap 返回 0 后可直接运行；这些命令不修复状态，只做 Codex-only 验收：

```powershell
uagent-sync setup --target-agent codex --json
uagent-sync verify --target-agent codex --json
codex.cmd plugin list --json
```

预期 `setup` 与 `verify` 都返回 `ok=true`。setup 的 skill 结果应按 `existing-skill-source:<owner>/<repo>:skills=<count>` 聚合；不得逐项重复输出同一个来源。`codebase-memory-mcp` 必须显示为 absent，任何 active 配置都应让验收失败。

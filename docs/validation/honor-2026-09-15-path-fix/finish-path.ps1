$ErrorActionPreference='Stop'
$repo='C:\uagent-review\honor-path-fix'
$out=Join-Path $repo 'docs\validation\honor-2026-09-15-path-fix'
$iso='C:\uagent-review\honor-return-parent\path-final-isolation'
New-Item -ItemType Directory -Force -Path $out,$iso | Out-Null
$nodeExe=(Get-Command node.exe | Select-Object -First 1).Source
$npmExe=(Get-Command npm.cmd | Select-Object -First 1).Source
$env:USERPROFILE="$iso\home"; $env:HOME=$env:USERPROFILE; $env:CODEX_HOME="$iso\home\.codex"
$env:APPDATA="$iso\appdata"; $env:LOCALAPPDATA="$iso\localappdata"; $env:XDG_CONFIG_HOME="$iso\xdg-config"; $env:XDG_DATA_HOME="$iso\xdg-data"; $env:XDG_STATE_HOME="$iso\xdg-state"; $env:XDG_CACHE_HOME="$iso\xdg-cache"
$env:TEMP="$iso\tmp"; $env:TMP=$env:TEMP; $env:npm_config_cache="$iso\npm-cache"; $env:npm_config_userconfig="$iso\npmrc"; $env:npm_config_globalconfig="$iso\global-npmrc"; $env:npm_config_prefix="$iso\npm-prefix"
Remove-Item Env:UAGENT_SYNC_WORKSPACE_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:OPENCODE_SYNC_WORKSPACE_ROOT -ErrorAction SilentlyContinue
foreach($key in @('USERPROFILE','CODEX_HOME','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_STATE_HOME','XDG_CACHE_HOME','TEMP','npm_config_cache','npm_config_prefix')){New-Item -ItemType Directory -Force -Path ([Environment]::GetEnvironmentVariable($key)) | Out-Null}
[IO.File]::WriteAllText($env:npm_config_userconfig,'');[IO.File]::WriteAllText($env:npm_config_globalconfig,'')
$record=[ordered]@{node=$nodeExe;npm=$npmExe;USERPROFILE=$env:USERPROFILE;HOME=$env:HOME;CODEX_HOME=$env:CODEX_HOME;APPDATA=$env:APPDATA;LOCALAPPDATA=$env:LOCALAPPDATA;TMP=$env:TMP;TEMP=$env:TEMP;npm_cache=$env:npm_config_cache;npm_userconfig=$env:npm_config_userconfig;workspaceOverridePresent=(Test-Path Env:UAGENT_SYNC_WORKSPACE_ROOT)}
$record | ConvertTo-Json | Set-Content "$out\isolation.json"
Set-Location $repo
$test=[IO.File]::ReadAllText("$repo\test\codex-profile-path-mapping.test.ts")
$red=$test.Replace("'../src/lib/codex-profile.js'","'C:/uagent-review/full-batch-source/dist/lib/codex-profile.js'")
$redPath="$repo\test\path-baseline-replay.manual.ts"
[IO.File]::WriteAllText($redPath,$red)
$commands=@()
& $nodeExe --import tsx --test $redPath *> "$out\red.log"; $code=$LASTEXITCODE
$commands+=@{command='node --import tsx --test test/path-baseline-replay.manual.ts (imports fixed1056 dist)';exit=$code}
if($code -ne 1){throw 'Expected baseline assertion failure exit1'}
Move-Item -LiteralPath $redPath -Destination "$out\baseline-replay.txt"
& $npmExe run build *> "$out\build.log"; $code=$LASTEXITCODE
$commands+=@{command='npm run build';exit=$code}; if($code -ne 0){throw 'Build failed'}
& $nodeExe --import tsx --test test/codex-profile-path-mapping.test.ts test/codex-profile.test.ts *> "$out\focused.log"; $code=$LASTEXITCODE
$commands+=@{command='node --import tsx --test test/codex-profile-path-mapping.test.ts test/codex-profile.test.ts';exit=$code}; if($code -ne 0){throw 'Focused failed'}
& $npmExe test *> "$out\full.log"; $code=$LASTEXITCODE
$commands+=@{command='npm test';exit=$code}
$commands | ConvertTo-Json | Set-Content "$out\commands.json"
if($code -ne 0){throw 'Full failed'}
Write-Output 'PATH_FIX_CHECKS_COMPLETED'

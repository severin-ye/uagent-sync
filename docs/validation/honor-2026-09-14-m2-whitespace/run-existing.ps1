param([Parameter(Mandatory=$true)][string]$NodeExecutable,[Parameter(Mandatory=$true)][string]$Label)
$ErrorActionPreference='Stop'
$base=$PSScriptRoot
$env:HONOR_M2_SOURCE=Join-Path $base 'src'
$isolated=Join-Path $base ('probe-'+$Label)
foreach($pair in @(@('HOME','home'),@('USERPROFILE','home'),@('APPDATA','app'),@('LOCALAPPDATA','local'),@('CODEX_HOME','codex'),@('XDG_CONFIG_HOME','xdg'),@('TMP','tmp'),@('TEMP','tmp'),@('npm_config_cache','npm-cache'),@('npm_config_prefix','npm-prefix'))){$value=Join-Path $isolated $pair[1];[Environment]::SetEnvironmentVariable($pair[0],$value,'Process');[IO.Directory]::CreateDirectory($value)|Out-Null}
foreach($key in @('npm_config_userconfig','npm_config_globalconfig')){$value=Join-Path $isolated ($key+'.rc');[IO.File]::WriteAllText($value,'');[Environment]::SetEnvironmentVariable($key,$value,'Process')}
foreach($key in @('UAGENT_SYNC_WORKSPACE_ROOT','OPENCODE_SYNC_WORKSPACE_ROOT','NODE_OPTIONS','NODE_PATH')){Remove-Item -LiteralPath ('Env:'+ $key) -ErrorAction SilentlyContinue}
$env:PATH=(Split-Path -Parent $NodeExecutable)+';'+$env:PATH
$keys=@('HOME','USERPROFILE','APPDATA','LOCALAPPDATA','CODEX_HOME','XDG_CONFIG_HOME','TMP','TEMP','npm_config_cache','npm_config_prefix','npm_config_userconfig','npm_config_globalconfig','UAGENT_SYNC_WORKSPACE_ROOT','OPENCODE_SYNC_WORKSPACE_ROOT','NODE_OPTIONS','NODE_PATH','HONOR_M2_SOURCE')
$environment=[ordered]@{};foreach($key in $keys){$environment[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
$environment|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $base ($Label+'-probe-pre-env.json'))
& $NodeExecutable -e 'console.log(JSON.stringify(Object.fromEntries(["UAGENT_SYNC_WORKSPACE_ROOT","OPENCODE_SYNC_WORKSPACE_ROOT","NODE_OPTIONS","NODE_PATH"].map(k=>[k,{present:Object.hasOwn(process.env,k),value:process.env[k]??null}]))))' | Set-Content -LiteralPath (Join-Path $base ($Label+'-child-absence.json'))
$loader=([Uri](Join-Path $base 'src/node_modules/tsx/dist/loader.mjs')).AbsoluteUri
$commands=@()
foreach($name in @('honor-existing-gates')){
 $env:HONOR_PROBE_ROOT=Join-Path $isolated 'artificial-gates'
 $script=Join-Path $base ($name+'.mjs');$output=Join-Path $base ($Label+'-'+$name+'.json');$err=Join-Path $base ($Label+'-'+$name+'.stderr.log')
 & $NodeExecutable --import $loader $script 1> $output 2> $err
 $commands+=@{node=$NodeExecutable;arguments=@('--import',$loader,$script);exitCode=$LASTEXITCODE;stdout=$output;stderr=$err}
}
$commands|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $base ($Label+'-probe-commands.json'))
$commands|Select-Object exitCode,stdout|ConvertTo-Json

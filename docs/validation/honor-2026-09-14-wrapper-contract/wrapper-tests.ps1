param([Parameter(Mandatory=$true)][string]$Wrapper,[Parameter(Mandatory=$true)][string]$ScratchRoot)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $ScratchRoot){throw 'new scratch root required'}
New-Item -ItemType Directory -Path $ScratchRoot | Out-Null
$source=Join-Path $ScratchRoot 'source';New-Item -ItemType Directory $source | Out-Null
Set-Content (Join-Path $source 'package.json') '{"private":true}'
$nodes=@()
foreach($name in @('first','second','legacy')){
 $dir=Join-Path $ScratchRoot $name;New-Item -ItemType Directory (Join-Path $dir 'node_modules/npm/bin') -Force | Out-Null
 Set-Content (Join-Path $dir 'node_modules/npm/bin/npm-cli.js') '// artificial fixture'
 $node=Join-Path $dir 'node.ps1'
 @'
$global:wrapperCalls.Add([pscustomobject]@{driver=$PSCommandPath;label=$args[4]})
$global:LASTEXITCODE=if($args[4] -eq $global:failLabel){1}else{0}
'@ | Set-Content $node
 $nodes+= $node
}
function Get-Command {
 param($Name,$CommandType,$ErrorAction)
 if($global:resolutionMode -eq 'forbidden'){throw 'explicit path unexpectedly resolved'}
 if($global:resolutionMode -eq 'missing'){return}
 [pscustomobject]@{Source=$nodes[0]};[pscustomobject]@{Source=$nodes[1]}
}
$rows=@()
foreach($case in @('multi','explicit','invalid','missing','ci-failure','runtime-failure')){
 $global:wrapperCalls=[System.Collections.Generic.List[object]]::new()
 $global:failLabel='';$global:resolutionMode='multi'
 $params=@{SourcePath=$source;EvidencePath=(Join-Path $ScratchRoot ('evidence-'+$case));Node18Path=$nodes[2]}
 if($case -eq 'explicit'){$params.CurrentNodePath=$nodes[1];$global:resolutionMode='forbidden'}
 if($case -eq 'invalid'){$params.CurrentNodePath=Join-Path $ScratchRoot 'nonexistent.exe'}
 if($case -eq 'missing'){$global:resolutionMode='missing'}
 if($case -eq 'ci-failure'){$global:failLabel='ci'}
 if($case -eq 'runtime-failure'){$global:failLabel='full-current'}
 $errorText=$null
 try{& $Wrapper @params}catch{$errorText=$_.Exception.Message}
 $n=$global:wrapperCalls.Count
 $passed=switch($case){
  'multi' {(!$errorText) -and $n -eq 3 -and @($global:wrapperCalls | Where-Object driver -ne $nodes[0]).Count -eq 0}
  'explicit' {(!$errorText) -and $n -eq 3 -and @($global:wrapperCalls | Where-Object driver -ne $nodes[1]).Count -eq 0}
  'invalid' {$errorText -like '*CurrentNodePath*' -and $n -eq 0}
  'missing' {$errorText -like '*No Node*' -and $n -eq 0}
  'ci-failure' {$errorText -like '*dependency setup failed*' -and $n -eq 1}
  'runtime-failure' {$errorText -like '*runtime validations failed*' -and $n -eq 3}
 }
 $rows+= [pscustomobject]@{case=$case;passed=[bool]$passed;calls=$n;labels=@($global:wrapperCalls|ForEach-Object label);error=$errorText}
}
$failed=@($rows|Where-Object passed -eq $false).Count
[pscustomobject]@{pass=6-$failed;fail=$failed;rows=$rows;realNpmInvoked=$false}|ConvertTo-Json -Depth 6
if($failed){exit 1}

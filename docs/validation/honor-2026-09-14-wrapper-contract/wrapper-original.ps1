param(
 [Parameter(Mandatory=$true)][string]$SourcePath,
 [Parameter(Mandatory=$true)][string]$EvidencePath,
 [Parameter(Mandatory=$true)][string]$Node18Path
)
$ErrorActionPreference='Stop'
$currentNode=(Get-Command node -CommandType Application).Source
$source=(Resolve-Path -LiteralPath $SourcePath).Path
if(Test-Path -LiteralPath $EvidencePath){throw 'Choose a new evidence directory; do not overwrite an earlier run.'}
$replay=Join-Path $PSScriptRoot 'replay.mjs'
$currentNpm=Join-Path (Split-Path $currentNode) 'node_modules/npm/bin/npm-cli.js'
$legacyNpm=Join-Path (Split-Path $Node18Path) 'node_modules/npm/bin/npm-cli.js'
foreach($file in @($currentNpm,$legacyNpm,$Node18Path,(Join-Path $source 'package.json'))){if(!(Test-Path -LiteralPath $file)){throw "Required file missing: $file"}}
$ci=ConvertTo-Json -Compress -InputObject @($currentNpm,'ci','--prefix',$source,'--ignore-scripts','--include=optional','--no-audit','--no-fund')
& $currentNode $replay $source $EvidencePath $currentNode 'ci' $ci
if($LASTEXITCODE -ne 0){throw 'Isolated dependency setup failed; inspect evidence.'}
$currentArgs=ConvertTo-Json -Compress -InputObject @($currentNpm,'test','--prefix',$source)
& $currentNode $replay $source $EvidencePath $currentNode 'full-current' $currentArgs
$currentResult=$LASTEXITCODE
$legacyArgs=ConvertTo-Json -Compress -InputObject @($legacyNpm,'test','--prefix',$source)
& $currentNode $replay $source $EvidencePath $Node18Path 'full-node18' $legacyArgs
$legacyResult=$LASTEXITCODE
if($currentResult -ne 0 -or $legacyResult -ne 0){throw 'One or both runtime validations failed; preserve and report both sets of evidence.'}

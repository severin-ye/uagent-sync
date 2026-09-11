[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ReportPath,
  [Parameter(Mandatory=$true)][string]$TargetRoot,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$report = Get-Content -LiteralPath $ReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($report.schemaVersion -ne 1 -or -not $report.PSObject.Properties['transferFiles']) { throw 'A detailed device audit report is required' }
$source = [IO.Path]::GetFullPath([string]$report.workspaceRoot).TrimEnd('\','/')
$target = [IO.Path]::GetFullPath($TargetRoot).TrimEnd('\','/')
if ($target.Equals($source, [StringComparison]::OrdinalIgnoreCase) -or $target.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase) -or $source.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Offline staging must be outside the source workspace' }
function Assert-NoLink([string]$Value) {
  $candidate = $Value
  while ($candidate) {
    if (Test-Path -LiteralPath $candidate) {
      if ((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked path requires separate handling: $candidate" }
    }
    $parent = [IO.Path]::GetDirectoryName($candidate)
    if ($parent -eq $candidate) { break }
    $candidate = $parent
  }
}
Assert-NoLink $source
Assert-NoLink $target
function Get-Sha256([string]$Value) {
  $stream = [IO.File]::OpenRead($Value)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','') }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
$jobs = [Collections.Generic.List[object]]::new()
$seen = @{}
foreach ($entry in $report.transferFiles) {
  $relative = [string]$entry.path
  if ([IO.Path]::IsPathRooted($relative) -or $relative.Contains(':') -or ($relative -split '[/\\]' | Where-Object { $_ -eq '..' -or $_ -eq '.' -or $_ -eq '' })) { throw 'Invalid transfer path' }
  if ($seen.ContainsKey($relative)) { throw 'Duplicate transfer path' }
  $seen[$relative] = $true
  $from = [IO.Path]::GetFullPath((Join-Path $source $relative))
  $to = [IO.Path]::GetFullPath((Join-Path $target $relative))
  if (-not $from.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $to.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Transfer path escapes its root' }
  Assert-NoLink $from
  Assert-NoLink $to
  $file = Get-Item -LiteralPath $from
  if ($file.PSIsContainer -or $file.Length -ne [long]$entry.bytes) { throw "Source changed since audit; regenerate report: $relative" }
  $jobs.Add([pscustomobject]@{ From=$from; To=$to; Relative=$relative; Bytes=$file.Length })
}
if (-not $Apply) {
  [pscustomobject]@{ applied=$false; files=$jobs.Count; bytes=($jobs | Measure-Object Bytes -Sum).Sum; source=$source; staging=$target } | ConvertTo-Json
  exit 0
}
$marker = Join-Path $target '.uagent-offline-transfer.json'
$reportHash = Get-Sha256 $ReportPath
if (Test-Path -LiteralPath $marker) {
  $previous = Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($previous.reportHash -ne $reportHash -or $previous.source -ne $source) { throw 'Staging belongs to a different transfer report' }
} elseif ((Test-Path -LiteralPath $target) -and @(Get-ChildItem -LiteralPath $target -Force).Count) {
  throw 'Use a new empty staging directory; existing target data is never overwritten'
} else {
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  [pscustomobject]@{ reportHash=$reportHash; source=$source } | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding UTF8
}
$copied = 0
foreach ($job in $jobs) {
  Assert-NoLink $job.From
  Assert-NoLink $job.To
  $expected = Get-Sha256 $job.From
  if (Test-Path -LiteralPath $job.To) {
    if ((Get-Sha256 $job.To) -ne $expected) { throw "Existing staged file differs: $($job.Relative)" }
    continue
  }
  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($job.To)) -Force | Out-Null
  $temporary = $job.To + '.' + [guid]::NewGuid().ToString() + '.partial'
  Copy-Item -LiteralPath $job.From -Destination $temporary
  if ((Get-Sha256 $temporary) -ne $expected -or (Get-Sha256 $job.From) -ne $expected) { throw "Source changed or copy verification failed: $($job.Relative)" }
  Move-Item -LiteralPath $temporary -Destination $job.To
  $copied++
}
[pscustomobject]@{ applied=$true; verifiedFiles=$jobs.Count; copiedFiles=$copied; staging=$target; workspaceRestored=$false } | ConvertTo-Json

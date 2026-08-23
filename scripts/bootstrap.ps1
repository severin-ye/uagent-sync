[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$UagentRepo,
  [Parameter(Mandatory = $true)][string]$DotfilesRepo,
  [ValidateSet('codex', 'opencode', 'dsh')][string]$TargetAgent = 'codex',
  [string]$WorkspaceRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'UagentWorkspace'),
  [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-GitHubUrl([string]$Value, [string]$Name) {
  $uri = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.Host -ne 'github.com') {
    throw "$Name must be an https://github.com repository URL"
  }
}

Assert-GitHubUrl $UagentRepo 'UagentRepo'
Assert-GitHubUrl $DotfilesRepo 'DotfilesRepo'
if ($TargetAgent -ne 'codex') { throw 'This bootstrap entrypoint currently implements the verified Codex-only flow.' }

$sourceDir = Join-Path $WorkspaceRoot 'uagent-sync'
$dotfilesDir = Join-Path $WorkspaceRoot 'usync-dotfiles'
$stateFile = Join-Path $WorkspaceRoot '.uagent-bootstrap-state.json'
$steps = @(
  [ordered]@{ id='install-git'; required=$true; installer='winget'; check='git --version'; command='winget install --id Git.Git --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity' },
  [ordered]@{ id='install-gh'; required=$true; installer='winget'; check='gh --version'; command='winget install --id GitHub.cli --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity' },
  [ordered]@{ id='install-node'; required=$true; installer='winget'; check='node --version; npm --version'; command='winget install --id OpenJS.NodeJS.LTS --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity' },
  [ordered]@{ id='install-codex-cli'; required=$true; installer='npm'; check='codex --version (WindowsApps paths are rejected)'; command='npm install --global @openai/codex@latest --no-audit --no-fund --fetch-timeout=300000 --fetch-retries=5 --loglevel=info' },
  [ordered]@{ id='clone-uagent'; required=$true; command="git clone $UagentRepo $sourceDir" },
  [ordered]@{ id='clone-dotfiles'; required=$true; command="git clone $DotfilesRepo $dotfilesDir" },
  [ordered]@{ id='build-and-test'; required=$true; command="npm ci; npm test; npm pack ($sourceDir)" },
  [ordered]@{ id='install-runtime'; required=$true; command='npm install --global <uagent-sync.tgz> --no-audit --no-fund' },
  [ordered]@{ id='install-personal-marketplace'; required=$true; command="codex plugin marketplace add $UagentRepo; codex plugin add uagent-sync@uagent-sync" },
  [ordered]@{ id='restore-dotfiles'; required=$true; command="uagent-sync init --init-type sync --github-url $DotfilesRepo --target-agent codex --force; uagent-sync pull --target-agent codex --json; uagent-sync setup --target-agent codex --json" },
  [ordered]@{ id='safe-api-template'; required=$false; command='uagent-sync api-keys detect --target-agent codex' },
  [ordered]@{ id='final-verify'; required=$true; command='uagent-sync verify --target-agent codex --json; codex plugin list' }
)

if ($PlanOnly) {
  [ordered]@{ ok=$true; warnings=@(); errors=@(); skipped=@(); targetAgent=$TargetAgent; steps=$steps } | ConvertTo-Json -Depth 8
  exit 0
}

$warnings = [System.Collections.Generic.List[string]]::new()
$errors = [System.Collections.Generic.List[string]]::new()
$skipped = [System.Collections.Generic.List[string]]::new()
$completed = @{}
$savedSourceCommit = ''
if (Test-Path -LiteralPath $stateFile) {
  try {
    $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if ($saved.completed) { foreach ($property in $saved.completed.PSObject.Properties) { $completed[$property.Name] = [bool]$property.Value } }
    if ($saved.sourceCommit) { $savedSourceCommit = [string]$saved.sourceCommit }
  } catch { $warnings.Add('Previous bootstrap state was invalid and has been ignored.') }
}

function Save-State {
  New-Item -ItemType Directory -Path $WorkspaceRoot -Force | Out-Null
  $currentCommit = if (Test-Path -LiteralPath (Join-Path $sourceDir '.git')) { (git -C $sourceDir rev-parse HEAD 2>$null) } else { '' }
  [ordered]@{ version=1; targetAgent=$TargetAgent; uagentRepo=$UagentRepo; dotfilesRepo=$DotfilesRepo; sourceCommit=$currentCommit; completed=$completed; updatedAt=(Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $stateFile -Encoding utf8
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$user;$machine"
}

function Add-PersistentUserPath([string]$Directory) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @($current -split ';' | Where-Object { $_ })
  if ($parts -notcontains $Directory) {
    [Environment]::SetEnvironmentVariable('Path', (($parts + $Directory) -join ';'), 'User')
  }
  Refresh-Path
}

function Expand-PortableArchive([string]$Url, [string]$Destination, [string]$BinRelative) {
  $archive = Join-Path $WorkspaceRoot ([IO.Path]::GetFileName(([Uri]$Url).LocalPath))
  Invoke-WithRetry { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $archive } "download $Url" 3
  if (Test-Path -LiteralPath $Destination) {
    $partial = "$Destination.partial.$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))"
    Move-Item -LiteralPath $Destination -Destination $partial
    $warnings.Add("Preserved an incomplete portable installation at $partial")
  }
  Expand-Archive -LiteralPath $archive -DestinationPath $Destination
  $bin = Join-Path $Destination $BinRelative
  Add-PersistentUserPath $bin
}

function Install-PortableFallback([string]$Name) {
  $toolsDir = Join-Path $WorkspaceRoot 'tools'
  New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
  if ($Name -eq 'git') {
    $release = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/git-for-windows/git/releases/latest'
    $asset = $release.assets | Where-Object { $_.name -match '^MinGit-.*-64-bit\.zip$' } | Select-Object -First 1
    if (-not $asset) { throw 'No portable 64-bit MinGit archive found' }
    Expand-PortableArchive $asset.browser_download_url (Join-Path $toolsDir 'mingit') 'cmd'
  } elseif ($Name -eq 'gh') {
    $release = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/cli/cli/releases/latest'
    $asset = $release.assets | Where-Object { $_.name -match 'windows_amd64\.zip$' } | Select-Object -First 1
    if (-not $asset) { throw 'No portable 64-bit GitHub CLI archive found' }
    $destination = Join-Path $toolsDir 'gh'
    Expand-PortableArchive $asset.browser_download_url $destination ''
    $bin = Get-ChildItem -LiteralPath $destination -Filter gh.exe -Recurse | Select-Object -First 1 -ExpandProperty DirectoryName
    if (-not $bin) { throw 'Portable GitHub CLI archive did not contain gh.exe' }
    Add-PersistentUserPath $bin
  } elseif ($Name -eq 'node') {
    $versions = Invoke-RestMethod -UseBasicParsing 'https://nodejs.org/dist/index.json'
    $version = $versions | Where-Object { $_.lts -and ($_.files -contains 'win-x64-zip') } | Select-Object -First 1
    if (-not $version) { throw 'No current Node.js LTS win-x64 archive found' }
    $file = "node-$($version.version)-win-x64.zip"
    $destination = Join-Path $toolsDir 'node'
    Expand-PortableArchive "https://nodejs.org/dist/$($version.version)/$file" $destination ''
    $bin = Get-ChildItem -LiteralPath $destination -Filter node.exe -Recurse | Select-Object -First 1 -ExpandProperty DirectoryName
    if (-not $bin) { throw 'Portable Node.js archive did not contain node.exe' }
    Add-PersistentUserPath $bin
  } else { throw "No portable fallback is defined for $Name" }
}

function Test-CommandVersion([string]$Name) {
  try {
    $cmd = Get-Command $Name -ErrorAction Stop
    if ($Name -eq 'codex' -and $cmd.Source -match '\\WindowsApps\\') { return $false }
    & $cmd.Source '--version' *> $null
    return $LASTEXITCODE -eq 0
  } catch { return $false }
}

function Invoke-WithRetry([scriptblock]$Action, [string]$Label, [int]$Attempts = 3) {
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try { & $Action; if ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE) { return } } catch { if ($attempt -eq $Attempts) { throw } }
    if ($attempt -lt $Attempts) { Start-Sleep -Seconds ([Math]::Pow(2, $attempt)) }
  }
  throw "$Label failed after $Attempts attempts"
}

function Invoke-WingetInstall([string]$Id, [int]$TimeoutMilliseconds = 120000) {
  $winget = Get-Command winget -ErrorAction Stop
  $arguments = @('install', '--id', $Id, '--exact', '--source', 'winget', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity')
  $process = Start-Process -FilePath $winget.Source -ArgumentList $arguments -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit($TimeoutMilliseconds)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    return $false
  }
  return $process.ExitCode -eq 0
}

function Install-WingetTool([string]$Name, [string]$Id) {
  if (Test-CommandVersion $Name) { $skipped.Add("$Name already usable"); return }
  $wingetSucceeded = $false
  try { $wingetSucceeded = Invoke-WingetInstall $Id } catch { $wingetSucceeded = $false }
  Refresh-Path
  if (-not $wingetSucceeded -and (Test-CommandVersion $Name)) {
    $warnings.Add("winget timed out for $Name, but the real version check confirms installation completed")
    return
  }
  if (-not $wingetSucceeded) {
    $warnings.Add("winget install failed for $Name; using a portable per-user fallback")
    Install-PortableFallback $Name
  }
  Refresh-Path
  if (-not (Test-CommandVersion $Name)) { throw "$Name installation completed but its version command is still unusable" }
}

try {
  Install-WingetTool 'git' 'Git.Git'; $completed['install-git'] = $true; Save-State
  Install-WingetTool 'gh' 'GitHub.cli'; $completed['install-gh'] = $true; Save-State
  gh auth status --hostname github.com *> $null
  if ($LASTEXITCODE -ne 0) {
    $warnings.Add('GitHub authentication is required for the private dotfiles repository; browser sign-in was started automatically.')
    gh auth login --hostname github.com --git-protocol https --web
    if ($LASTEXITCODE -ne 0) { throw 'GitHub authentication did not complete' }
  }
  gh auth setup-git --hostname github.com
  if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI could not configure Git credential integration' }
  gh repo view $DotfilesRepo --json nameWithOwner,isPrivate,defaultBranchRef *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Authenticated GitHub account cannot access the dotfiles repository or the repository does not exist' }
  if (-not (Test-CommandVersion 'node')) { Install-WingetTool 'node' 'OpenJS.NodeJS.LTS'; Refresh-Path }
  elseif (-not (Test-CommandVersion 'npm')) { $warnings.Add('Node.js exists without usable npm; installing an isolated portable LTS runtime.'); Install-PortableFallback 'node'; Refresh-Path }
  if (-not (Test-CommandVersion 'node') -or -not (Test-CommandVersion 'npm')) { throw 'Node.js/npm are not usable after installation' }
  $completed['install-node'] = $true; Save-State

  if (-not (Test-CommandVersion 'codex')) {
    Invoke-WithRetry { npm uninstall --global '@openai/codex' --no-audit --no-fund *> $null; npm install --global '@openai/codex@latest' --no-audit --no-fund --fetch-timeout=300000 --fetch-retries=5 --loglevel=info } 'install Codex CLI' 2
    Refresh-Path
  }
  if (-not (Test-CommandVersion 'codex')) { throw 'Codex CLI is missing, half-installed, or resolves only to an inaccessible WindowsApps executable' }
  $completed['install-codex-cli'] = $true; Save-State

  New-Item -ItemType Directory -Path $WorkspaceRoot -Force | Out-Null
  if (Test-Path -LiteralPath (Join-Path $sourceDir '.git')) { Invoke-WithRetry { git -C $sourceDir pull --ff-only origin master } 'update Uagent Sync' }
  else { Invoke-WithRetry { git clone $UagentRepo $sourceDir } 'clone Uagent Sync' }
  $completed['clone-uagent'] = $true; Save-State
  if (Test-Path -LiteralPath (Join-Path $dotfilesDir '.git')) { Invoke-WithRetry { git -C $dotfilesDir pull --ff-only } 'update dotfiles' }
  else { Invoke-WithRetry { git clone $DotfilesRepo $dotfilesDir } 'clone dotfiles' }
  $completed['clone-dotfiles'] = $true; Save-State

  $currentSourceCommit = (git -C $sourceDir rev-parse HEAD).Trim()
  if ($savedSourceCommit -ne $currentSourceCommit) {
    $completed.Remove('build-and-test'); $completed.Remove('install-runtime'); $completed.Remove('install-personal-marketplace')
  }

  if (-not $completed['build-and-test']) {
    Push-Location $sourceDir
    try {
      Invoke-WithRetry { npm ci --no-audit --no-fund --fetch-timeout=300000 --fetch-retries=5 } 'npm ci' 2
      npm test; if ($LASTEXITCODE -ne 0) { throw 'npm test failed' }
      $packJson = npm pack --json | ConvertFrom-Json
      if ($LASTEXITCODE -ne 0 -or -not $packJson[0].filename) { throw 'npm pack failed' }
      $tarball = Join-Path $sourceDir $packJson[0].filename
      npm install --global $tarball --no-audit --no-fund --fetch-timeout=300000 --fetch-retries=5
      if ($LASTEXITCODE -ne 0) { throw 'packed CLI installation failed' }
    } finally { Pop-Location }
    $completed['build-and-test'] = $true; $completed['install-runtime'] = $true; Save-State
  } else { $skipped.Add('Build, tests, and packed runtime already completed for the current source commit.') }

  $installPlugin = $false
  if (-not $completed['install-personal-marketplace']) { $installPlugin = $true }
  if (-not $installPlugin) {
    try {
      $existingPluginList = codex plugin list --json | ConvertFrom-Json
      $existingPlugin = $existingPluginList.installed | Where-Object { $_.name -eq 'uagent-sync' -and $_.installed -and $_.enabled } | Select-Object -First 1
      if (-not $existingPlugin) { $installPlugin = $true }
    } catch { $installPlugin = $true }
  }
  if ($installPlugin) {
    codex plugin marketplace add $UagentRepo
    if ($LASTEXITCODE -ne 0) { throw 'Codex personal marketplace registration failed' }
    codex plugin add 'uagent-sync@uagent-sync'
    if ($LASTEXITCODE -ne 0) { throw 'Uagent Sync plugin installation failed' }
  }
  $pluginList = codex plugin list --json | ConvertFrom-Json
  $uagentPlugin = $pluginList.installed | Where-Object { $_.name -eq 'uagent-sync' -and $_.installed -and $_.enabled } | Select-Object -First 1
  if ($LASTEXITCODE -ne 0 -or -not $uagentPlugin) { throw 'Uagent Sync plugin is not confirmed installed and enabled' }
  if ($installPlugin) { $warnings.Add('Uagent Sync is installed and enabled. Open a new Codex task to load its newly installed skills into task context.') }
  else { $skipped.Add('Uagent Sync plugin was already installed and enabled for the current source commit.') }
  $completed['install-personal-marketplace'] = $true; Save-State

  $env:UAGENT_SYNC_WORKSPACE_ROOT = $WorkspaceRoot
  uagent-sync init --init-type sync --github-url $DotfilesRepo --target-agent codex --force
  if ($LASTEXITCODE -ne 0) { throw 'Uagent Sync init failed' }
  uagent-sync pull --target-agent codex --json
  if ($LASTEXITCODE -ne 0) { throw 'Uagent Sync pull failed' }
  uagent-sync setup --target-agent codex --json
  if ($LASTEXITCODE -ne 0) { throw 'Uagent Sync setup failed' }
  $completed['restore-dotfiles'] = $true; Save-State

  uagent-sync api-keys detect --target-agent codex | Out-Null
  uagent-sync verify --target-agent codex --json
  if ($LASTEXITCODE -ne 0) { throw 'Final Codex verification failed' }
  $completed['final-verify'] = $true; Save-State
} catch {
  $errors.Add(($_.Exception.Message -replace '(?i)(token|api[_-]?key|secret)\s*[=:]\s*\S+', '$1=<hidden>'))
}

$result = [ordered]@{ ok=($errors.Count -eq 0); warnings=$warnings; errors=$errors; skipped=$skipped; targetAgent=$TargetAgent; stateFile=$stateFile; steps=$steps }
$result | ConvertTo-Json -Depth 8
if ($errors.Count -gt 0) { exit 1 }

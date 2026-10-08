# Install the latest unoblox works beta on Windows x64 from this repository's
# "Build beta installers" runs. In PowerShell:
#
#   gh api -H "Accept: application/vnd.github.raw" "repos/unoblox/ub-dsh-desktop/contents/scripts/install-beta.ps1?ref=claude/charming-bohr-lpab0z" | Out-String | Invoke-Expression
#
# Needs the GitHub CLI signed in to an account that can read the repository
# (winget install GitHub.cli, then gh auth login). Files that gh downloads
# carry no Mark of the Web, so SmartScreen does not stop the unsigned
# installer. Browser downloads still get the prompt.
$ErrorActionPreference = 'Stop'

$repo = if ($env:UNOBLOX_REPO) { $env:UNOBLOX_REPO } else { 'unoblox/ub-dsh-desktop' }
$branch = if ($env:UNOBLOX_BRANCH) { $env:UNOBLOX_BRANCH } else { 'claude/charming-bohr-lpab0z' }
$appName = 'unoblox works'
$artifact = 'unoblox-beta-windows-x64'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw 'The GitHub CLI is missing: run "winget install GitHub.cli", then "gh auth login", then try again.'
}
if (-not [Environment]::Is64BitOperatingSystem) { throw 'The beta needs 64-bit Windows.' }

Write-Host "Finding the latest $appName beta..."
# The artifacts API lists newest first; keep this branch's unexpired builds.
$listing = gh api "repos/$repo/actions/artifacts?name=$artifact&per_page=30" | Out-String | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "Could not list builds of $repo; check gh auth status." }
$latest = $listing.artifacts | Where-Object { -not $_.expired -and $_.workflow_run.head_branch -eq $branch } | Select-Object -First 1
if (-not $latest) { throw "No unexpired $artifact build on $branch; run the Build beta installers workflow." }
$runId = $latest.workflow_run.id

$work = Join-Path ([IO.Path]::GetTempPath()) ("unoblox-works-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  Write-Host "Downloading build $runId..."
  gh run download $runId -R $repo -n $artifact -D $work
  if ($LASTEXITCODE -ne 0) { throw 'Download failed.' }
  $setup = Get-ChildItem -Path $work -Filter '*-setup.exe' | Select-Object -First 1
  if (-not $setup) { throw 'The build has no setup .exe.' }

  $running = Get-Process -Name $appName -ErrorAction SilentlyContinue
  if ($running) {
    Write-Host "Closing the running $appName..."
    $running | Stop-Process -Force
    Start-Sleep -Seconds 2
  }

  Write-Host "Installing $($setup.Name)..."
  # /S: silent NSIS install for the current user (no administrator prompt).
  $installer = Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Wait -PassThru
  if ($installer.ExitCode -ne 0) { throw "The installer exited with code $($installer.ExitCode)." }

  $exe = Join-Path $env:LOCALAPPDATA "Programs\$appName\$appName.exe"
  if (Test-Path $exe) {
    Write-Host "Opening $appName..."
    Start-Process -FilePath $exe
  } else {
    Write-Host "Installed. Open $appName from the Start menu."
  }
  Write-Host 'If the earlier "Unoblox" beta is installed, you can uninstall it in Settings > Apps; your data is kept.'
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

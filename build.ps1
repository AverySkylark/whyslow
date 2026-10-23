<#
.SYNOPSIS
  Builds the WhySlow Chrome Web Store package.

.DESCRIPTION
  Checks the extension, then writes whyslow-<version>.zip with manifest.json at the zip root.
  Only what the extension needs is packed (an allow-list); store/, reference/, site/, docs/,
  fonts/, preview/ and the dev files stay out.

  Checks before packing:
    - manifest.json is valid JSON with a 1-4 part numeric version
    - every packed file, manifest icon and the service worker exists
    - everything popup.html loads is in the package
    - JavaScript syntax (node --check), when Node is installed
    - the zip for this version does not already exist (bump the version or use -Force)

.PARAMETER OutDir
  Folder to write the zip to. Defaults to this project folder (*.zip is git-ignored).

.PARAMETER Force
  Overwrite an existing zip for the same version.

.PARAMETER SkipChecks
  Skip the JavaScript syntax check.

.EXAMPLE
  .\build.ps1

.EXAMPLE
  .\build.ps1 -OutDir ..\releases -Force
#>
[CmdletBinding()]
param(
  [string]$OutDir,
  [switch]$Force,
  [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'

# Project folder. $PSScriptRoot can be empty in Windows PowerShell 5.1 (ISE, Run Selection,
# some shortcuts), so fall back to the script's path, then to the current folder.
$Root = $PSScriptRoot
if (-not $Root -and $MyInvocation.MyCommand.Path) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $Root) { $Root = (Get-Location).Path }
if (-not (Test-Path -LiteralPath (Join-Path $Root 'manifest.json'))) {
  Write-Host "Build failed: no manifest.json in '$Root'. Run build.ps1 from the WhySlow folder." -ForegroundColor Red
  exit 1
}
Set-Location -LiteralPath $Root
if (-not $OutDir) { $OutDir = $Root }

# What goes in the package. Add new extension files here.
$Files = @('manifest.json', 'background.js', 'popup.html', 'popup.css', 'popup.js', 'history.js', 'mode.js', 'tokens.css', 'strata.css')
$Dirs  = @('icons')

function Fail([string]$Message) {
  Write-Host "Build failed: $Message" -ForegroundColor Red
  exit 1
}

# ---- 1. Manifest ----
try {
  $manifest = Get-Content -LiteralPath 'manifest.json' -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  Fail "manifest.json is not valid JSON. $($_.Exception.Message)"
}
$version = [string]$manifest.version
if ($version -notmatch '^\d+(\.\d+){0,3}$') {
  Fail "manifest.json version '$version' must be 1 to 4 dot-separated numbers."
}
Write-Host "WhySlow $version" -ForegroundColor Cyan

# ---- 2. Files ----
$missing = @($Files | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
foreach ($d in $Dirs) { if (-not (Test-Path -LiteralPath $d -PathType Container)) { $missing += "$d\" } }

$iconPaths = @()
if ($manifest.icons) { $iconPaths += $manifest.icons.PSObject.Properties | ForEach-Object { $_.Value } }
if ($manifest.action -and $manifest.action.default_icon) { $iconPaths += $manifest.action.default_icon.PSObject.Properties | ForEach-Object { $_.Value } }
$missing += @($iconPaths | Sort-Object -Unique | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($missing.Count) { Fail ("missing: " + ($missing -join ', ')) }

$packed = @($Files)
foreach ($d in $Dirs) {
  $packed += Get-ChildItem -LiteralPath $d -Recurse -File |
    Where-Object { $_.Extension -ne '.md' } |
    ForEach-Object { $_.FullName.Substring($Root.TrimEnd('\', '/').Length + 1) -replace '\\', '/' }
}

$sw = [string]$manifest.background.service_worker
if ($sw -and $packed -notcontains $sw) { Fail "the service worker '$sw' is not in the package list (`$Files)." }
$popup = [string]$manifest.action.default_popup
if ($popup -and $packed -notcontains $popup) { Fail "the popup '$popup' is not in the package list (`$Files)." }
foreach ($icon in $iconPaths) { if ($packed -notcontains $icon) { Fail "icon '$icon' is not in the package." } }

# Everything popup.html loads must be packed (catches a new .js or .css file left off $Files)
$html = Get-Content -LiteralPath 'popup.html' -Raw -Encoding UTF8
$refs = [regex]::Matches($html, '(?:src|href)="([^"#?:]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
foreach ($ref in $refs) {
  if ($packed -notcontains $ref) { Fail "popup.html loads '$ref' but it is not in the package list (`$Files)." }
}

# ---- 3. JavaScript syntax ----
if ($SkipChecks) {
  Write-Host 'Skipped JavaScript syntax checks.' -ForegroundColor Yellow
} elseif (Get-Command node -ErrorAction SilentlyContinue) {
  foreach ($js in ($Files | Where-Object { $_ -like '*.js' })) {
    & node --check $js
    if ($LASTEXITCODE -ne 0) { Fail "syntax error in $js (see above)." }
  }
  Write-Host 'JavaScript syntax OK.'
} else {
  Write-Warning 'Node.js not found, so JavaScript syntax was not checked.'
}

# ---- 4. Output path ----
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$out = Join-Path (Resolve-Path -LiteralPath $OutDir).Path "whyslow-$version.zip"
if (Test-Path -LiteralPath $out) {
  if ($Force) { Remove-Item -LiteralPath $out }
  else { Fail "$out already exists. Bump the version in manifest.json, or run with -Force to overwrite it." }
}

# ---- 5. Zip ----
# System.IO.Compression rather than Compress-Archive: Windows PowerShell 5.1's Compress-Archive
# writes backslashes into entry names, which the Chrome Web Store can reject.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($rel in $packed) {
    $src = Join-Path $Root $rel
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $src, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally {
  $zip.Dispose()
}

$kb = [math]::Round((Get-Item -LiteralPath $out).Length / 1KB, 1)
Write-Host "Wrote $out ($($packed.Count) files, $kb KB)" -ForegroundColor Green

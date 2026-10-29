<#
  Run inside ONE project folder (or pass -Path). It will:
   1. git init if it isn't a repo yet
   2. create a private GitHub repo if there's no remote (needs gh, logged in)
   3. show changes, ask for a commit message, commit everything
   4. pull --rebase, then push (sets upstream if missing)
  Examples:
    cd "C:\dev\apps\Fair Go"; C:\scripts\sync-repo.ps1
    C:\scripts\sync-repo.ps1 -Path C:\dev\apps\Benchtop -Name benchtop
#>
param(
    [string]$Path  = (Get-Location).Path,
    [string]$Name,                       # GitHub repo name; default = folder name, lower-kebab
    [string]$Owner = 'AverySkylark',
    [string]$Message                     # skip the prompt
)
$Path = (Resolve-Path $Path).Path
function Ask($q) { (Read-Host "$q [y/N]") -match '^y' }

# 1. init
if (-not (Test-Path (Join-Path $Path '.git'))) {
    if (-not (Ask "$Path is not a Git repo. Initialise it?")) { return }
    if (-not (Test-Path (Join-Path $Path '.gitignore'))) {
        Write-Warning "No .gitignore - create one first (node_modules, target, dist, .env...)"
        if (-not (Ask 'Continue without one?')) { return }
    }
    git -C $Path init -b main | Out-Null
}

# 2. show + commit
$st = @(git -C $Path status --porcelain)
if ($st.Count) {
    Write-Host "`nChanges in $Path :" -ForegroundColor Cyan
    git -C $Path status --short
    $big = Get-ChildItem $Path -Recurse -File -ErrorAction SilentlyContinue |
           Where-Object { $_.Length -gt 50MB -and $_.FullName -notmatch '\\(\.git|node_modules|target)\\' }
    $big | ForEach-Object { Write-Warning "Large file ($([int]($_.Length/1MB)) MB): $($_.FullName) - check it's ignored" }
    if (-not $Message) { $Message = Read-Host "`nCommit message (blank = cancel)" }
    if (-not $Message) { Write-Host 'Cancelled.'; return }
    git -C $Path add -A
    git -C $Path commit -m $Message | Out-Null
    Write-Host "Committed." -ForegroundColor Green
} else { Write-Host 'Nothing to commit.' }

# 3. remote
if (-not (git -C $Path remote get-url origin 2>$null)) {
    if (-not $Name) { $Name = ((Split-Path $Path -Leaf) -replace '[^\w.-]+','-').ToLower() }
    if (-not (Ask "No remote. Create private GitHub repo $Owner/$Name and push?")) { return }
    gh repo create "$Owner/$Name" --private --source $Path --remote origin --push
    return
}

# 4. pull + push
$branch = git -C $Path branch --show-current
if (git -C $Path rev-parse --abbrev-ref '@{u}' 2>$null) {
    git -C $Path pull --rebase --autostash
    git -C $Path push
} else {
    git -C $Path push -u origin $branch
}
Write-Host "Done: $Path is pushed." -ForegroundColor Green

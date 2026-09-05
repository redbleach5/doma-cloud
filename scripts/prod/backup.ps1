# Consistent SQLite backup (+ optional storage copy) with retention. Windows.
#
# Usage:
#   powershell -File scripts\prod\backup.ps1 [-WithFiles]
#
# Env (from .env):
#   DOMA_BACKUP_DIR   default: <repo>\..\doma-backups
#   DOMA_BACKUP_KEEP  default: 7
param([switch]$WithFiles)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib.ps1")
Doma-LoadEnv
Doma-RequireCmd sqlite3

$db = Doma-DbPath
$storage = Doma-StorageRoot
$backupRoot = Doma-BackupRoot
$keep = if ($env:DOMA_BACKUP_KEEP) { [int]$env:DOMA_BACKUP_KEEP } else { 7 }
$stamp = (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + $PID
$out = Join-Path $backupRoot "backup-$stamp"

if (-not (Test-Path $db)) { Write-Error "database not found: $db" }
New-Item -ItemType Directory -Force -Path $out | Out-Null

Write-Host "==> Backup -> $out"
Write-Host "    db:      $db"
Write-Host "    storage: $storage"

# Online-consistent copy (no service stop required).
sqlite3 $db ".backup '$out\doma.db'"
if ($LASTEXITCODE -ne 0) { Write-Error "sqlite3 .backup failed" }

Copy-Item $script:DomaEnvFile (Join-Path $out "backup.env")

$sha = (Get-FileHash -Algorithm SHA256 (Join-Path $out "doma.db")).Hash.ToLower()

if ($WithFiles) {
    if (-not (Test-Path $storage)) { Write-Error "storage root missing: $storage" }
    Write-Host "==> Copy storage (-WithFiles)"
    New-Item -ItemType Directory -Force -Path (Join-Path $out "storage") | Out-Null
    robocopy $storage (Join-Path $out "storage") /MIR /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { Write-Error "robocopy failed with code $LASTEXITCODE" }
}

Get-ChildItem $backupRoot -Directory -Filter "backup-*" |
    Sort-Object Name -Descending |
    Select-Object -Skip $keep |
    Remove-Item -Recurse -Force

@("backup: $out", "db: $db", "sha256: $sha", "files: $(if ($WithFiles) {'yes'} else {'no'})") |
    Set-Content (Join-Path $out "BACKUP.txt")
Write-Host "==> Done (retention: last $keep)"

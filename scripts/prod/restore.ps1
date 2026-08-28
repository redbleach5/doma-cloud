# Restore a backup made by backup.ps1. Windows.
#
# Usage:
#   powershell -File scripts\prod\restore.ps1 <backup-dir> [[-WithFiles]] [-DryRun]
#
# Stop the Doma service before a real restore (SQLite WAL must be idle).
param(
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [switch]$WithFiles,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib.ps1")
Doma-LoadEnv
Doma-RequireCmd sqlite3

$db = Doma-DbPath
$storage = Doma-StorageRoot
$srcDb = Join-Path $BackupDir "doma.db"

if (-not (Test-Path $srcDb)) { Write-Error "backup database not found: $srcDb" }

if ($WithFiles) {
    $srcStorage = Join-Path $BackupDir "storage"
    if (-not (Test-Path $srcStorage)) { Write-Error "backup storage not found: $srcStorage" }
}

Write-Host "==> Restore from: $BackupDir"
Write-Host "    db target:      $db"
if ($WithFiles) { Write-Host "    storage target: $storage" }
if ($DryRun) { Write-Host "(dry-run - nothing written)"; exit 0 }

Write-Host ""
Write-Warning ("This overwrites the live database at: " + $db)
Write-Host "Stop Doma first so SQLite is idle (WAL must not be mid-write)."
$confirm = Read-Host "Type RESTORE to continue"
if ($confirm -cne "RESTORE") { Write-Host "aborted"; exit 1 }

Copy-Item $db "$db.pre-restore.bak" -Force
sqlite3 $db ".restore '$srcDb'"
if ($LASTEXITCODE -ne 0) { Write-Error "sqlite3 .restore failed" }

if ($WithFiles) {
    robocopy $srcStorage $storage /MIR /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { Write-Error "robocopy failed with code $LASTEXITCODE" }
}

Write-Host "==> Restored. Previous db saved as $db.pre-restore.bak"

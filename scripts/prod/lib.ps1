# Shared helpers for scripts/prod/*.ps1 (Windows).
# Dot-source: . "$PSScriptRoot\lib.ps1"

$ErrorActionPreference = "Stop"
$DomaRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Doma-LoadEnv {
    $envFile = if ($env:DOMA_ENV_FILE) { $env:DOMA_ENV_FILE } else { Join-Path $DomaRoot ".env" }
    if (-not (Test-Path $envFile)) {
        Write-Error "env file not found: $envFile - copy .env.example to .env and set secrets first."
    }
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
            $val = $Matches[2].Trim() -replace '^["'']|["'']$', ''
            [Environment]::SetEnvironmentVariable($Matches[1], $val, "Process")
        }
    }
    $script:DomaEnvFile = $envFile
}

function Doma-DbPath {
    $url = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "file:./doma.db" }
    $p = $url -replace '^file:', ''
    if (-not [System.IO.Path]::IsPathRooted($p)) { $p = Join-Path $DomaRoot ($p -replace '^[.][\\/]+', '') }
    return $p
}

function Doma-StorageRoot {
    $root = if ($env:STORAGE_LOCAL_ROOT) { $env:STORAGE_LOCAL_ROOT } else { "./storage-data" }
    if (-not [System.IO.Path]::IsPathRooted($root)) { $root = Join-Path $DomaRoot ($root -replace '^[.][\\/]+', '') }
    return $root
}

function Doma-BaseUrl {
    $port = if ($env:PORT) { $env:PORT } else { "3000" }
    $host_ = if ($env:DOMA_HEALTH_HOST) { $env:DOMA_HEALTH_HOST } else { "127.0.0.1" }
    return "http://${host_}:$port"
}

function Doma-BackupRoot {
    $dir = if ($env:DOMA_BACKUP_DIR) { $env:DOMA_BACKUP_DIR } else { Join-Path $DomaRoot "..\doma-backups" }
    if (-not [System.IO.Path]::IsPathRooted($dir)) { $dir = Join-Path $DomaRoot $dir }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    return (Resolve-Path $dir).Path
}

function Doma-RequireCmd {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Error "required command not found: $Name"
    }
}

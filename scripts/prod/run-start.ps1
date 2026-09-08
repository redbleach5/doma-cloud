# Start Doma in production with .env loaded (for Task Scheduler). Windows.
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib.ps1")

Set-Location $DomaRoot
Doma-LoadEnv

$env:NODE_ENV = "production"
if (-not $env:PORT) { $env:PORT = "3000" }

$server = Join-Path $DomaRoot ".next\standalone\server.js"
if (-not (Test-Path $server)) {
    Write-Error ("missing " + $server + " - run: bun run build")
}

$logDir = Join-Path $DomaRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
$logFile = Join-Path $logDir ("server-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
$env:DOMA_LOG_FILE = $logFile
& bun $server *>&1 | Out-File -FilePath $logFile -Append -Encoding utf8

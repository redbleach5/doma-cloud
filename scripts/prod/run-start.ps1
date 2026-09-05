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

& bun $server

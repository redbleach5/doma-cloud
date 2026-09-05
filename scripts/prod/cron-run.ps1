# Run all cleanup cron endpoints (trash, uploads, share). Windows.
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib.ps1")
Doma-LoadEnv

if (-not $env:CRON_SECRET -or $env:CRON_SECRET -eq "replace-me-with-a-random-cron-secret") {
    Write-Error "set a real CRON_SECRET in .env"
}

$base = Doma-BaseUrl
$failed = 0

foreach ($path in @("trash-cleanup", "uploads-cleanup", "share-cleanup")) {
    Write-Host "==> POST /api/cron/$path"
    try {
        Invoke-RestMethod -Method Post -Uri "$base/api/cron/$path" `
            -Headers @{ "X-Cron-Secret" = $env:CRON_SECRET } -TimeoutSec 120 | Out-Null
        Write-Host "    ok"
    } catch {
        Write-Host "error: cron $path failed: $_" -ForegroundColor Red
        $failed = 1
    }
}
exit $failed

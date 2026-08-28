# GET /api/health - exit 0 on ok, 1 otherwise. Windows.
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib.ps1")
Doma-LoadEnv
$url = "$(Doma-BaseUrl)/api/health"

try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
    if ($resp.StatusCode -eq 200) {
        Write-Host "ok $($resp.Content)"
        exit 0
    }
    Write-Host "fail http=$($resp.StatusCode)" -ForegroundColor Red
    exit 1
} catch {
    Write-Host "fail $_" -ForegroundColor Red
    exit 1
}

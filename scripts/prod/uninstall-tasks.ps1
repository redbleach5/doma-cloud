# Uninstall Doma scheduled tasks. Windows.
$ErrorActionPreference = "Stop"

foreach ($n in @("Doma app", "Doma backup", "Doma cron")) {
    $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
    if ($t) {
        Unregister-ScheduledTask -TaskName $n -Confirm:$false
        Write-Host "uninstalled: $n"
    } else {
        Write-Host "not found:   $n"
    }
}

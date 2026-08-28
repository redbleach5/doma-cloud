# Install Windows scheduled tasks for Doma Cloud:
#   - run-start.ps1  - start the app at logon
#   - backup.ps1     - daily at 03:15
#   - cron-run.ps1   - cleanup endpoints every 8 hours
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\prod\install-tasks.ps1
param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib.ps1")

$ps = (Get-Command powershell).Source

function Install-DomaTask {
    param(
        [string]$TaskName,
        [string]$ScriptFile,
        [object[]]$Triggers
    )
    $action = New-ScheduledTaskAction -Execute $ps `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\$ScriptFile`"" `
        -WorkingDirectory $DomaRoot

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $Triggers `
        -RunLevel Limited -Force | Out-Null
    Write-Host "  installed: $TaskName ($ScriptFile)"
}

Write-Host "Installing Doma scheduled tasks (current user)..."

# --- App: start at logon ---
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn
Install-DomaTask -TaskName "Doma app" -ScriptFile "run-start.ps1" -Triggers $logonTrigger

# --- Backup: daily at 03:15 ---
$backupTrigger = New-ScheduledTaskTrigger -Daily -At "03:15"
Install-DomaTask -TaskName "Doma backup" -ScriptFile "backup.ps1" -Triggers $backupTrigger

# --- Cron cleanup: every 8 hours ---
$cronTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddHours(3) `
    -RepetitionInterval (New-TimeSpan -Hours 8) -RepetitionDuration (New-TimeSpan -Days 3650)
Install-DomaTask -TaskName "Doma cron" -ScriptFile "cron-run.ps1" -Triggers $cronTrigger

Write-Host ""
Write-Host "Doma tasks installed."
Write-Host "  Check:  Get-ScheduledTask -TaskName 'Doma*'"
Write-Host "  Health: bun run prod:health-win"
Write-Host ""
Write-Host "NOTE: 'Doma app' starts at next logon. To start it now:"
Write-Host "  Start-ScheduledTask -TaskName 'Doma app'"

# Optional: run the worker automatically when you sign in to Windows (Task Scheduler).
# Usage (normal PowerShell, not admin):  powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1
# Remove later with:  Unregister-ScheduledTask -TaskName "CampaignOS AI worker" -Confirm:$false
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $PSScriptRoot "start-worker.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "CampaignOS AI worker" -Action $action -Trigger $trigger -Settings $settings -Description "Polls Supabase for CampaignOS review jobs and runs them on local Ollama." -Force | Out-Null
Write-Host "Installed. The worker starts the next time you sign in. Logs: $root\logs\worker.log"

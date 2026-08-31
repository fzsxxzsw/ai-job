$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
docker compose --env-file .env -f docker-compose.local.yml down

# Compatibility cleanup for installations that were started before the frontend
# moved into Docker. Only a Vite process whose command line contains this exact
# workspace path may be stopped here.
$frontendPidFile = Join-Path $PSScriptRoot ".job-helper-frontend.pid"
$expectedDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "ai-job-hunting-ui")).Path
$frontendListeners = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue
foreach ($frontendListener in $frontendListeners) {
    $frontendProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($frontendListener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($frontendProcess -and
        $frontendProcess.CommandLine -like "*$expectedDirectory*" -and
        $frontendProcess.CommandLine -match "vite") {
        Stop-Process -Id $frontendListener.OwningProcess -ErrorAction SilentlyContinue
    }
}
if (Test-Path -LiteralPath $frontendPidFile) {
    Remove-Item -LiteralPath $frontendPidFile -Force
}

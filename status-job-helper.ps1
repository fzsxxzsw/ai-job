[CmdletBinding()]
param(
    [switch]$VerboseLogs
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
docker compose --env-file .env -f docker-compose.local.yml ps
Write-Host ""
try {
    $frontendResponse = Invoke-WebRequest `
        -Uri "http://127.0.0.1:5173/healthz" `
        -UseBasicParsing `
        -TimeoutSec 3
    $runtimeHead = Invoke-WebRequest `
        -Uri "http://127.0.0.1:5173/ai-job-hunting-runtime.js" `
        -Method Head `
        -UseBasicParsing `
        -TimeoutSec 3
    $frontendContent = if ($frontendResponse.Content -is [byte[]]) {
        [Text.Encoding]::UTF8.GetString($frontendResponse.Content)
    }
    else {
        [string]$frontendResponse.Content
    }
    $runtimeLength = [long]($runtimeHead.Headers.'Content-Length' | Select-Object -First 1)
    if ($frontendResponse.StatusCode -ne 200 -or $frontendContent.Trim() -ne "ok") {
        throw "Frontend health payload is invalid."
    }
    if ($runtimeHead.StatusCode -ne 200 -or $runtimeLength -lt 100000) {
        throw "Frontend runtime payload is invalid."
    }
    Write-Host "Frontend: healthy at http://127.0.0.1:5173/ (runtime $runtimeLength bytes)"
}
catch {
    Write-Host "Frontend: not healthy"
}
try {
    $backendHealth = Invoke-RestMethod `
        -Uri "http://127.0.0.1:9100/actuator/health" `
        -TimeoutSec 3
    Write-Host "Backend:  $($backendHealth.status) at http://127.0.0.1:9100/"
}
catch {
    Write-Host "Backend:  not healthy"
}
Write-Host ""
if ($VerboseLogs) {
    Write-Warning "Verbose backend logs may contain job or recruiter identifiers. Review them locally and do not share them without redaction."
    docker compose --env-file .env -f docker-compose.local.yml logs --tail 80 backend
}
else {
    Write-Host "Backend logs: hidden by default; use -VerboseLogs only for local diagnosis."
}

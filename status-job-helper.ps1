[CmdletBinding()]
param([switch]$VerboseLogs)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-Location -LiteralPath $PSScriptRoot
$envPath = Join-Path $PSScriptRoot ".env"
$composeFile = Join-Path $PSScriptRoot "docker-compose.local.yml"
$activePointerPath = Join-Path $PSScriptRoot ".job-helper-active.json"

if (Test-Path -LiteralPath $activePointerPath -PathType Leaf) {
    try {
        $active = Get-Content -Raw -LiteralPath $activePointerPath | ConvertFrom-Json
        if ($active.channel -in @("release", "emergency") -and
            $active.buildId -match '^[a-z0-9][a-z0-9._-]{2,79}$') {
            Write-Host "Active release: channel=$($active.channel) build=$($active.buildId)"
        }
        else { Write-Host "Active release: invalid pointer" }
    }
    catch { Write-Host "Active release: unreadable pointer" }
}
else { Write-Host "Active release: not selected" }

& docker compose --env-file $envPath -f $composeFile ps
Write-Host ""
try {
    $frontend = Invoke-WebRequest -Uri "http://127.0.0.1:5173/healthz" -UseBasicParsing -TimeoutSec 3
    $runtime = Invoke-WebRequest -Uri "http://127.0.0.1:5173/ai-job-hunting-runtime.js" -Method Head -UseBasicParsing -TimeoutSec 3
    $content = if ($frontend.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($frontend.Content) } else { [string]$frontend.Content }
    $length = [long]($runtime.Headers.'Content-Length' | Select-Object -First 1)
    if ($frontend.StatusCode -ne 200 -or $content.Trim() -ne "ok" -or $runtime.StatusCode -ne 200 -or $length -lt 100000) {
        throw "Invalid frontend health payload."
    }
    Write-Host "Frontend:     healthy at http://127.0.0.1:5173/ (runtime $length bytes)"
}
catch { Write-Host "Frontend:     not healthy" }

try {
    $backend = Invoke-RestMethod -Uri "http://127.0.0.1:9100/actuator/health" -TimeoutSec 3
    Write-Host "Java backend: $($backend.status) at http://127.0.0.1:9100/"
}
catch { Write-Host "Java backend: not healthy" }

try {
    $agent = Invoke-RestMethod -Uri "http://127.0.0.1:9101/health/ready" -TimeoutSec 3
    Write-Host "Python Agent: $($agent.status) at http://127.0.0.1:9101/ (graph=$($agent.checks.graph), checkpoint=$($agent.checks.checkpoint), migration=$($agent.checks.migration), outbox-only)"
}
catch { Write-Host "Python Agent: not healthy" }

Write-Host ""
if ($VerboseLogs) {
    Write-Warning "Verbose logs may contain identifiers. Do not share them without redaction."
    & docker compose --env-file $envPath -f $composeFile logs --tail 80 backend agent
}
else {
    Write-Host "Service logs are hidden; use -VerboseLogs only for local diagnosis."
}

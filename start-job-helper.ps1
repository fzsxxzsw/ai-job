$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$frontendDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "ai-job-hunting-ui")).Path
$backendDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "ai-job-hunting-server")).Path
$envPath = Join-Path $PSScriptRoot ".env"

if (-not (Test-Path -LiteralPath $envPath)) {
    throw ".env is missing. Copy .env.example and configure the local deployment before starting."
}

function Get-LocalEnvValue {
    param([Parameter(Mandatory)][string]$Name)

    $prefix = "$Name="
    $line = Get-Content -LiteralPath $envPath |
        Where-Object { $_.StartsWith($prefix, [System.StringComparison]::Ordinal) } |
        Select-Object -First 1
    if ($null -eq $line) { return "" }
    return $line.Substring($prefix.Length).Trim().Trim('"').Trim("'")
}

$requiredEnvNames = @(
    "MYSQL_ROOT_PASSWORD",
    "MYSQL_PASSWORD",
    "SMART_PASSWORD",
    "AI_API_KEY",
    "AI_BASE_URL",
    "AI_MODEL",
    "AI_TIMEOUT_SECONDS",
    "AI_THINKING_BUDGET"
)
$missingEnvNames = @(
    $requiredEnvNames | Where-Object { [string]::IsNullOrWhiteSpace((Get-LocalEnvValue -Name $_)) }
)
if ($missingEnvNames.Count -gt 0) {
    throw "Required .env entries are missing or empty: $($missingEnvNames -join ', ')"
}
if ((Get-LocalEnvValue -Name "AI_MODEL") -ne "qwen3-vl-32b-thinking") {
    throw "AI_MODEL must be qwen3-vl-32b-thinking for this deployment."
}
if ((Get-LocalEnvValue -Name "AI_TIMEOUT_SECONDS") -ne "15") {
    throw "AI_TIMEOUT_SECONDS must be 15 for this deployment."
}
if ((Get-LocalEnvValue -Name "AI_THINKING_BUDGET") -ne "256") {
    throw "AI_THINKING_BUDGET must be 256 for the qwen3-vl-32b-thinking low-latency profile."
}

function Get-FrontendListenerProcesses {
    param([int]$Port)

    $listenerProcessIds = @(
        Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
    foreach ($listenerProcessId in $listenerProcessIds) {
        $listenerProcess = Get-CimInstance Win32_Process `
            -Filter "ProcessId = $listenerProcessId" `
            -ErrorAction SilentlyContinue
        if (-not $listenerProcess) {
            throw "Port $Port is listening, but its owning process ($listenerProcessId) could not be inspected. Refusing to reuse the port."
        }
        $listenerProcess
    }
}

function Test-IsProjectFrontendProcess {
    param([object]$ProcessInfo)

    $commandLine = [string]$ProcessInfo.CommandLine
    if ([string]::IsNullOrWhiteSpace($commandLine)) {
        return $false
    }

    $usesProjectDirectory = $commandLine.IndexOf(
        $frontendDirectory,
        [System.StringComparison]::OrdinalIgnoreCase
    ) -ge 0
    $isViteProcess = $commandLine -match '(?i)(^|[\\/\s"])vite(?:\.js)?([\\/\s"]|$)|node_modules[\\/].*vite'
    return $usesProjectDirectory -and $isViteProcess
}

function Stop-LegacyProjectFrontend {
    param([int]$Port)

    $listenerProcesses = @(Get-FrontendListenerProcesses -Port $Port)
    if ($listenerProcesses.Count -eq 0) {
        return
    }

    $dockerFrontendRunning = docker ps `
        --filter "name=^/job-helper-frontend$" `
        --filter "status=running" `
        --format "{{.Names}}"
    if ($dockerFrontendRunning -contains "job-helper-frontend") {
        return
    }

    $projectViteProcesses = @(
        $listenerProcesses | Where-Object { Test-IsProjectFrontendProcess -ProcessInfo $_ }
    )
    $unexpectedProcesses = @(
        $listenerProcesses | Where-Object { -not (Test-IsProjectFrontendProcess -ProcessInfo $_) }
    )
    if ($unexpectedProcesses.Count -gt 0) {
        $processDetails = @(
            $unexpectedProcesses | ForEach-Object {
                "PID=$($_.ProcessId); Name=$($_.Name); Executable=$($_.ExecutablePath)"
            }
        ) -join [Environment]::NewLine
        throw "Port $Port is occupied by a process outside Job Helper. Refusing to stop it.$([Environment]::NewLine)$processDetails"
    }

    foreach ($projectViteProcess in $projectViteProcesses) {
        Write-Host "Stopping legacy Job Helper Vite process PID=$($projectViteProcess.ProcessId)..."
        Stop-Process -Id $projectViteProcess.ProcessId -Force
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker Desktop is not installed. Install and start Docker Desktop first."
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop is installed but not running. Start Docker Desktop, wait until it is ready, then run this script again."
}

$pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $pnpmCommand) {
    throw "pnpm.cmd was not found. Install pnpm before starting Job Helper."
}

Write-Host "Testing and staging the latest local userscript runtime..."
Push-Location -LiteralPath $frontendDirectory
try {
    Write-Host "Running frontend regression tests..."
    & $pnpmCommand.Source run test
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend tests failed with exit code $LASTEXITCODE. Startup was aborted."
    }

    & $pnpmCommand.Source run build:local:bundle
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend bundle build failed with exit code $LASTEXITCODE. Startup was aborted before any served runtime was changed."
    }

    & node scripts/sync-local-runtime.mjs --validate-only
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend runtime contract validation failed with exit code $LASTEXITCODE. Startup was aborted before any served runtime was changed."
    }
}
finally {
    Pop-Location
}

Write-Host "Running backend regression tests in an isolated Maven container..."
& docker run --rm `
    --mount "type=bind,source=$backendDirectory,target=/workspace" `
    --mount "type=volume,source=job-helper-maven-cache,target=/root/.m2" `
    --workdir /workspace `
    maven:3.9.9-eclipse-temurin-17 `
    mvn --batch-mode --no-transfer-progress test
if ($LASTEXITCODE -ne 0) {
    throw "Backend tests failed with exit code $LASTEXITCODE. Startup was aborted."
}

# The userscript runtime is now served by a restartable Docker container. Clean up
# the old Vite listener only when it can be proven to belong to this workspace.
Stop-LegacyProjectFrontend -Port 5173
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot ".job-helper-frontend.pid")) {
    Remove-Item -LiteralPath (Join-Path $PSScriptRoot ".job-helper-frontend.pid") -Force
}

docker compose --env-file .env -f docker-compose.local.yml up -d --build
if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose failed with exit code $LASTEXITCODE."
}

$frontendStartDeadline = [DateTime]::UtcNow.AddSeconds(45)
do {
    Start-Sleep -Milliseconds 500
    try {
        $frontendResponse = Invoke-WebRequest `
            -Uri "http://127.0.0.1:5173/healthz" `
            -UseBasicParsing `
            -TimeoutSec 3
    }
    catch {
        $frontendResponse = $null
    }
} while (($null -eq $frontendResponse -or $frontendResponse.StatusCode -ne 200) -and
         [DateTime]::UtcNow -lt $frontendStartDeadline)

if ($null -eq $frontendResponse -or $frontendResponse.StatusCode -ne 200) {
    throw "Timed out waiting for the Docker frontend health endpoint on port 5173."
}

$backendStartDeadline = [DateTime]::UtcNow.AddSeconds(90)
do {
    Start-Sleep -Milliseconds 750
    try {
        $backendHealth = Invoke-RestMethod `
            -Uri "http://127.0.0.1:9100/actuator/health" `
            -TimeoutSec 5
    }
    catch {
        $backendHealth = $null
    }
} while (($null -eq $backendHealth -or $backendHealth.status -ne "UP") -and
         [DateTime]::UtcNow -lt $backendStartDeadline)

if ($null -eq $backendHealth -or $backendHealth.status -ne "UP") {
    throw "Timed out waiting for the backend health endpoint on port 9100."
}

# Publish the already validated frontend only after the new backend is healthy.
# sync-local-runtime uses atomic renames, so Chrome never reads a half-written bundle.
Push-Location -LiteralPath $frontendDirectory
try {
    & node scripts/sync-local-runtime.mjs
    if ($LASTEXITCODE -ne 0) {
        throw "Publishing the validated frontend runtime failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

try {
    $runtimeHead = Invoke-WebRequest `
        -Uri "http://127.0.0.1:5173/ai-job-hunting-runtime.js" `
        -Method Head `
        -UseBasicParsing `
        -TimeoutSec 5
}
catch {
    throw "Frontend health endpoint is available, but the published userscript runtime cannot be read."
}
$runtimeContentLength = [long]($runtimeHead.Headers.'Content-Length' | Select-Object -First 1)
if ($runtimeHead.StatusCode -ne 200 -or $runtimeContentLength -lt 100000) {
    throw "The published userscript runtime response is unexpectedly small or invalid."
}

Write-Host ""
Write-Host "Job Helper is ready. Frontend, runtime, database dependency, and backend health checks passed."
Write-Host "API:         http://127.0.0.1:9100/"
Write-Host "SmartConfig: http://127.0.0.1:6768/"
Write-Host "Frontend:    http://127.0.0.1:5173/"
Write-Host "Userscript:  $PSScriptRoot\ai-job-hunting-local.user.js"
Write-Host ""
Write-Host "Use http://127.0.0.1:9100/ in the userscript server configuration."

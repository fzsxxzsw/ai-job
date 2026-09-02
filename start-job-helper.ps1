[CmdletBinding()]
param(
    [string]$ReleaseReceiptPath = "",
    [switch]$SkipOperationLock
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-Location -LiteralPath $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot "job-helper-release-common.psm1") -Force
$operationLock = if ($SkipOperationLock) { $null } else { Enter-JobHelperOperationLock -WorkspaceRoot $PSScriptRoot }
try {

$composeFile = Join-Path $PSScriptRoot "docker-compose.local.yml"
$envPath = Join-Path $PSScriptRoot ".env"
$runtimePath = Join-Path $PSScriptRoot "ai-job-hunting-ui\public\ai-job-hunting-runtime.js"
if ([string]::IsNullOrWhiteSpace($ReleaseReceiptPath)) {
    $activePointerPath = Join-Path $PSScriptRoot ".job-helper-active.json"
    if (-not (Test-Path -LiteralPath $activePointerPath -PathType Leaf)) {
        throw "No active release pointer exists. Run release-job-helper.ps1 first."
    }
    $activePointer = Get-Content -Raw -LiteralPath $activePointerPath | ConvertFrom-Json
    if ($activePointer.schemaVersion -ne 1 -or
        [string]::IsNullOrWhiteSpace([string]$activePointer.receiptPath)) {
        throw "The active release pointer is invalid."
    }
    $ReleaseReceiptPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ([string]$activePointer.receiptPath)))
    $workspacePrefix = $PSScriptRoot.TrimEnd('\') + '\'
    if (-not $ReleaseReceiptPath.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "The active release pointer escapes the workspace."
    }
}

function Get-LocalEnvValue {
    param([Parameter(Mandatory)][string]$Name)
    $prefix = "$Name="
    $line = Get-Content -LiteralPath $envPath | Where-Object {
        $_.StartsWith($prefix, [System.StringComparison]::Ordinal)
    } | Select-Object -First 1
    if ($null -eq $line) { return "" }
    return $line.Substring($prefix.Length).Trim().Trim('"').Trim("'")
}

function Get-BytesSha256 {
    param([Parameter(Mandatory)][byte[]]$Bytes)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant()
    }
    finally { $algorithm.Dispose() }
}

function Get-HttpBytes {
    param([Parameter(Mandatory)][string]$Uri)
    $client = New-Object Net.WebClient
    try { return ,$client.DownloadData($Uri) }
    finally { $client.Dispose() }
}

function Assert-RequiredEnvironment {
    $required = @(
        "MYSQL_ROOT_PASSWORD", "MYSQL_PASSWORD", "SMART_PASSWORD", "AI_API_KEY",
        "AI_BASE_URL", "AI_MODEL", "AI_TIMEOUT_SECONDS", "AI_THINKING_BUDGET"
    )
    $missing = @($required | Where-Object {
        [string]::IsNullOrWhiteSpace((Get-LocalEnvValue -Name $_))
    })
    if ($missing.Count -gt 0) {
        throw "Required .env entries are missing or empty: $($missing -join ', ')"
    }
}

function Get-DockerImageMetadata {
    param([Parameter(Mandatory)][string]$Image)
    $json = & docker image inspect $Image 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Required local image '$Image' is missing. Start never pulls or builds images."
    }
    return @($json | ConvertFrom-Json)[0]
}

function Assert-ProjectImage {
    param(
        [Parameter(Mandatory)][string]$Image,
        [Parameter(Mandatory)][string]$ExpectedSha,
        [Parameter(Mandatory)][string]$ExpectedBuildId,
        [Parameter(Mandatory)][string]$ExpectedImageId
    )
    $metadata = Get-DockerImageMetadata -Image $Image
    $revision = [string]$metadata.Config.Labels.'org.opencontainers.image.revision'
    $buildId = [string]$metadata.Config.Labels.'io.job-helper.build-id'
    if ($revision -ne $ExpectedSha -or $buildId -ne $ExpectedBuildId -or
        [string]$metadata.Id -ne $ExpectedImageId) {
        throw "Image '$Image' does not match release SHA/build ID. Re-run release-job-helper.ps1 after CI succeeds."
    }
}

function Wait-HttpHealth {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Uri,
        [Parameter(Mandatory)][scriptblock]$IsHealthy,
        [ValidateRange(1, 300)][int]$TimeoutSeconds
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $response = $null
    do {
        Start-Sleep -Milliseconds 750
        try { $response = Invoke-RestMethod -Uri $Uri -TimeoutSec 5 }
        catch { $response = $null }
    } while (-not (& $IsHealthy $response) -and [DateTime]::UtcNow -lt $deadline)
    if (-not (& $IsHealthy $response)) {
        throw "Timed out waiting for $Name at $Uri. Run status-job-helper.ps1 for diagnosis."
    }
}

if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { throw ".env is missing." }
if (-not (Test-Path -LiteralPath $composeFile -PathType Leaf)) { throw "docker-compose.local.yml is missing." }
if (-not (Test-Path -LiteralPath $ReleaseReceiptPath -PathType Leaf)) {
    throw "Release receipt '$ReleaseReceiptPath' is missing. Run release-job-helper.ps1 first."
}
if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
    throw "The published userscript runtime is missing. Run release-job-helper.ps1 first."
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker Desktop is not installed." }
$null = & docker info --format '{{.ServerVersion}}' 2>$null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running." }
Assert-RequiredEnvironment

$receipt = Get-Content -Raw -LiteralPath $ReleaseReceiptPath | ConvertFrom-Json
if ($receipt.schemaVersion -ne 1 -or $receipt.releaseSha -notmatch '^[a-f0-9]{40}$' -or
    $receipt.buildId -notmatch '^[a-z0-9][a-z0-9._-]{2,79}$' -or
    $receipt.runtimeSha256 -notmatch '^[a-f0-9]{64}$' -or
    $receipt.frontendImageId -notmatch '^sha256:[a-f0-9]{64}$' -or
    $receipt.mysqlImageId -notmatch '^sha256:[a-f0-9]{64}$' -or
    $receipt.backendImageId -notmatch '^sha256:[a-f0-9]{64}$' -or
    $receipt.agentImageId -notmatch '^sha256:[a-f0-9]{64}$') {
    throw "Release receipt is invalid."
}
if ($receipt.frontendImage -ne "nginx:1.27-alpine" -or $receipt.mysqlImage -ne "mysql:8.0") {
    throw "Release receipt contains unsupported infrastructure images."
}
Assert-JobHelperReceiptChannel -Receipt $receipt
if ($receipt.channel -eq "release" -and $receipt.workingTreeDirty) {
    throw "A formal release receipt cannot describe a dirty working tree."
}
if ($receipt.workingTreeDirty -and $receipt.diffHash -notmatch '^[a-f0-9]{64}$') {
    throw "Dirty release receipt is missing its diff identity."
}

$localRuntimeSha = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($localRuntimeSha -ne $receipt.runtimeSha256) {
    throw "Published runtime on disk does not match the release receipt."
}
$runtimeText = [IO.File]::ReadAllText($runtimePath)
if (-not $runtimeText.Contains([string]$receipt.buildId)) {
    throw "Published runtime does not contain the expected build ID."
}

# All four images must already exist. Project images must also carry the exact
# source/build labels recorded by release-job-helper.ps1.
$frontendMetadata = Get-DockerImageMetadata -Image $receipt.frontendImage
$mysqlMetadata = Get-DockerImageMetadata -Image $receipt.mysqlImage
Assert-JobHelperImageIdentity -Name "Frontend" `
    -ExpectedImageId $receipt.frontendImageId -ActualImageId ([string]$frontendMetadata.Id)
Assert-JobHelperImageIdentity -Name "MySQL" `
    -ExpectedImageId $receipt.mysqlImageId -ActualImageId ([string]$mysqlMetadata.Id)
Assert-ProjectImage -Image $receipt.backendImage -ExpectedSha $receipt.releaseSha `
    -ExpectedBuildId $receipt.buildId -ExpectedImageId $receipt.backendImageId
Assert-ProjectImage -Image $receipt.agentImage -ExpectedSha $receipt.releaseSha `
    -ExpectedBuildId $receipt.buildId -ExpectedImageId $receipt.agentImageId

$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue)
$dockerFrontend = & docker ps --filter "name=^/job-helper-frontend$" --filter "status=running" --format "{{.Names}}"
if ($listeners.Count -gt 0 -and $dockerFrontend -notcontains "job-helper-frontend") {
    throw "Port 5173 is occupied outside Job Helper. Resolve the conflict, then retry."
}

$previousFrontendImage = $env:JOB_HELPER_FRONTEND_IMAGE
$previousMysqlImage = $env:JOB_HELPER_MYSQL_IMAGE
$previousBackendImage = $env:JOB_HELPER_BACKEND_IMAGE
$previousAgentImage = $env:JOB_HELPER_AGENT_IMAGE
try {
    $env:JOB_HELPER_FRONTEND_IMAGE = [string]$receipt.frontendImage
    $env:JOB_HELPER_MYSQL_IMAGE = [string]$receipt.mysqlImage
    $env:JOB_HELPER_BACKEND_IMAGE = [string]$receipt.backendImage
    $env:JOB_HELPER_AGENT_IMAGE = [string]$receipt.agentImage
    Write-Host "Starting verified build $($receipt.buildId) without builds or pulls..."
    & docker compose --env-file $envPath -f $composeFile up -d --no-build --pull never
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose startup failed with exit code $LASTEXITCODE."
    }
}
finally {
    $env:JOB_HELPER_FRONTEND_IMAGE = $previousFrontendImage
    $env:JOB_HELPER_MYSQL_IMAGE = $previousMysqlImage
    $env:JOB_HELPER_BACKEND_IMAGE = $previousBackendImage
    $env:JOB_HELPER_AGENT_IMAGE = $previousAgentImage
}

Wait-HttpHealth -Name "frontend" -Uri "http://127.0.0.1:5173/healthz" -TimeoutSeconds 45 `
    -IsHealthy { param($value) $null -ne $value -and ([string]$value).Trim() -eq "ok" }
$servedBytes = Get-HttpBytes -Uri "http://127.0.0.1:5173/ai-job-hunting-runtime.js"
$servedSha = Get-BytesSha256 -Bytes $servedBytes
if ($servedSha -ne $receipt.runtimeSha256 -or
    -not [Text.Encoding]::UTF8.GetString($servedBytes).Contains([string]$receipt.buildId)) {
    throw "The runtime served on port 5173 does not match the release SHA/build ID receipt."
}
Wait-HttpHealth -Name "Java backend" -Uri "http://127.0.0.1:9100/actuator/health" -TimeoutSeconds 90 `
    -IsHealthy { param($value) $null -ne $value -and $value.status -eq "UP" }
Wait-HttpHealth -Name "Python Agent" -Uri "http://127.0.0.1:9101/health/ready" -TimeoutSeconds 45 `
    -IsHealthy { param($value) $null -ne $value -and $value.status -eq "ready" }

Write-Host "Job Helper is ready: channel=$($receipt.channel) sha=$($receipt.releaseSha) build=$($receipt.buildId) runtime_sha256=$servedSha"
Write-Host "Java API:     http://127.0.0.1:9100/"
Write-Host "Python Agent: http://127.0.0.1:9101/ (read-only)"
Write-Host "Frontend:     http://127.0.0.1:5173/"
}
finally {
    Exit-JobHelperOperationLock -Mutex $operationLock
}

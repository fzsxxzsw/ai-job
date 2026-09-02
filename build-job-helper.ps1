[CmdletBinding()]
param(
    [ValidateSet("candidate", "emergency")]
    [string]$Channel = "candidate",
    [string]$BuildId = "",
    [switch]$SkipOperationLock
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-Location -LiteralPath $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot "job-helper-release-common.psm1") -Force
$operationLock = if ($SkipOperationLock) { $null } else { Enter-JobHelperOperationLock -WorkspaceRoot $PSScriptRoot }
try {

$frontendDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "ai-job-hunting-ui")).Path
$backendDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "ai-job-hunting-server")).Path
$agentDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "ai-job-agent")).Path
$composeFile = Join-Path $PSScriptRoot "docker-compose.local.yml"
$envPath = Join-Path $PSScriptRoot ".env"

function Get-Sha256 {
    param([Parameter(Mandatory)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { throw ".env is missing." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git was not found." }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker Desktop is not installed." }
$null = & docker info --format '{{.ServerVersion}}' 2>$null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running." }
$pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $pnpmCommand) { throw "pnpm.cmd was not found." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js was not found." }
$uvCommand = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCommand) { throw "uv was not found." }

$initialSnapshot = Get-JobHelperWorkspaceSnapshot -RepositoryRoot $PSScriptRoot
$sourceSha = $initialSnapshot.headSha
$workingTreeDirty = $initialSnapshot.workingTreeDirty
$diffHash = $initialSnapshot.diffHash
$sourceIdentity = $initialSnapshot.sourceIdentity
if ([string]::IsNullOrWhiteSpace($BuildId)) {
    $BuildId = if ($Channel -eq "candidate") {
        "build-$sourceIdentity-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))"
    }
    else {
        "emergency-$sourceIdentity-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))"
    }
}
if ($BuildId -notmatch '^[a-z0-9][a-z0-9._-]{2,79}$') {
    throw "BuildId must be 3-80 lowercase tag-safe characters."
}
$receiptDirectory = Join-Path $PSScriptRoot ".job-helper-builds"
$receiptPath = Join-Path $receiptDirectory "$BuildId.json"
Assert-JobHelperImmutablePathAvailable -Path $receiptPath

$imageTag = if ($Channel -eq "candidate") {
    Get-JobHelperCandidateImageTag -BuildId $BuildId
}
else { $BuildId }
$backendImage = "job-helper-backend:$imageTag"
$agentImage = "job-helper-agent:$imageTag"
foreach ($immutableImage in @($backendImage, $agentImage)) {
    $null = & docker image inspect $immutableImage 2>$null
    if ($LASTEXITCODE -eq 0) {
        throw "Immutable candidate image tag '$immutableImage' already exists; choose a new BuildId."
    }
}

$previousBuildId = $env:JOB_HELPER_BUILD_ID
$previousBuildSha = $env:JOB_HELPER_BUILD_SHA
$previousBuildChannel = $env:JOB_HELPER_BUILD_CHANNEL
$previousBackendImage = $env:JOB_HELPER_BACKEND_IMAGE
$previousAgentImage = $env:JOB_HELPER_AGENT_IMAGE
try {
    $env:JOB_HELPER_BUILD_ID = $BuildId
    $env:JOB_HELPER_BUILD_SHA = $sourceSha
    $env:JOB_HELPER_BUILD_CHANNEL = $Channel
    $env:JOB_HELPER_BACKEND_IMAGE = $backendImage
    $env:JOB_HELPER_AGENT_IMAGE = $agentImage

    Write-Host "Testing and producing an unpublished frontend bundle (build $BuildId)..."
    Push-Location -LiteralPath $frontendDirectory
    try {
        & $pnpmCommand.Source run test
        if ($LASTEXITCODE -ne 0) { throw "Frontend tests failed with exit code $LASTEXITCODE." }
        & $pnpmCommand.Source run build:local:bundle
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE." }
        & node scripts/sync-local-runtime.mjs --validate-only
        if ($LASTEXITCODE -ne 0) { throw "Runtime validation failed with exit code $LASTEXITCODE." }
    }
    finally { Pop-Location }

    Write-Host "Running Python Agent tests from the frozen lockfile..."
    Push-Location -LiteralPath $agentDirectory
    try {
        & $uvCommand.Source sync --frozen
        if ($LASTEXITCODE -ne 0) { throw "Python dependency sync failed with exit code $LASTEXITCODE." }
        & $uvCommand.Source run pytest
        if ($LASTEXITCODE -ne 0) { throw "Python Agent tests failed with exit code $LASTEXITCODE." }
    }
    finally { Pop-Location }

    Write-Host "Running Java tests in an isolated Maven container..."
    & docker run --rm `
        --mount "type=bind,source=$backendDirectory,target=/workspace" `
        --mount "type=volume,source=job-helper-maven-cache,target=/root/.m2" `
        --workdir /workspace maven:3.9.9-eclipse-temurin-17 `
        mvn --batch-mode --no-transfer-progress test
    if ($LASTEXITCODE -ne 0) { throw "Java tests failed with exit code $LASTEXITCODE." }

    Write-Host "Building isolated candidate images; formal release tags are not changed..."
    & docker compose --env-file $envPath -f $composeFile build backend agent
    if ($LASTEXITCODE -ne 0) { throw "Image build failed with exit code $LASTEXITCODE." }
}
finally {
    $env:JOB_HELPER_BUILD_ID = $previousBuildId
    $env:JOB_HELPER_BUILD_SHA = $previousBuildSha
    $env:JOB_HELPER_BUILD_CHANNEL = $previousBuildChannel
    $env:JOB_HELPER_BACKEND_IMAGE = $previousBackendImage
    $env:JOB_HELPER_AGENT_IMAGE = $previousAgentImage
}

$runtimeSource = Join-Path $frontendDirectory "dist\ai-job-hunting.user.js"
if (-not (Test-Path -LiteralPath $runtimeSource -PathType Leaf)) {
    throw "The validated runtime build output is missing."
}
$backendImageId = (& docker image inspect --format '{{.Id}}' $backendImage | Select-Object -First 1).Trim()
$agentImageId = (& docker image inspect --format '{{.Id}}' $agentImage | Select-Object -First 1).Trim()
if ($backendImageId -notmatch '^sha256:[a-f0-9]{64}$' -or $agentImageId -notmatch '^sha256:[a-f0-9]{64}$') {
    throw "Built image identities are unavailable."
}
$finalSnapshot = Get-JobHelperWorkspaceSnapshot -RepositoryRoot $PSScriptRoot
Assert-JobHelperWorkspaceSnapshotEqual -Expected $initialSnapshot -Actual $finalSnapshot
$receipt = [ordered]@{
    schemaVersion = 1
    channel = $Channel
    sourceSha = $sourceSha
    sourceIdentity = $sourceIdentity
    workingTreeDirty = $workingTreeDirty
    diffHash = $diffHash
    buildId = $BuildId
    backendImage = $backendImage
    backendImageId = $backendImageId
    agentImage = $agentImage
    agentImageId = $agentImageId
    runtimeSource = $runtimeSource
    runtimeSha256 = Get-Sha256 -Path $runtimeSource
    createdAt = [DateTimeOffset]::UtcNow.ToString("o")
}
New-Item -ItemType Directory -Path $receiptDirectory -Force | Out-Null
$temporaryReceipt = "$receiptPath.tmp-$PID"
try {
    $receipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporaryReceipt -Encoding utf8
    Move-Item -LiteralPath $temporaryReceipt -Destination $receiptPath
}
finally {
    if (Test-Path -LiteralPath $temporaryReceipt) { Remove-Item -LiteralPath $temporaryReceipt -Force }
}

Write-Host "Build completed without starting services or publishing runtime."
Write-Host "Candidate backend image: $backendImage"
Write-Host "Candidate Agent image:  $agentImage"
Write-Host "Build receipt:          $receiptPath"
}
finally {
    Exit-JobHelperOperationLock -Mutex $operationLock
}

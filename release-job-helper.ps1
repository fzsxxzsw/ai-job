[CmdletBinding()]
param(
    [string]$ForkRemote = "fork",
    [switch]$EmergencyPreview
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-Location -LiteralPath $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot "job-helper-release-common.psm1") -Force

$requiredWorkflows = @(Get-JobHelperRequiredWorkflows)

function Get-GitHubRepositoryFromRemote {
    param([Parameter(Mandatory)][string]$RemoteName)
    $remoteUrl = (& git remote get-url $RemoteName 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remoteUrl)) {
        throw "Git remote '$RemoteName' is unavailable."
    }
    if ($remoteUrl -notmatch 'github\.com[/:](?<repository>[^\s]+)$') {
        throw "Git remote '$RemoteName' is not a GitHub repository."
    }
    $repository = $Matches.repository.TrimEnd('/')
    if ($repository.EndsWith(".git", [System.StringComparison]::OrdinalIgnoreCase)) {
        $repository = $repository.Substring(0, $repository.Length - 4)
    }
    if ($repository -notmatch '^[^/]+/[^/]+$') {
        throw "Could not determine owner/repository for remote '$RemoteName'."
    }
    return $repository
}

function Assert-PushedRequiredWorkflows {
    param([Parameter(Mandatory)][string]$RemoteName)
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git was not found." }
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw "GitHub CLI (gh) is required to verify Actions before release."
    }
    $dirty = @(& git status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw "Unable to inspect the Git working tree." }
    if ($dirty.Count -gt 0) {
        throw "The working tree is not clean. Commit and push only the intended release first."
    }

    $branch = (& git branch --show-current | Select-Object -First 1).Trim()
    $head = (& git rev-parse HEAD | Select-Object -First 1).Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($branch) -or $head -notmatch '^[a-f0-9]{40}$') {
        throw "A named Git branch and valid HEAD are required."
    }
    $remoteLine = (& git ls-remote --heads $RemoteName "refs/heads/$branch" 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remoteLine)) {
        throw "Branch '$branch' has not been pushed to remote '$RemoteName'."
    }
    if ((([string]$remoteLine -split '\s+')[0]).ToLowerInvariant() -ne $head) {
        throw "Local HEAD is not the pushed head of '$RemoteName/$branch'."
    }

    $repository = Get-GitHubRepositoryFromRemote -RemoteName $RemoteName
    $runsJson = & gh api --method GET "repos/$repository/actions/runs" `
        -f "head_sha=$head" -f "branch=$branch" -f "per_page=100"
    if ($LASTEXITCODE -ne 0) { throw "GitHub Actions status could not be verified." }
    $runs = @((($runsJson | ConvertFrom-Json).workflow_runs) | Where-Object {
        $_.head_sha -eq $head -and $_.head_branch -eq $branch
    })

    $verifiedRunIds = [ordered]@{}
    foreach ($workflowName in $requiredWorkflows) {
        $run = $runs | Where-Object { $_.name -eq $workflowName } |
            Sort-Object -Property created_at -Descending | Select-Object -First 1
        if ($null -eq $run) {
            throw "Required workflow '$workflowName' did not run for $repository@$head."
        }
        if ($run.status -ne "completed") {
            throw "Required workflow '$workflowName' is still running for $repository@$head."
        }
        if ($run.conclusion -ne "success") {
            throw "Required workflow '$workflowName' concluded '$($run.conclusion)' for $repository@$head."
        }
        $verifiedRunIds[$workflowName] = [long]$run.id
    }

    Write-Host "Verified pushed HEAD and all required workflows for $repository@$head."
    return [pscustomobject]@{
        repository = $repository
        branch = $branch
        head = $head
        githubRuns = $verifiedRunIds
    }
}

function Ensure-InfrastructureImage {
    param([Parameter(Mandatory)][string]$Image)
    $null = & docker image inspect $Image 2>$null
    if ($LASTEXITCODE -eq 0) { return }
    Write-Host "Pulling missing fixed infrastructure image $Image after the release gate..."
    & docker pull $Image
    if ($LASTEXITCODE -ne 0) { throw "Required infrastructure image '$Image' could not be acquired." }
}

function Invoke-AgentMigration {
    param(
        [Parameter(Mandatory)][string]$AgentImage,
        [Parameter(Mandatory)][string]$EnvPath,
        [Parameter(Mandatory)][string]$ComposeFile
    )
    $previousAgentImage = $env:JOB_HELPER_AGENT_IMAGE
    try {
        $env:JOB_HELPER_AGENT_IMAGE = $AgentImage
        Write-Host "Starting MySQL only for the explicit Agent schema migration..."
        & docker compose --env-file $EnvPath -f $ComposeFile up -d --no-build --pull never mysql
        if ($LASTEXITCODE -ne 0) { throw "MySQL startup for Agent migration failed." }
        $deadline = [DateTime]::UtcNow.AddSeconds(90)
        do {
            Start-Sleep -Milliseconds 750
            $health = (& docker inspect --format '{{.State.Health.Status}}' job-helper-mysql 2>$null | Select-Object -First 1)
        } while ($health -ne "healthy" -and [DateTime]::UtcNow -lt $deadline)
        if ($health -ne "healthy") { throw "MySQL did not become healthy for Agent migration." }
        Write-Host "Applying the versioned Agent-only Alembic migration..."
        & docker compose --env-file $EnvPath -f $ComposeFile run --rm --no-deps agent `
            alembic -c /app/alembic.ini upgrade head
        if ($LASTEXITCODE -ne 0) { throw "Agent migration failed with exit code $LASTEXITCODE." }
    }
    finally { $env:JOB_HELPER_AGENT_IMAGE = $previousAgentImage }
}

function Write-JsonAtomically {
    param(
        [Parameter(Mandatory)][object]$Value,
        [Parameter(Mandatory)][string]$Path
    )
    $temporary = "$Path.tmp-$PID"
    try {
        $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding utf8
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Copy-FileAtomically {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Destination
    )
    $temporary = "$Destination.tmp-$PID"
    try {
        Copy-Item -LiteralPath $Source -Destination $temporary -Force
        Move-Item -LiteralPath $temporary -Destination $Destination -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Restore-PublishedFilesFromReceipt {
    param([Parameter(Mandatory)][string]$ReceiptPath)
    $receipt = Get-Content -Raw -LiteralPath $ReceiptPath | ConvertFrom-Json
    if (@($receipt.artifacts).Count -ne 4) {
        throw "Old immutable receipt does not contain four archived browser artifacts."
    }
    $receiptDirectory = Split-Path -Parent $ReceiptPath
    $workspacePrefix = $PSScriptRoot.TrimEnd('\') + '\'
    $archivePrefix = [IO.Path]::GetFullPath($receiptDirectory).TrimEnd('\') + '\'
    foreach ($artifact in $receipt.artifacts) {
        $archivePath = [IO.Path]::GetFullPath((Join-Path $receiptDirectory ([string]$artifact.archivePath)))
        $targetPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ([string]$artifact.publishedPath)))
        if (-not $archivePath.StartsWith($archivePrefix, [StringComparison]::OrdinalIgnoreCase) -or
            -not $targetPath.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
            throw "Archived release artifact path is invalid."
        }
        $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($archiveHash -ne $artifact.sha256 -or $artifact.buildId -ne $receipt.buildId) {
            throw "Archived release artifact failed hash/build ID validation."
        }
        Copy-FileAtomically -Source $archivePath -Destination $targetPath
    }
}

function Remove-CandidateProjectContainers {
    foreach ($containerName in @(
        "job-helper-backend", "job-helper-agent", "job-helper-frontend", "job-helper-mysql"
    )) {
        $null = & docker container inspect $containerName 2>$null
        if ($LASTEXITCODE -eq 0) {
            & docker rm --force $containerName | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Could not remove candidate container '$containerName'." }
        }
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker Desktop is not installed." }
$null = & docker info --format '{{.ServerVersion}}' 2>$null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running." }

$operationLock = Enter-JobHelperOperationLock -WorkspaceRoot $PSScriptRoot
try {
$gate = $null
$releaseSnapshot = Get-JobHelperWorkspaceSnapshot -RepositoryRoot $PSScriptRoot
$sourceSha = $releaseSnapshot.headSha
$shortSha = $sourceSha.Substring(0, 12)
if ($EmergencyPreview) {
    $channel = "emergency"
    $buildId = "emergency-$($releaseSnapshot.sourceIdentity)-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))"
    Write-Warning "Emergency preview uses isolated images and becomes the active local channel only after full verification."
    & (Join-Path $PSScriptRoot "build-job-helper.ps1") `
        -Channel emergency -BuildId $buildId -SkipOperationLock
}
else {
    $channel = "release"
    $gate = Assert-PushedRequiredWorkflows -RemoteName $ForkRemote
    $releaseSnapshot = Get-JobHelperWorkspaceSnapshot -RepositoryRoot $PSScriptRoot
    if ($releaseSnapshot.workingTreeDirty) { throw "Formal release requires a clean working tree." }
    $sourceSha = $releaseSnapshot.headSha
    $shortSha = $sourceSha.Substring(0, 12)
    $buildId = "release-$shortSha-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))"
    & (Join-Path $PSScriptRoot "build-job-helper.ps1") `
        -Channel candidate -BuildId $buildId -SkipOperationLock
}
if ($LASTEXITCODE -ne 0) { throw "The release build failed with exit code $LASTEXITCODE." }

$buildReceiptPath = Join-Path $PSScriptRoot ".job-helper-builds\$buildId.json"
$buildReceipt = Get-Content -Raw -LiteralPath $buildReceiptPath | ConvertFrom-Json
if ($buildReceipt.sourceSha -ne $sourceSha -or $buildReceipt.buildId -ne $buildId -or
    $buildReceipt.sourceIdentity -ne $releaseSnapshot.sourceIdentity) {
    throw "Build receipt does not match the intended source identity."
}
if (-not $EmergencyPreview -and $buildReceipt.workingTreeDirty) {
    throw "Formal release artifacts must be built from a clean working tree."
}
$buildSnapshot = [pscustomobject]@{
    headSha = [string]$buildReceipt.sourceSha
    workingTreeDirty = [bool]$buildReceipt.workingTreeDirty
    diffHash = [string]$buildReceipt.diffHash
    sourceIdentity = [string]$buildReceipt.sourceIdentity
}

$backendImage = [string]$buildReceipt.backendImage
$agentImage = [string]$buildReceipt.agentImage
$envPath = Join-Path $PSScriptRoot ".env"
$composeFile = Join-Path $PSScriptRoot "docker-compose.local.yml"
$immutableReceiptRoot = Join-Path $PSScriptRoot ".job-helper-releases"
$immutableReleaseDirectory = Join-Path $immutableReceiptRoot $buildId
$immutableReceiptPath = Join-Path $immutableReleaseDirectory "receipt.json"
$immutableArtifactDirectory = Join-Path $immutableReleaseDirectory "artifacts"
Assert-JobHelperImmutablePathAvailable -Path $immutableReleaseDirectory
$stableReceiptPath = if ($EmergencyPreview) {
    Join-Path $PSScriptRoot ".job-helper-emergency-release.json"
}
else { Join-Path $PSScriptRoot ".job-helper-release.json" }
$activePointerPath = Join-Path $PSScriptRoot ".job-helper-active.json"
$oldActiveReceiptPath = $null
if (Test-Path -LiteralPath $activePointerPath -PathType Leaf) {
    $oldActivePointer = Get-Content -Raw -LiteralPath $activePointerPath | ConvertFrom-Json
    $candidateOldPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ([string]$oldActivePointer.receiptPath)))
    $workspacePrefix = $PSScriptRoot.TrimEnd('\') + '\'
    if ($candidateOldPath.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $candidateOldPath -PathType Leaf)) {
        $oldActiveReceiptPath = $candidateOldPath
    }
    else { throw "Current active pointer cannot be resolved safely." }
}

Ensure-InfrastructureImage -Image "nginx:1.27-alpine"
Ensure-InfrastructureImage -Image "mysql:8.0"
$frontendImageId = (& docker image inspect --format '{{.Id}}' "nginx:1.27-alpine" | Select-Object -First 1).Trim()
$mysqlImageId = (& docker image inspect --format '{{.Id}}' "mysql:8.0" | Select-Object -First 1).Trim()
if ($frontendImageId -notmatch '^sha256:[a-f0-9]{64}$' -or $mysqlImageId -notmatch '^sha256:[a-f0-9]{64}$') {
    throw "Infrastructure image identities are unavailable."
}
Invoke-AgentMigration -AgentImage $agentImage -EnvPath $envPath -ComposeFile $composeFile

$frontendDirectory = Join-Path $PSScriptRoot "ai-job-hunting-ui"
$publishedRuntime = Join-Path $frontendDirectory "public\ai-job-hunting-runtime.js"
$rollbackDirectory = Join-Path ([IO.Path]::GetTempPath()) "job-helper-release-$PID-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $rollbackDirectory | Out-Null
$publishedFiles = @(
    $publishedRuntime,
    (Join-Path $frontendDirectory "public\ai-job-hunting-local.user.js"),
    (Join-Path $frontendDirectory "dist\ai-job-hunting-local.user.js"),
    (Join-Path $PSScriptRoot "ai-job-hunting-local.user.js")
)
$rollbackEntries = @()
for ($index = 0; $index -lt $publishedFiles.Count; $index++) {
    $target = $publishedFiles[$index]
    $backup = Join-Path $rollbackDirectory "$index.bak"
    $existed = Test-Path -LiteralPath $target -PathType Leaf
    if ($existed) { Copy-Item -LiteralPath $target -Destination $backup }
    $rollbackEntries += [pscustomobject]@{ target = $target; backup = $backup; existed = $existed }
}
function Restore-TemporaryPublishedFiles {
    foreach ($entry in $rollbackEntries) {
        if ($entry.existed) { Copy-FileAtomically -Source $entry.backup -Destination $entry.target }
        elseif (Test-Path -LiteralPath $entry.target) { Remove-Item -LiteralPath $entry.target -Force }
    }
}

$activationSucceeded = $false
try {
    Write-Host "Publishing candidate runtime; active pointer and formal aliases remain unchanged during verification..."
    Push-Location -LiteralPath $frontendDirectory
    try {
        & node scripts/sync-local-runtime.mjs
        if ($LASTEXITCODE -ne 0) { throw "Runtime publication failed with exit code $LASTEXITCODE." }
    }
    finally { Pop-Location }

    $publishedSha = (Get-FileHash -LiteralPath $publishedRuntime -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($publishedSha -ne $buildReceipt.runtimeSha256 -or
        -not [IO.File]::ReadAllText($publishedRuntime).Contains($buildId)) {
        throw "Published runtime does not match the validated candidate."
    }

    New-Item -ItemType Directory -Path $immutableArtifactDirectory -Force | Out-Null
    $archiveNames = @("runtime.js", "public-loader.user.js", "dist-loader.user.js", "root-loader.user.js")
    $archivedArtifacts = @()
    for ($index = 0; $index -lt $publishedFiles.Count; $index++) {
        $source = $publishedFiles[$index]
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Published browser artifact is missing: $source"
        }
        $archiveName = $archiveNames[$index]
        $archivePath = Join-Path $immutableArtifactDirectory $archiveName
        Copy-Item -LiteralPath $source -Destination $archivePath
        $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
        $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($sourceHash -ne $archiveHash) { throw "Archived browser artifact hash mismatch." }
        $publishedRelativePath = $source.Substring($PSScriptRoot.Length).TrimStart('\').Replace('\', '/')
        $archivedArtifacts += [ordered]@{
            role = $archiveName
            buildId = $buildId
            publishedPath = $publishedRelativePath
            archivePath = "artifacts/$archiveName"
            sha256 = $archiveHash
        }
    }

    $candidateReceipt = [ordered]@{
        schemaVersion = 1
        channel = $channel
        releaseSha = $sourceSha
        sourceIdentity = [string]$buildReceipt.sourceIdentity
        workingTreeDirty = [bool]$buildReceipt.workingTreeDirty
        diffHash = [string]$buildReceipt.diffHash
        buildId = $buildId
        frontendImage = "nginx:1.27-alpine"
        frontendImageId = $frontendImageId
        mysqlImage = "mysql:8.0"
        mysqlImageId = $mysqlImageId
        backendImage = $backendImage
        backendImageId = [string]$buildReceipt.backendImageId
        agentImage = $agentImage
        agentImageId = [string]$buildReceipt.agentImageId
        runtimeSha256 = $publishedSha
        artifacts = $archivedArtifacts
        githubRepository = if ($null -ne $gate) { $gate.repository } else { $null }
        githubBranch = if ($null -ne $gate) { $gate.branch } else { $null }
        githubRuns = if ($null -ne $gate) { $gate.githubRuns } else { @{} }
        createdAt = [DateTimeOffset]::UtcNow.ToString("o")
    }
    Assert-JobHelperReceiptChannel -Receipt ([pscustomobject]$candidateReceipt)
    Write-JsonAtomically -Value $candidateReceipt -Path $immutableReceiptPath

    # Candidate images and the served candidate runtime must pass every health
    # check before the active pointer or convenience aliases can change.
    & (Join-Path $PSScriptRoot "start-job-helper.ps1") `
        -ReleaseReceiptPath $immutableReceiptPath -SkipOperationLock
    if ($LASTEXITCODE -ne 0) { throw "Candidate startup failed with exit code $LASTEXITCODE." }

    $activationSnapshot = Get-JobHelperWorkspaceSnapshot -RepositoryRoot $PSScriptRoot
    Assert-JobHelperWorkspaceSnapshotEqual -Expected $buildSnapshot -Actual $activationSnapshot
    if ($channel -eq "release" -and $activationSnapshot.workingTreeDirty) {
        throw "Formal source became dirty before activation."
    }
    $activePointer = New-JobHelperActivePointer `
        -Channel $channel -BuildId $buildId `
        -ReceiptPath ".job-helper-releases/$buildId/receipt.json"
    $activePointer | Add-Member `
        -NotePropertyName activatedAt `
        -NotePropertyValue ([DateTimeOffset]::UtcNow.ToString("o"))
    Write-JsonAtomically -Value $activePointer -Path $activePointerPath
    $activationSucceeded = $true
}
catch {
    $candidateFailure = $_.Exception.Message
    $restoreFiles = {
        if ($null -ne $oldActiveReceiptPath) {
            $oldReceipt = Get-Content -Raw -LiteralPath $oldActiveReceiptPath | ConvertFrom-Json
            if (@($oldReceipt.artifacts).Count -eq 4) {
                Restore-PublishedFilesFromReceipt -ReceiptPath $oldActiveReceiptPath
            }
            else { Restore-TemporaryPublishedFiles }
        }
        else { Restore-TemporaryPublishedFiles }
    }
    $startOld = if ($null -ne $oldActiveReceiptPath) {
        {
            & (Join-Path $PSScriptRoot "start-job-helper.ps1") `
                -ReleaseReceiptPath $oldActiveReceiptPath -SkipOperationLock
            if ($LASTEXITCODE -ne 0) { throw "Old active release startup failed." }
        }
    }
    else { $null }
    Invoke-JobHelperCandidateRollback `
        -RestorePublishedFiles $restoreFiles `
        -StartOldRelease $startOld `
        -RemoveCandidateContainers { Remove-CandidateProjectContainers } `
        -CandidateFailure $candidateFailure
    $rollbackOutcome = if ($null -ne $oldActiveReceiptPath) {
        "Previous active release was restored."
    }
    else { "No previous release existed; candidate containers were removed." }
    throw "Candidate activation failed: $candidateFailure $rollbackOutcome"
}
finally {
    if (Test-Path -LiteralPath $rollbackDirectory) {
        Remove-Item -LiteralPath $rollbackDirectory -Recurse -Force
    }
}

if ($activationSucceeded) {
    try { Write-JsonAtomically -Value $candidateReceipt -Path $stableReceiptPath }
    catch { Write-Warning "Stable channel receipt update failed; immutable active receipt remains valid." }
}

if (-not $EmergencyPreview -and $activationSucceeded) {
    # Aliases are convenience only. The receipt continues to reference and
    # verify the immutable candidate tag and image ID.
    & docker image tag $backendImage "job-helper-backend:release"
    if ($LASTEXITCODE -ne 0) { Write-Warning "Backend :release alias update failed; active receipt remains valid." }
    & docker image tag $agentImage "job-helper-agent:release"
    if ($LASTEXITCODE -ne 0) { Write-Warning "Agent :release alias update failed; active receipt remains valid." }
}

Write-Host "Release receipt: channel=$channel sha=$sourceSha source_identity=$($buildReceipt.sourceIdentity) build_id=$buildId runtime_sha256=$($buildReceipt.runtimeSha256)"
Write-Host "Active pointer: $activePointerPath"
Write-Host "Browser installation/badge verification remains a separate explicitly authorized step."
}
finally {
    Exit-JobHelperOperationLock -Mutex $operationLock
}

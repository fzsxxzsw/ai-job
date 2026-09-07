[CmdletBinding()]
param([string]$BuildId = "")

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-Location -LiteralPath $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot "job-helper-release-common.psm1") -Force
$operationLock = Enter-JobHelperOperationLock -WorkspaceRoot $PSScriptRoot
$environmentNames = @("JOB_HELPER_BUILD_ID", "JOB_HELPER_BUILD_SHA", "JOB_HELPER_BUILD_CHANNEL", "JOB_HELPER_VERSION", "JOB_HELPER_BACKEND_IMAGE", "JOB_HELPER_AGENT_IMAGE", "PATH")
$oldEnvironment = @{}
foreach ($name in $environmentNames) { $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name) }
try {
    foreach ($command in @("git", "docker", "node", "uv", "corepack.cmd")) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Required command missing: $command" }
    }
    $null = & docker info --format '{{.ServerVersion}}'
    if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running." }
    $envPath = Join-Path $PSScriptRoot '.env'
    if (-not (Test-Path -LiteralPath $envPath)) { throw '.env is missing.' }
    $snapshot = Get-JobHelperWorkspaceSnapshot -RepositoryRoot $PSScriptRoot
    if (-not $BuildId) { $BuildId = "local-$($snapshot.sourceIdentity)-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))" }
    if ($BuildId -notmatch '^[a-z0-9][a-z0-9._-]{2,79}$') { throw 'BuildId must be 3-80 lowercase tag-safe characters.' }
    $ui = Join-Path $PSScriptRoot 'ai-job-hunting-ui'
    $version = [string](Get-Content -LiteralPath (Join-Path $ui 'package.json') -Raw | ConvertFrom-Json).version
    $candidate = Resolve-JobHelperChildPath -Root $PSScriptRoot -Path '.job-helper-builds/candidate'
    # One replaceable unpublished candidate; current and previous are independent.
    Remove-JobHelperManagedDirectory -Root $PSScriptRoot -Path '.job-helper-builds/candidate'
    New-Item -ItemType Directory -Path $candidate -Force | Out-Null
    $env:JOB_HELPER_BUILD_ID = $BuildId
    $env:JOB_HELPER_BUILD_SHA = $snapshot.headSha
    $env:JOB_HELPER_BUILD_CHANNEL = 'local'
    $env:JOB_HELPER_VERSION = $version
    $env:JOB_HELPER_BACKEND_IMAGE = 'job-helper-backend:local-candidate'
    $env:JOB_HELPER_AGENT_IMAGE = 'job-helper-agent:local-candidate'
    $tooling = Resolve-JobHelperChildPath -Root $PSScriptRoot -Path '.job-helper-builds/tooling'
    New-Item -ItemType Directory -Path $tooling -Force | Out-Null
    $corepack = (Get-Command corepack.cmd).Source
    $pnpm = Join-Path $tooling 'pnpm.cmd'
    # Pin nested package.json invocations as well as the top-level command.
    Set-Content -LiteralPath $pnpm -Encoding ascii -Value ('@"' + $corepack + '" pnpm@9.15.9 %*')
    $env:PATH = $tooling + [IO.Path]::PathSeparator + $env:PATH
    $pnpmVersion = @(& $pnpm --version)
    if ($LASTEXITCODE -ne 0 -or $pnpmVersion[-1] -ne '9.15.9') { throw 'Pinned pnpm 9.15.9 is unavailable.' }

    & (Join-Path $PSScriptRoot 'tests/job-helper-maintenance.tests.ps1')
    foreach ($project in @('ai-job-api', 'ai-job-agent')) {
        Push-Location -LiteralPath (Join-Path $PSScriptRoot $project)
        try {
            & uv sync --frozen
            if ($LASTEXITCODE -ne 0) { throw "$project dependency verification failed." }
            & uv run pytest
            if ($LASTEXITCODE -ne 0) { throw "$project tests failed." }
            if ($project -eq 'ai-job-api') {
                & uv run ruff check src tests
                if ($LASTEXITCODE -ne 0) { throw 'Python API lint failed.' }
                & uv run ruff format --check src tests
                if ($LASTEXITCODE -ne 0) { throw 'Python API format verification failed.' }
            }
        }
        finally { Pop-Location }
    }
    Push-Location -LiteralPath $ui
    try {
        & $pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency verification failed.' }
        & $pnpm run test
        if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }
        & $pnpm run typecheck
        if ($LASTEXITCODE -ne 0) { throw 'Frontend type checking failed.' }
        & $pnpm run build:extension
        if ($LASTEXITCODE -ne 0) { throw 'Chrome extension build/contract verification failed.' }
        & $pnpm run build:local:bundle
        if ($LASTEXITCODE -ne 0) { throw 'Compatibility runtime build failed.' }
        & node scripts/sync-local-runtime.mjs --validate-only
        if ($LASTEXITCODE -ne 0) { throw 'Compatibility runtime validation failed.' }
    }
    finally { Pop-Location }
    Copy-JobHelperTree -Source (Join-Path $ui '.output/chrome-mv3') -Destination (Join-Path $candidate 'extension')
    Copy-Item -LiteralPath (Join-Path $ui 'dist/ai-job-hunting.user.js') -Destination (Join-Path $candidate 'runtime.js')
    $manifest = Get-Content -LiteralPath (Join-Path $candidate 'extension/manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.version -ne $version -or $manifest.version_name -ne "$version+$BuildId") { throw 'Extension identity mismatch.' }

    & docker compose --env-file $envPath -f docker-compose.local.yml build backend agent
    if ($LASTEXITCODE -ne 0) { throw 'Python image build failed.' }
    $images = @{}
    foreach ($service in @('backend', 'agent')) {
        $imageOutput = @(& docker image inspect --format '{{.Id}}' "job-helper-${service}:local-candidate")
        if ($LASTEXITCODE -ne 0 -or $imageOutput[0] -notmatch '^sha256:[a-f0-9]{64}$') { throw "$service image identity unavailable." }
        $images[$service] = [string]$imageOutput[0]
    }
    Assert-JobHelperWorkspaceSnapshotEqual -Expected $snapshot -Actual (Get-JobHelperWorkspaceSnapshot -RepositoryRoot $PSScriptRoot)
    $receipt = [ordered]@{
        schemaVersion = 2; channel = 'local'; version = $version; buildId = $BuildId
        releaseSha = $snapshot.headSha; sourceIdentity = $snapshot.sourceIdentity
        sourceTreeHash = $snapshot.sourceTreeHash
        workingTreeDirty = $snapshot.workingTreeDirty; diffHash = $snapshot.diffHash
        backendImplementation = 'python'; backendImage = $images.backend; backendImageId = $images.backend
        agentImage = $images.agent; agentImageId = $images.agent
        extensionSha256 = Get-JobHelperTreeDigest -Directory (Join-Path $candidate 'extension')
        runtimeSha256 = (Get-FileHash -LiteralPath (Join-Path $candidate 'runtime.js') -Algorithm SHA256).Hash.ToLowerInvariant()
        createdAt = [DateTimeOffset]::UtcNow.ToString('o'); validation = 'API, Agent, UI, extension contract, maintenance tests'
    }
    Write-JobHelperJson -Value $receipt -Path (Join-Path $candidate 'receipt.json')
    Write-Host "Local candidate passed: version=$version build=$BuildId"
    Write-Host "Receipt: $(Join-Path $candidate 'receipt.json')"
    Write-Host 'No services started, database migrated, browser controlled, or extension installed.'
}
finally {
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name]) }
    Exit-JobHelperOperationLock -Mutex $operationLock
}

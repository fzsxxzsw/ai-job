[CmdletBinding()]
param(
    [switch]$ApplyMigrations,
    [string]$DatabaseBackupPath = '',
    [switch]$Recover
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-Location -LiteralPath $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'job-helper-release-common.psm1') -Force
$operationLock = Enter-JobHelperOperationLock -WorkspaceRoot $PSScriptRoot
$releaseRoot = Resolve-JobHelperChildPath -Root $PSScriptRoot -Path '.job-helper-releases'
$pending = Resolve-JobHelperChildPath -Root $releaseRoot -Path 'pending'
$current = Resolve-JobHelperChildPath -Root $releaseRoot -Path 'current'
$previous = Resolve-JobHelperChildPath -Root $releaseRoot -Path 'previous'
$activationPath = Join-Path $releaseRoot 'activation.json'
$activePath = Join-Path $PSScriptRoot '.job-helper-active.json'
$extensionTarget = Get-JobHelperExtensionTarget -RepositoryRoot $PSScriptRoot
$runtimePath = Join-Path $PSScriptRoot 'ai-job-hunting-ui/public/ai-job-hunting-runtime.js'
$envPath = Join-Path $PSScriptRoot '.env'
$composeFile = Join-Path $PSScriptRoot 'docker-compose.local.yml'
$environmentNames = @('JOB_HELPER_BACKEND_IMAGE', 'JOB_HELPER_AGENT_IMAGE', 'JOB_HELPER_BUILD_ID', 'JOB_HELPER_VERSION')
$oldEnvironment = @{}
foreach ($name in $environmentNames) { $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name) }

function Restore-LocalActivation {
    param([Parameter(Mandatory)][object]$Transaction)
    # Restore exact original containers, including Java's old environment/mounts.
    # Rebuilding an old Java image with the new Python Compose config is unsafe.
    foreach ($entry in @($Transaction.containers)) {
        $original = Get-JobHelperContainer -Name $entry.name -Service $entry.service
        if ($null -ne $original -and $original.Id -eq $entry.id) {
            if ($entry.wasRunning) {
                & docker start $entry.name | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'Original service restart failed.' }
            }
            continue
        }
        $old = Get-JobHelperContainer -Name $entry.rollbackName -Service $entry.service
        if ($null -eq $old) {
            throw "Original rollback container is missing: $($entry.service)"
        }
        if ($old.Id -ne $entry.id) { throw 'Rollback container identity changed.' }
        $candidateContainer = Get-JobHelperContainer -Name $entry.name -Service $entry.service
        if ($null -ne $candidateContainer) {
            & docker rm --force $candidateContainer.Id | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Could not stop/remove the candidate writer.' }
        }
        & docker rename $old.Id $entry.name
        if ($LASTEXITCODE -ne 0) { throw 'Could not restore the original container name.' }
        if ($entry.wasRunning) {
            & docker start $entry.name | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Original service restart failed.' }
        }
    }
    if ($Transaction.filesBackedUp) {
        Remove-JobHelperManagedDirectory -Root (Split-Path -Parent $extensionTarget) -Path (Split-Path -Leaf $extensionTarget)
        Copy-JobHelperTree -Source (Join-Path $pending 'before/extension') -Destination $extensionTarget
        if ($Transaction.runtimeExisted) { Copy-Item -LiteralPath (Join-Path $pending 'before/runtime.js') -Destination $runtimePath -Force }
        elseif (Test-Path -LiteralPath $runtimePath) { Remove-Item -LiteralPath $runtimePath -Force }
    }
    if ($Transaction.currentBackedUp) {
        Remove-JobHelperManagedDirectory -Root $releaseRoot -Path 'current'
        Copy-JobHelperTree -Source (Join-Path $pending 'before/current') -Destination $current
    }
    elseif (Test-Path -LiteralPath $current) {
        Remove-JobHelperManagedDirectory -Root $releaseRoot -Path 'current'
    }
    if (Test-Path -LiteralPath (Join-Path $pending 'before/active.json')) {
        Copy-Item -LiteralPath (Join-Path $pending 'before/active.json') -Destination $activePath -Force
    }
    elseif (Test-Path -LiteralPath $activePath) { Remove-Item -LiteralPath $activePath -Force }
    Remove-Item -LiteralPath $activationPath -Force
    Write-Warning 'Activation rolled back; additive schema is retained. Database backups are never automatically restored over user data.'
}

try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker is required.' }
    $null = & docker info --format '{{.ServerVersion}}'
    if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running.' }
    if (Test-Path -LiteralPath $activationPath) {
        if (-not $Recover) { throw 'An interrupted activation exists; inspect it, then run release-job-helper.ps1 -Recover.' }
        Restore-LocalActivation -Transaction (Get-Content -LiteralPath $activationPath -Raw | ConvertFrom-Json)
        return
    }
    if ($Recover) { throw 'There is no interrupted activation to recover.' }
    $candidate = Resolve-JobHelperChildPath -Root $PSScriptRoot -Path '.job-helper-builds/candidate'
    $receipt = Get-Content -LiteralPath (Join-Path $candidate 'receipt.json') -Raw | ConvertFrom-Json
    if ($receipt.schemaVersion -ne 2 -or $receipt.channel -ne 'local') { throw 'Run build-job-helper.ps1 to create a verified local candidate first.' }
    Assert-JobHelperReceiptChannel -Receipt $receipt
    $expectedSnapshot = [pscustomobject]@{
        headSha = $receipt.releaseSha; workingTreeDirty = $receipt.workingTreeDirty
        diffHash = $receipt.diffHash; sourceIdentity = $receipt.sourceIdentity
    }
    Assert-JobHelperWorkspaceSnapshotEqual -Expected $expectedSnapshot -Actual (Get-JobHelperWorkspaceSnapshot -RepositoryRoot $PSScriptRoot)
    if ((Get-JobHelperTreeDigest -Directory (Join-Path $candidate 'extension')) -ne $receipt.extensionSha256 -or
        (Get-FileHash -LiteralPath (Join-Path $candidate 'runtime.js') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $receipt.runtimeSha256) {
        throw 'Candidate artifacts changed after successful build.'
    }
    # Resolve every existing service before stopping any: a name collision is not authorization.
    $oldContainers = @()
    foreach ($service in @('mysql', 'frontend', 'backend', 'agent')) {
        $metadata = Get-JobHelperContainer -Name "job-helper-$service" -Service $service
        if ($null -eq $metadata -and $service -in @('mysql', 'backend', 'agent')) {
            throw "Expected existing service is missing: $service. Provisioning a new database is a separate operation."
        }
        if ($service -in @('backend', 'agent')) {
            $oldContainers += [pscustomobject]@{service=$service; name="job-helper-$service"; rollbackName="job-helper-$service-rollback"; id=$metadata.Id; wasRunning=$metadata.State.Running}
        }
    }
    foreach ($image in @('nginx:1.27-alpine', 'mysql:8.0', $receipt.backendImage, $receipt.agentImage)) {
        $null = & docker image inspect $image
        if ($LASTEXITCODE -ne 0) { throw "Required local image unavailable: $image. Release does not pull images." }
    }
    New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
    Remove-JobHelperManagedDirectory -Root $releaseRoot -Path 'pending'
    New-Item -ItemType Directory -Path (Join-Path $pending 'before') -Force | Out-Null
    Copy-JobHelperTree -Source $extensionTarget -Destination (Join-Path $pending 'before/extension')
    $runtimeExisted = Test-Path -LiteralPath $runtimePath
    if ($runtimeExisted) { Copy-Item -LiteralPath $runtimePath -Destination (Join-Path $pending 'before/runtime.js') }
    if (Test-Path -LiteralPath $activePath) { Copy-Item -LiteralPath $activePath -Destination (Join-Path $pending 'before/active.json') }
    $currentBackedUp = Test-Path -LiteralPath $current
    if ($currentBackedUp) { Copy-JobHelperTree -Source $current -Destination (Join-Path $pending 'before/current') }
    Copy-JobHelperTree -Source $candidate -Destination (Join-Path $pending 'next')
    $transaction = [pscustomobject]@{schemaVersion=1; buildId=$receipt.buildId; containers=$oldContainers; filesBackedUp=$true; currentBackedUp=$currentBackedUp; runtimeExisted=$runtimeExisted; startedAt=[DateTimeOffset]::UtcNow.ToString('o')}
    Write-JobHelperJson -Value $transaction -Path $activationPath

    try {
        # One backend writer and one Agent writer. Stop both before database changes.
        foreach ($entry in $oldContainers) {
            & docker stop --time 30 $entry.id | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Unable to stop existing $($entry.service)." }
        }
        if ($ApplyMigrations) {
            if (-not $DatabaseBackupPath) { $DatabaseBackupPath = Resolve-JobHelperChildPath -Root $releaseRoot -Path 'database-before.sql' }
            elseif (Test-Path -LiteralPath $DatabaseBackupPath) {
                throw 'DatabaseBackupPath is an output path and must be unused. Old diagnostic backups cannot authorize migration.'
            }
            # Always create a fresh snapshot after every writer is stopped.
            # Shell text is fixed; credentials expand only inside the owned MySQL container.
            & docker exec job-helper-mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --events --hex-blob --set-gtid-purged=OFF --result-file=/tmp/job-helper-before.sql ai_job'
            if ($LASTEXITCODE -ne 0) { throw 'MySQL backup failed; migration has not started.' }
            & docker cp job-helper-mysql:/tmp/job-helper-before.sql $DatabaseBackupPath
            if ($LASTEXITCODE -ne 0) { throw 'MySQL backup copy failed; migration has not started.' }
            & docker exec job-helper-mysql rm -f /tmp/job-helper-before.sql
            if ($LASTEXITCODE -ne 0) { throw 'MySQL temporary backup cleanup failed.' }
            $backupHash = Assert-JobHelperDatabaseBackup -Path $DatabaseBackupPath
            $receipt | Add-Member -NotePropertyName databaseBackup -NotePropertyValue ([pscustomobject]@{path=[IO.Path]::GetFullPath($DatabaseBackupPath);sha256=$backupHash}) -Force
            $env:JOB_HELPER_BACKEND_IMAGE = $receipt.backendImage
            $env:JOB_HELPER_AGENT_IMAGE = $receipt.agentImage
            $env:JOB_HELPER_BUILD_ID = $receipt.buildId
            $env:JOB_HELPER_VERSION = $receipt.version
            & docker compose --env-file $envPath -f $composeFile run --rm --no-deps agent alembic -c /app/alembic.ini upgrade head
            if ($LASTEXITCODE -ne 0) { throw 'Agent schema migration failed.' }
            $migrationAudit = [pscustomobject]@{databaseBackup=$receipt.databaseBackup;status='started';ownerReplyPause=$null;startedAt=[DateTimeOffset]::UtcNow.ToString('o')}
            $migrationAuditPath = Join-Path $releaseRoot 'last-migration.json'
            Write-JobHelperJson -Value $migrationAudit -Path $migrationAuditPath
            $migrationOutput = @(& docker compose --env-file $envPath -f $composeFile run --rm --no-deps backend python -m job_helper_api.migrate --apply --pause-owner)
            $migrationExitCode = $LASTEXITCODE
            foreach ($line in $migrationOutput) {
                if ([string]$line -match '^OWNER_REPLY_PAUSED userId=(\d+) previousStatus=(\d+); rollback stays paused$') {
                    $pause = [pscustomobject]@{userId=[long]$Matches[1];previousStatus=[int]$Matches[2];restoreAutomatically=$false}
                    $migrationAudit.ownerReplyPause = $pause
                    $receipt | Add-Member -NotePropertyName ownerReplyPause -NotePropertyValue $pause -Force
                }
            }
            $migrationAudit.status = if ($migrationExitCode -eq 0) { 'applied' } else { 'failed' }
            Write-JobHelperJson -Value $migrationAudit -Path $migrationAuditPath
            if ($migrationExitCode -ne 0) { throw 'Python business schema migration failed; any reply pause remains in effect. See last-migration.json.' }
            if ($null -eq $migrationAudit.ownerReplyPause) { throw 'Migration did not confirm the bound owner reply pause.' }
            Write-Host 'The bound owner AI replies are paused. They remain paused on success and rollback until explicitly re-enabled.'
        }
        # Retain exactly one prior container pair; Docker never removes their volumes.
        foreach ($entry in $oldContainers) {
            $older = Get-JobHelperContainer -Name $entry.rollbackName -Service $entry.service
            if ($null -ne $older) {
                if ($older.State.Running) { throw 'A rollback container is running; refusing a second writer.' }
                & docker rm $older.Id | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'Unable to retire the older rollback container.' }
            }
            & docker rename $entry.id $entry.rollbackName
            if ($LASTEXITCODE -ne 0) { throw 'Could not preserve the old container before activation.' }
        }
        Remove-JobHelperManagedDirectory -Root (Split-Path -Parent $extensionTarget) -Path (Split-Path -Leaf $extensionTarget)
        Copy-JobHelperTree -Source (Join-Path $pending 'next/extension') -Destination $extensionTarget
        Copy-Item -LiteralPath (Join-Path $pending 'next/runtime.js') -Destination $runtimePath -Force
        foreach ($name in @('frontend', 'mysql')) {
            $imageName = if ($name -eq 'frontend') { 'nginx:1.27-alpine' } else { 'mysql:8.0' }
            $imageId = @(& docker image inspect --format '{{.Id}}' $imageName)[0]
            if ($LASTEXITCODE -ne 0) { throw 'Infrastructure identity inspection failed.' }
            $receipt | Add-Member -NotePropertyName "${name}Image" -NotePropertyValue $imageName -Force
            $receipt | Add-Member -NotePropertyName "${name}ImageId" -NotePropertyValue $imageId -Force
        }
        $receipt | Add-Member -NotePropertyName extensionTarget -NotePropertyValue $extensionTarget -Force
        $receipt | Add-Member -NotePropertyName activatedAt -NotePropertyValue ([DateTimeOffset]::UtcNow.ToString('o')) -Force
        Write-JobHelperJson -Value $receipt -Path (Join-Path $pending 'next/receipt.json')
        $env:JOB_HELPER_BACKEND_IMAGE = $receipt.backendImage
        $env:JOB_HELPER_AGENT_IMAGE = $receipt.agentImage
        $env:JOB_HELPER_BUILD_ID = $receipt.buildId
        $env:JOB_HELPER_VERSION = $receipt.version
        foreach ($service in @('backend', 'agent')) {
            # A one-off named container does not let Compose select/recreate the
            # renamed rollback container that still has its original labels.
            & docker compose --env-file $envPath -f $composeFile run --detach --no-deps --pull never --service-ports --use-aliases --name "job-helper-$service" $service
            if ($LASTEXITCODE -ne 0) { throw "Candidate $service container creation failed." }
            $candidateContainer = Get-JobHelperContainer -Name "job-helper-$service" -Service $service
            if ($null -eq $candidateContainer -or $candidateContainer.Image -ne $receipt."${service}ImageId") {
                throw "Candidate $service image identity mismatch."
            }
            # Compose run forces restart=no even when the service declares
            # unless-stopped. Restore and inspect the policy on this exact owned ID.
            $candidateId = $candidateContainer.Id
            & docker update --restart unless-stopped $candidateId | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Candidate $service restart policy update failed." }
            $candidateContainer = Get-JobHelperContainer -Name "job-helper-$service" -Service $service
            if ($null -eq $candidateContainer -or $candidateContainer.Id -ne $candidateId -or
                $candidateContainer.Image -ne $receipt."${service}ImageId" -or
                $candidateContainer.HostConfig.RestartPolicy.Name -ne 'unless-stopped') {
                throw "Candidate $service restart policy verification failed."
            }
        }
        & (Join-Path $PSScriptRoot 'start-job-helper.ps1') -ReleaseReceiptPath (Join-Path $pending 'next/receipt.json') -SkipOperationLock
        Assert-JobHelperWorkspaceSnapshotEqual -Expected $expectedSnapshot -Actual (Get-JobHelperWorkspaceSnapshot -RepositoryRoot $PSScriptRoot)

        # Keep the recovery data untouched until the active pointer is committed.
        Remove-JobHelperManagedDirectory -Root $releaseRoot -Path 'previous'
        $previousSource = if ($currentBackedUp) { Join-Path $pending 'before/current' } else { Join-Path $pending 'before' }
        Copy-JobHelperTree -Source $previousSource -Destination $previous
        Remove-JobHelperManagedDirectory -Root $releaseRoot -Path 'current'
        Copy-JobHelperTree -Source (Join-Path $pending 'next') -Destination $current
        Write-JobHelperJson -Value (New-JobHelperActivePointer -Channel local -BuildId $receipt.buildId -ReceiptPath '.job-helper-releases/current/receipt.json') -Path $activePath
        Remove-Item -LiteralPath $activationPath -Force
    }
    catch {
        $failure = $_.Exception.Message
        try { Restore-LocalActivation -Transaction $transaction }
        catch { throw "Activation failed: $failure. Rollback failed: $($_.Exception.Message). Recovery record retained: $activationPath" }
        Remove-JobHelperManagedDirectory -Root $releaseRoot -Path 'pending'
        throw "Activation failed and previous runtime restored: $failure"
    }
    Remove-JobHelperManagedDirectory -Root $releaseRoot -Path 'pending'
    foreach ($service in @('backend','agent')) {
        & docker image tag $receipt."${service}Image" "job-helper-${service}:current"
        if ($LASTEXITCODE -ne 0) { Write-Warning "$service convenience tag update failed; exact image receipt remains valid." }
    }
    Write-Host "Activated local version=$($receipt.version) build=$($receipt.buildId)"
    Write-Host "Single Chrome directory: $extensionTarget"
    Write-Host 'Files are updated; Chrome has not been controlled or reloaded. Verify the visible badge separately before claiming browser acceptance.'
    Write-Host 'Commit the tested source and push to GitHub after local acceptance; record this build ID in the commit or release notes.'
}
finally {
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name]) }
    Exit-JobHelperOperationLock -Mutex $operationLock
}

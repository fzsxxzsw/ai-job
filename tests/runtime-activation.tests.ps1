# Release state-machine tests: temporary files + fake Docker only.
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) "job-helper-activation-$([Guid]::NewGuid().ToString('N'))"
$fixtureRepo = Join-Path $fixtureRoot 'repo'
New-Item -ItemType Directory -Path $fixtureRepo -Force | Out-Null
$realRoot = Split-Path -Parent $PSScriptRoot
$global:JobHelperFakeDocker = @{containers=@{}; events=(New-Object Collections.Generic.List[string]); next=0}
$global:JobHelperCandidateFail = $false
$global:JobHelperFailRecoveryStart = $false
$global:JobHelperFailMigration = $false
$global:JobHelperCandidateImageDrift = $false
$global:JobHelperFailRestartUpdate = $false
$global:JobHelperRestartPolicyDrift = $false
function global:docker {
    $a = @($args)
    $global:LASTEXITCODE = 0
    $state = $global:JobHelperFakeDocker
    $state.events.Add(($a -join ' '))
    if ($a[0] -eq 'info') { return 'fake' }
    if ($a[0] -eq 'container' -and $a[1] -eq 'inspect') {
        if (-not $state.containers.ContainsKey($a[2])) { $global:LASTEXITCODE = 1; return }
        return ($state.containers[$a[2]] | ConvertTo-Json -Depth 8 -Compress)
    }
    if ($a[0] -eq 'image') {
        if ($a[1] -eq 'tag') { return }
        if ($a -contains '--format') { return ('sha256:' + ('f' * 64)) }
        return '{}'
    }
    if ($a[0] -eq 'stop' -or $a[0] -eq 'start' -or $a[0] -eq 'rm') {
        if ($a[0] -eq 'start' -and $global:JobHelperFailRecoveryStart) { $global:LASTEXITCODE = 1; return }
        $identity = $a[-1]
        $key = @($state.containers.Keys | Where-Object { $_ -eq $identity -or $state.containers[$_].Id -eq $identity })[0]
        if (-not $key) { $global:LASTEXITCODE = 1; return }
        if ($a[0] -eq 'rm') { $state.containers.Remove($key) }
        else { $state.containers[$key].State.Running = $a[0] -eq 'start' }
        return
    }
    if ($a[0] -eq 'rename') {
        $key = @($state.containers.Keys | Where-Object { $state.containers[$_].Id -eq $a[1] })[0]
        if (-not $key -or $state.containers.ContainsKey($a[2])) { $global:LASTEXITCODE = 1; return }
        $state.containers[$a[2]] = $state.containers[$key]
        $state.containers.Remove($key)
        return
    }
    if ($a[0] -eq 'update') {
        if ($a.Count -ne 4 -or $a[1] -ne '--restart' -or $a[2] -ne 'unless-stopped') {
            throw 'Unexpected Docker restart policy update.'
        }
        $key = @($state.containers.Keys | Where-Object { $state.containers[$_].Id -eq $a[3] })[0]
        if (-not $key -or $global:JobHelperFailRestartUpdate) { $global:LASTEXITCODE = 1; return }
        if (-not $global:JobHelperRestartPolicyDrift) { $state.containers[$key].HostConfig.RestartPolicy.Name = 'unless-stopped' }
        return
    }
    if ($a[0] -eq 'compose' -and $a -contains 'run') {
        if ($a -contains '--rm') {
            if ($global:JobHelperFailMigration) { $global:LASTEXITCODE = 1 }
            elseif ($a -contains '--pause-owner') { return 'OWNER_REPLY_PAUSED userId=3 previousStatus=1; rollback stays paused' }
            return
        }
        $service = $a[-1]
        $state.next++
        $state.containers["job-helper-$service"] = [pscustomobject]@{
            Id="candidate-$($state.next)";Image='sha256:'+('a'*64)
            State=[pscustomobject]@{Running=$true}
            # Compose run overrides the service restart policy to no.
            HostConfig=[pscustomobject]@{RestartPolicy=[pscustomobject]@{Name='no'}}
            Config=[pscustomobject]@{Labels=[pscustomobject]@{'com.docker.compose.project'='job-helper';'com.docker.compose.service'=$service}}
        }
        if ($global:JobHelperCandidateImageDrift) { $state.containers["job-helper-$service"].Image = 'sha256:'+('d'*64) }
        return "candidate-$($state.next)"
    }
    if ($a[0] -eq 'exec') { return }
    if ($a[0] -eq 'cp') {
        Set-Content -LiteralPath $a[-1] -Value (('SQL' * 500) + "`n-- Dump completed on 2026-09-07 12:00:00")
        return
    }
    throw "Unhandled fake Docker command: $($a -join ' ')"
}
try {
    foreach ($file in @('release-job-helper.ps1', 'job-helper-release-common.psm1', 'stop-job-helper.ps1')) {
        Copy-Item -LiteralPath (Join-Path $realRoot $file) -Destination (Join-Path $fixtureRepo $file)
    }
    @'
param([string]$ReleaseReceiptPath, [switch]$SkipOperationLock)
if ($global:JobHelperCandidateFail) { throw 'Simulated failed health/identity verification.' }
'@ | Set-Content -LiteralPath (Join-Path $fixtureRepo 'start-job-helper.ps1')
    Set-Content -LiteralPath (Join-Path $fixtureRepo '.gitignore') -Value ".env`n.job-helper-*`nai-job-hunting-ui/public/ai-job-hunting-runtime.js"
    Set-Content -LiteralPath (Join-Path $fixtureRepo '.env') -Value 'fixture-only'
    Set-Content -LiteralPath (Join-Path $fixtureRepo 'docker-compose.local.yml') -Value 'name: job-helper'
    $extension = Join-Path $fixtureRoot 'job-helper-wxt-local-extension'
    New-Item -ItemType Directory -Path $extension -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $extension 'manifest.json') -Value '{"version":"old"}'
    $static = Join-Path $fixtureRepo 'ai-job-hunting-ui/public'
    New-Item -ItemType Directory -Path $static -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $static 'ai-job-hunting-runtime.js') -Value 'old-runtime'
    foreach ($service in @('mysql','frontend','backend','agent')) {
        $global:JobHelperFakeDocker.containers["job-helper-$service"] = [pscustomobject]@{
            Id="original-$service";Image='sha256:'+('b'*64);State=[pscustomobject]@{Running=$true}
            Config=[pscustomobject]@{Labels=[pscustomobject]@{'com.docker.compose.project'='job-helper';'com.docker.compose.service'=$service}}
        }
    }
    Push-Location -LiteralPath $fixtureRepo
    try {
        & git init --quiet
        & git -c user.name=Test -c user.email=test@example.invalid add .
        & git -c user.name=Test -c user.email=test@example.invalid commit --quiet -m fixture
        if ($LASTEXITCODE -ne 0) { throw 'Fixture Git initialization failed.' }
        foreach ($scenario in @('first-success','failed-migration','failed-candidate-image','failed-restart-update','failed-restart-policy','failed-next','recover-next','second-success')) {
            $candidate = Join-Path $fixtureRepo '.job-helper-builds/candidate'
            Remove-JobHelperManagedDirectory -Root $fixtureRepo -Path '.job-helper-builds/candidate'
            New-Item -ItemType Directory -Path (Join-Path $candidate 'extension') -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $candidate 'extension/manifest.json') -Value ('{"version":"'+$scenario+'"}')
            Set-Content -LiteralPath (Join-Path $candidate 'runtime.js') -Value $scenario
            $snapshot = Get-JobHelperWorkspaceSnapshot -RepositoryRoot $fixtureRepo
            $candidateReceipt = [pscustomobject]@{
                schemaVersion=2;channel='local';version='0.0.65';buildId=$scenario
                releaseSha=$snapshot.headSha;sourceIdentity=$snapshot.sourceIdentity;workingTreeDirty=$snapshot.workingTreeDirty;diffHash=$snapshot.diffHash
                backendImage='sha256:'+('a'*64);backendImageId='sha256:'+('a'*64);agentImage='sha256:'+('a'*64);agentImageId='sha256:'+('a'*64)
                extensionSha256=(Get-JobHelperTreeDigest (Join-Path $candidate 'extension'))
                runtimeSha256=(Get-FileHash (Join-Path $candidate 'runtime.js')).Hash.ToLowerInvariant()
            }
            Write-JobHelperJson $candidateReceipt (Join-Path $candidate 'receipt.json')
            $global:JobHelperCandidateFail = $scenario -in @('failed-next', 'recover-next')
            $global:JobHelperFailRecoveryStart = $scenario -eq 'recover-next'
            $global:JobHelperFailMigration = $scenario -eq 'failed-migration'
            $global:JobHelperCandidateImageDrift = $scenario -eq 'failed-candidate-image'
            $global:JobHelperFailRestartUpdate = $scenario -eq 'failed-restart-update'
            $global:JobHelperRestartPolicyDrift = $scenario -eq 'failed-restart-policy'
            $expectFailure = $scenario -ne 'first-success' -and $scenario -ne 'second-success'
            $failed = $false
            $failureMessage = ''
            $applySchema = $scenario -in @('failed-migration', 'second-success')
            try { & (Join-Path $fixtureRepo 'release-job-helper.ps1') -ApplyMigrations:$applySchema }
            catch { $failed = $true; $failureMessage = $_.Exception.Message; if (-not $expectFailure) { throw } }
            if ($failed -ne $expectFailure) { throw "Unexpected activation result: $scenario" }
            $expectedFailures = @{
                'failed-candidate-image' = 'Candidate backend image identity mismatch'
                'failed-restart-update' = 'Candidate backend restart policy update failed'
                'failed-restart-policy' = 'Candidate backend restart policy verification failed'
            }
            if ($expectedFailures.ContainsKey($scenario) -and -not $failureMessage.Contains($expectedFailures[$scenario])) {
                throw "Candidate validation failed for the wrong reason: $failureMessage"
            }
            if ($scenario -eq 'recover-next') {
                if (-not (Test-Path (Join-Path $fixtureRepo '.job-helper-releases/activation.json'))) { throw 'Failed rollback lost its recovery record.' }
                $global:JobHelperFailRecoveryStart = $false
                & (Join-Path $fixtureRepo 'release-job-helper.ps1') -Recover
            }
            $active = Get-Content (Join-Path $fixtureRepo '.job-helper-active.json') -Raw | ConvertFrom-Json
            $expected = if ($failed) { 'first-success' } else { $scenario }
            if ($active.buildId -ne $expected -or (Get-Content (Join-Path $static 'ai-job-hunting-runtime.js') -Raw).Trim() -ne $expected) {
                throw 'Failed candidate contaminated current pointer or runtime files.'
            }
            if (-not $global:JobHelperFakeDocker.containers['job-helper-backend'].State.Running -or
                -not $global:JobHelperFakeDocker.containers['job-helper-agent'].State.Running) { throw 'Current writer was not restored/running.' }
            foreach ($service in @('backend', 'agent')) {
                if ($global:JobHelperFakeDocker.containers["job-helper-$service"].HostConfig.RestartPolicy.Name -ne 'unless-stopped') {
                    throw "Current $service lacks its automatic restart policy."
                }
            }
            if (Test-Path (Join-Path $fixtureRepo '.job-helper-releases/activation.json')) { throw 'Completed activation left an unresolved transaction.' }
            if ($scenario -eq 'second-success') {
                $audit = Get-Content (Join-Path $fixtureRepo '.job-helper-releases/last-migration.json') -Raw | ConvertFrom-Json
                if ($audit.status -ne 'applied' -or $audit.ownerReplyPause.userId -ne 3 -or
                    $audit.ownerReplyPause.previousStatus -ne 1 -or $audit.ownerReplyPause.restoreAutomatically) {
                    throw 'Explicit migration lost its owner pause audit or would restore automated replies.'
                }
            }
        }
        $containerCount = $global:JobHelperFakeDocker.containers.Count
        & (Join-Path $fixtureRepo 'stop-job-helper.ps1')
        if ($global:JobHelperFakeDocker.containers.Count -ne $containerCount) { throw 'Daily stop removed a rollback/current container.' }
        foreach ($service in @('mysql','frontend','backend','agent')) {
            if ($global:JobHelperFakeDocker.containers["job-helper-$service"].State.Running) { throw 'Daily stop missed a current service.' }
        }
        if ($global:JobHelperFakeDocker.events -match 'volume rm|compose.*\bdown\b|compose.*\bup\b|image prune') { throw 'Lifecycle touched an unsafe global operation.' }
    }
    finally { Pop-Location }
}
finally {
    Remove-Item -LiteralPath Function:\docker -Force
    Set-Location -LiteralPath $realRoot
    Remove-JobHelperManagedDirectory -Root ([IO.Path]::GetTempPath()) -Path (Split-Path -Leaf $fixtureRoot)
    Remove-Variable -Scope Global -Name JobHelperFakeDocker,JobHelperCandidateFail,JobHelperFailRecoveryStart,JobHelperFailMigration,JobHelperCandidateImageDrift,JobHelperFailRestartUpdate,JobHelperRestartPolicyDrift -ErrorAction SilentlyContinue
}

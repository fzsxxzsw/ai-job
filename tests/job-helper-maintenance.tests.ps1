$ErrorActionPreference = "Stop"
$modulePath = Join-Path (Split-Path -Parent $PSScriptRoot) "job-helper-release-common.psm1"
Import-Module $modulePath -Force

function Assert-Equal {
    param([object]$Actual, [object]$Expected, [string]$Name)
    if ($Actual -ne $Expected) { throw "$Name expected '$Expected' but got '$Actual'." }
}

$required = @(Get-JobHelperRequiredWorkflows)
Assert-Equal -Actual $required.Count -Expected 3 -Name "workflow count"
foreach ($name in @("UI build", "Local runtime maintenance", "Python Agent build")) {
    if ($required -notcontains $name) { throw "Required workflow missing: $name" }
}

$retryState = [pscustomobject]@{
    attempts = 0
    delays = New-Object Collections.Generic.List[int]
}
$retryOutput = Invoke-JobHelperRetryProbe `
    -CommandLabel "git ls-remote" `
    -DelayMilliseconds 5 `
    -Delay { param($milliseconds) $retryState.delays.Add($milliseconds) } `
    -Probe {
        $retryState.attempts++
        if ($retryState.attempts -lt 3) {
            return [pscustomobject]@{ ExitCode = 35; Output = "TLS handshake failed" }
        }
        return [pscustomobject]@{ ExitCode = 0; Output = "remote-ref" }
    }
Assert-Equal -Actual $retryOutput -Expected "remote-ref" -Name "third probe succeeds"
Assert-Equal -Actual $retryState.attempts -Expected 3 -Name "retry attempt count"
Assert-Equal -Actual $retryState.delays.Count -Expected 2 -Name "retry delay count"

$secretToken = "token-that-must-not-appear"
$failureState = [pscustomobject]@{ attempts = 0 }
$networkFailure = $null
try {
    Invoke-JobHelperRetryProbe `
        -CommandLabel "gh run list" `
        -DelayMilliseconds 0 `
        -Delay {} `
        -Probe {
            $failureState.attempts++
            return [pscustomobject]@{ ExitCode = 4; Output = "auth failed: $secretToken" }
        }
}
catch { $networkFailure = $_.Exception.Message }
Assert-Equal -Actual $failureState.attempts -Expected 3 -Name "retry upper bound"
if ([string]::IsNullOrWhiteSpace($networkFailure) -or
    -not $networkFailure.Contains("network/auth query failed") -or
    -not $networkFailure.Contains("gh run list") -or
    -not $networkFailure.Contains("exit code 4") -or
    $networkFailure.Contains($secretToken)) {
    throw "Exhausted network/auth retry did not produce a safe diagnostic."
}

$emptyState = [pscustomobject]@{
    attempts = 0
    delays = New-Object Collections.Generic.List[int]
}
$emptyOutput = @(Invoke-JobHelperRetryProbe `
    -CommandLabel "git ls-remote" `
    -DelayMilliseconds 5 `
    -Delay { param($milliseconds) $emptyState.delays.Add($milliseconds) } `
    -Probe {
        $emptyState.attempts++
        return [pscustomobject]@{ ExitCode = 0; Output = @() }
    })
Assert-Equal -Actual $emptyState.attempts -Expected 1 -Name "empty successful probe count"
Assert-Equal -Actual $emptyState.delays.Count -Expected 0 -Name "empty successful probe delay count"
Assert-Equal -Actual $emptyOutput.Count -Expected 0 -Name "empty successful probe output"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$buildScript = Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot "build-job-helper.ps1")
$startScript = Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot "start-job-helper.ps1")
$releaseScript = Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot "release-job-helper.ps1")
$composeScript = Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot "docker-compose.local.yml")
$imageProbePattern = '\$ErrorActionPreference\s*=\s*"Continue"\s*\r?\n\s*\$null\s*=\s*& docker image inspect \$immutableImage 2>\$null\s*\r?\n\s*\$imageExists\s*=\s*\$LASTEXITCODE -eq 0'
if ($buildScript -notmatch $imageProbePattern -or $buildScript -notmatch 'if \(\$imageExists\)') {
    throw "Build must treat a missing immutable Docker tag as a normal probe result on Windows PowerShell."
}

$remoteProbePattern = '\$remoteUrls\s*=\s*@\(& git remote get-url \$RemoteName 2>\$null\)\s*\r?\n\s*\$remoteExitCode\s*=\s*\$LASTEXITCODE\s*\r?\n\s*\$remoteUrl\s*=\s*\$remoteUrls\s*\|\s*Select-Object -First 1'
if ($releaseScript -notmatch $remoteProbePattern) {
    throw "Release must capture git remote exit status before selecting the first URL."
}
if ($releaseScript -match '& git remote get-url \$RemoteName 2>\$null \| Select-Object') {
    throw "Release must not read LASTEXITCODE after piping git remote output."
}
$expectedFrontendHealthLine = 'test: ["CMD-SHELL", "tmp=$$(mktemp) || exit 1; trap ''rm -f \"$$tmp\"'' EXIT; wget -qO \"$$tmp\" http://127.0.0.1/healthz || exit 1; hex=$$(od -An -tx1 \"$$tmp\" | tr -d '' \\n''); case \"$$hex\" in 6f6b|6f6b0a|6f6b0d0a) exit 0 ;; *) exit 1 ;; esac"]'
if (-not $composeScript.Contains($expectedFrontendHealthLine)) {
    throw "Frontend healthcheck must use the exact byte whitelist and cleanup-safe temporary-file probe."
}
if (-not $expectedFrontendHealthLine.Contains('wget -qO \"$$tmp\" http://127.0.0.1/healthz || exit 1') -or
    -not $expectedFrontendHealthLine.Contains('trap ''rm -f \"$$tmp\"'' EXIT')) {
    throw "Frontend healthcheck must preserve wget failure and clean its temporary file."
}

function Test-FrontendHealthBytes {
    param([AllowEmptyCollection()][byte[]]$Bytes)
    $hex = ($Bytes | ForEach-Object { $_.ToString("x2") }) -join ""
    return $hex -in @("6f6b", "6f6b0a", "6f6b0d0a")
}
$validHealthFixtures = @(
    [pscustomobject]@{ name = "no newline"; bytes = [byte[]]@(0x6f, 0x6b) },
    [pscustomobject]@{ name = "LF"; bytes = [byte[]]@(0x6f, 0x6b, 0x0a) },
    [pscustomobject]@{ name = "CRLF"; bytes = [byte[]]@(0x6f, 0x6b, 0x0d, 0x0a) }
)
foreach ($fixture in $validHealthFixtures) {
    if (-not (Test-FrontendHealthBytes -Bytes $fixture.bytes)) {
        throw "Valid frontend health fixture was rejected: $($fixture.name)"
    }
}
$invalidHealthFixtures = @(
    [pscustomobject]@{ name = "empty"; bytes = [byte[]]@() },
    [pscustomobject]@{ name = "okay"; bytes = [byte[]]@(0x6f, 0x6b, 0x61, 0x79) },
    [pscustomobject]@{ name = "embedded CR"; bytes = [byte[]]@(0x6f, 0x0d, 0x6b) },
    [pscustomobject]@{ name = "two LF"; bytes = [byte[]]@(0x6f, 0x6b, 0x0a, 0x0a) },
    [pscustomobject]@{ name = "two CRLF"; bytes = [byte[]]@(0x6f, 0x6b, 0x0d, 0x0a, 0x0d, 0x0a) },
    [pscustomobject]@{ name = "multiple lines"; bytes = [byte[]]@(0x6f, 0x6b, 0x0a, 0x62, 0x61, 0x64, 0x0a) }
)
foreach ($fixture in $invalidHealthFixtures) {
    if (Test-FrontendHealthBytes -Bytes $fixture.bytes) {
        throw "Invalid frontend health fixture was accepted: $($fixture.name)"
    }
}
if ($startScript -match '(?i)\balembic\b') {
    throw "Daily startup must not run Agent database migrations."
}
if ($releaseScript -notmatch 'alembic\s+-c\s+/app/alembic\.ini\s+upgrade\s+head') {
    throw "Release must apply the explicit versioned Agent migration."
}

$head = "0123456789abcdef0123456789abcdef01234567"
$diff = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
Assert-Equal -Actual (Get-JobHelperSourceIdentity -HeadSha $head -WorkingTreeDirty $false) `
    -Expected "0123456789ab" -Name "clean identity"
Assert-Equal -Actual (Get-JobHelperSourceIdentity -HeadSha $head -WorkingTreeDirty $true -DiffHash $diff) `
    -Expected "0123456789ab-dabcdef012345" -Name "dirty identity"
Assert-Equal -Actual (Get-JobHelperCandidateImageTag -BuildId "release-0123456789ab-20260902") `
    -Expected "candidate-release-0123456789ab-20260902" -Name "candidate tag"

$formal = [pscustomobject]@{
    channel = "release"
    backendImage = "job-helper-backend:candidate-release-0123456789ab-20260902"
    agentImage = "job-helper-agent:candidate-release-0123456789ab-20260902"
}
Assert-JobHelperReceiptChannel -Receipt $formal

$invalidFormal = [pscustomobject]@{
    channel = "release"
    backendImage = "job-helper-backend:release"
    agentImage = "job-helper-agent:release"
}
$rejected = $false
try { Assert-JobHelperReceiptChannel -Receipt $invalidFormal }
catch { $rejected = $true }
if (-not $rejected) { throw "Mutable formal image aliases were accepted by a formal receipt." }

$emergency = [pscustomobject]@{
    channel = "emergency"
    backendImage = "job-helper-backend:emergency-0123456789ab-dabcdef012345-20260902"
    agentImage = "job-helper-agent:emergency-0123456789ab-dabcdef012345-20260902"
}
Assert-JobHelperReceiptChannel -Receipt $emergency

$releasePointer = New-JobHelperActivePointer `
    -Channel release -BuildId "release-test" `
    -ReceiptPath ".job-helper-releases/release-test/receipt.json"
$emergencyPointer = New-JobHelperActivePointer `
    -Channel emergency -BuildId "emergency-test" `
    -ReceiptPath ".job-helper-releases/emergency-test/receipt.json"
Assert-Equal -Actual $releasePointer.channel -Expected "release" -Name "release active channel"
Assert-Equal -Actual $emergencyPointer.channel -Expected "emergency" -Name "emergency active channel"
if ($releasePointer.receiptPath -eq $emergencyPointer.receiptPath) {
    throw "Emergency activation did not select an independent immutable receipt."
}

$imageA = "sha256:" + ("a" * 64)
$imageB = "sha256:" + ("b" * 64)
foreach ($name in @("frontend", "mysql", "backend", "agent")) {
    Assert-JobHelperImageIdentity -ExpectedImageId $imageA -ActualImageId $imageA -Name $name
}
$imageDriftRejected = $false
try { Assert-JobHelperImageIdentity -ExpectedImageId $imageA -ActualImageId $imageB -Name "agent" }
catch { $imageDriftRejected = $true }
if (-not $imageDriftRejected) { throw "Image ID drift was accepted." }

$snapshotA = [pscustomobject]@{
    headSha = $head; workingTreeDirty = $false; diffHash = ""; sourceIdentity = "0123456789ab"
}
$snapshotB = [pscustomobject]@{
    headSha = $head; workingTreeDirty = $true; diffHash = $diff; sourceIdentity = "0123456789ab-dabcdef012345"
}
Assert-JobHelperWorkspaceSnapshotEqual -Expected $snapshotA -Actual $snapshotA
$sourceChangeRejected = $false
try { Assert-JobHelperWorkspaceSnapshotEqual -Expected $snapshotA -Actual $snapshotB }
catch { $sourceChangeRejected = $true }
if (-not $sourceChangeRejected) { throw "Build-time workspace source change was accepted." }

$rollbackEvents = New-Object Collections.Generic.List[string]
Invoke-JobHelperCandidateRollback `
    -RestorePublishedFiles { $rollbackEvents.Add("restore") } `
    -StartOldRelease { $rollbackEvents.Add("start-old") } `
    -RemoveCandidateContainers { $rollbackEvents.Add("remove") } `
    -CandidateFailure "candidate unhealthy"
Assert-Equal -Actual ($rollbackEvents -join ",") -Expected "restore,start-old" -Name "old release rollback"
$rollbackEvents.Clear()
Invoke-JobHelperCandidateRollback `
    -RestorePublishedFiles { $rollbackEvents.Add("restore") } `
    -StartOldRelease $null `
    -RemoveCandidateContainers { $rollbackEvents.Add("remove") } `
    -CandidateFailure "candidate unhealthy"
Assert-Equal -Actual ($rollbackEvents -join ",") -Expected "restore,remove" -Name "no-old-release rollback"
$doubleFailureReported = $false
try {
    Invoke-JobHelperCandidateRollback `
        -RestorePublishedFiles { throw "restore failed" } `
        -StartOldRelease $null `
        -RemoveCandidateContainers {} `
        -CandidateFailure "candidate unhealthy"
}
catch {
    $doubleFailureReported = $_.Exception.Message.Contains("Candidate activation failed") -and
        $_.Exception.Message.Contains("Rollback also failed")
}
if (-not $doubleFailureReported) { throw "Candidate plus rollback double failure was not reported." }

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "job-helper-test-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
try {
    $immutablePath = Join-Path $temporaryRoot "receipt.json"
    Assert-JobHelperImmutablePathAvailable -Path $immutablePath
    Set-Content -LiteralPath $immutablePath -Value "{}"
    $overwriteRejected = $false
    try { Assert-JobHelperImmutablePathAvailable -Path $immutablePath }
    catch { $overwriteRejected = $true }
    if (-not $overwriteRejected) { throw "Immutable receipt overwrite was accepted." }

    $firstLock = Enter-JobHelperOperationLock -WorkspaceRoot $temporaryRoot
    try {
        $concurrentRejected = $false
        try { $null = Enter-JobHelperOperationLock -WorkspaceRoot $temporaryRoot }
        catch { $concurrentRejected = $true }
        if (-not $concurrentRejected) { throw "Concurrent operation lock was accepted." }
    }
    finally { Exit-JobHelperOperationLock -Mutex $firstLock }
}
finally { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }

Write-Output "Job Helper maintenance behavior tests: PASS"

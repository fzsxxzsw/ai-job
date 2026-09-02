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

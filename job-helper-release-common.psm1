Set-StrictMode -Version Latest
$script:HeldOperationLocks = @{}

function Get-JobHelperRequiredWorkflows {
    return @("UI build", "Local runtime maintenance", "Python Agent build")
}

function Invoke-JobHelperRetryProbe {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][scriptblock]$Probe,
        [Parameter(Mandatory)][string]$CommandLabel,
        [ValidateRange(1, 3)][int]$MaxAttempts = 3,
        [ValidateRange(0, 5000)][int]$DelayMilliseconds = 750,
        [scriptblock]$Delay = { param([int]$Milliseconds) Start-Sleep -Milliseconds $Milliseconds }
    )
    $sanitizedLabel = $CommandLabel.Trim()
    if ($sanitizedLabel -notmatch '^[A-Za-z][A-Za-z0-9-]*(?: [A-Za-z][A-Za-z0-9-]*){0,2}$') {
        throw "Command label must contain only a short command name without arguments."
    }

    $lastExitCode = -1
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        $probeResult = & $Probe
        if ($null -eq $probeResult -or
            $probeResult.PSObject.Properties.Name -notcontains "ExitCode" -or
            $probeResult.PSObject.Properties.Name -notcontains "Output") {
            throw "Probe '$sanitizedLabel' must return ExitCode and Output."
        }
        $lastExitCode = [int]$probeResult.ExitCode
        if ($lastExitCode -eq 0) {
            return $probeResult.Output
        }
        if ($attempt -lt $MaxAttempts) {
            $null = & $Delay $DelayMilliseconds
        }
    }

    throw "network/auth query failed: $sanitizedLabel (exit code $lastExitCode) after $MaxAttempts attempts."
}

function Get-JobHelperSourceIdentity {
    param(
        [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$HeadSha,
        [Parameter(Mandatory)][bool]$WorkingTreeDirty,
        [AllowEmptyString()][string]$DiffHash = ""
    )
    $shortSha = $HeadSha.Substring(0, 12)
    if (-not $WorkingTreeDirty) { return $shortSha }
    if ($DiffHash -notmatch '^[a-f0-9]{64}$') {
        throw "Dirty working trees require a 64-character diff hash."
    }
    return "$shortSha-d$($DiffHash.Substring(0, 12))"
}

function Get-JobHelperTextSha256 {
    param([Parameter(Mandatory)][string]$Text)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
        return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
    }
    finally { $algorithm.Dispose() }
}

function Get-JobHelperWorkspaceSnapshot {
    param([Parameter(Mandatory)][string]$RepositoryRoot)
    Push-Location -LiteralPath $RepositoryRoot
    try {
        $head = (& git rev-parse HEAD | Select-Object -First 1).Trim().ToLowerInvariant()
        if ($head -notmatch '^[a-f0-9]{40}$') {
            throw "A valid Git HEAD is required."
        }
        $statusLines = @(& git status --porcelain=v1 --untracked-files=all)
        $dirty = $statusLines.Count -gt 0
        $diffHash = ""
        if ($dirty) {
            $diffLines = @(& git diff --binary HEAD -- .)
            $untracked = @(& git ls-files --others --exclude-standard | Sort-Object)
            $untrackedHashes = @($untracked | ForEach-Object {
                $hash = (& git hash-object -- $_ | Select-Object -First 1)
                "$_=$hash"
            })
            $diffHash = Get-JobHelperTextSha256 -Text (($statusLines + $diffLines + $untrackedHashes) -join "`n")
        }
        return [pscustomobject]@{
            headSha = $head
            workingTreeDirty = $dirty
            diffHash = $diffHash
            sourceIdentity = Get-JobHelperSourceIdentity -HeadSha $head -WorkingTreeDirty $dirty -DiffHash $diffHash
        }
    }
    finally { Pop-Location }
}

function Assert-JobHelperWorkspaceSnapshotEqual {
    param(
        [Parameter(Mandatory)][object]$Expected,
        [Parameter(Mandatory)][object]$Actual
    )
    foreach ($property in @("headSha", "workingTreeDirty", "diffHash", "sourceIdentity")) {
        if ($Expected.$property -ne $Actual.$property) {
            throw "Workspace source changed during the operation ($property)."
        }
    }
}

function Get-JobHelperCandidateImageTag {
    param([Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9._-]{2,79}$')][string]$BuildId)
    return "candidate-$BuildId"
}

function Assert-JobHelperReceiptChannel {
    param([Parameter(Mandatory)][object]$Receipt)
    if ($Receipt.channel -eq "release") {
        if ($Receipt.backendImage -notmatch '^job-helper-backend:candidate-' -or
            $Receipt.agentImage -notmatch '^job-helper-agent:candidate-') {
            throw "Formal receipts must reference immutable candidate images."
        }
        return
    }
    if ($Receipt.channel -eq "emergency") {
        if ($Receipt.backendImage -notmatch '^job-helper-backend:emergency-' -or
            $Receipt.agentImage -notmatch '^job-helper-agent:emergency-') {
            throw "Emergency receipts must reference isolated emergency images."
        }
        return
    }
    throw "Unknown release channel."
}

function Assert-JobHelperImageIdentity {
    param(
        [Parameter(Mandatory)][ValidatePattern('^sha256:[a-f0-9]{64}$')][string]$ExpectedImageId,
        [Parameter(Mandatory)][ValidatePattern('^sha256:[a-f0-9]{64}$')][string]$ActualImageId,
        [Parameter(Mandatory)][string]$Name
    )
    if ($ExpectedImageId -ne $ActualImageId) {
        throw "$Name image identity drifted from its immutable receipt."
    }
}

function Assert-JobHelperImmutablePathAvailable {
    param([Parameter(Mandatory)][string]$Path)
    if (Test-Path -LiteralPath $Path) {
        throw "Immutable artifact already exists: $Path"
    }
}

function New-JobHelperActivePointer {
    param(
        [Parameter(Mandatory)][ValidateSet("release", "emergency")][string]$Channel,
        [Parameter(Mandatory)][string]$BuildId,
        [Parameter(Mandatory)][string]$ReceiptPath
    )
    return [pscustomobject]@{
        schemaVersion = 1
        channel = $Channel
        buildId = $BuildId
        receiptPath = $ReceiptPath
    }
}

function Enter-JobHelperOperationLock {
    param([Parameter(Mandatory)][string]$WorkspaceRoot)
    $identity = (Get-JobHelperTextSha256 -Text ([IO.Path]::GetFullPath($WorkspaceRoot).ToLowerInvariant())).Substring(0, 20)
    $mutexName = "Local\JobHelperRelease-$identity"
    if ($script:HeldOperationLocks.ContainsKey($mutexName)) {
        throw "Another Job Helper build/start/release operation is already running."
    }
    $mutex = New-Object Threading.Mutex($false, $mutexName)
    if (-not $mutex.WaitOne(0)) {
        $mutex.Dispose()
        throw "Another Job Helper build/start/release operation is already running."
    }
    $script:HeldOperationLocks[$mutexName] = $mutex
    return $mutex
}

function Exit-JobHelperOperationLock {
    param([AllowNull()][object]$Mutex)
    if ($null -eq $Mutex) { return }
    try { $Mutex.ReleaseMutex() }
    finally {
        foreach ($name in @($script:HeldOperationLocks.Keys)) {
            if ([object]::ReferenceEquals($script:HeldOperationLocks[$name], $Mutex)) {
                $script:HeldOperationLocks.Remove($name)
            }
        }
        $Mutex.Dispose()
    }
}

function Invoke-JobHelperCandidateRollback {
    param(
        [Parameter(Mandatory)][scriptblock]$RestorePublishedFiles,
        [AllowNull()][scriptblock]$StartOldRelease,
        [Parameter(Mandatory)][scriptblock]$RemoveCandidateContainers,
        [Parameter(Mandatory)][string]$CandidateFailure
    )
    try {
        & $RestorePublishedFiles
        if ($null -ne $StartOldRelease) { & $StartOldRelease }
        else { & $RemoveCandidateContainers }
    }
    catch {
        throw "Candidate activation failed: $CandidateFailure Rollback also failed: $($_.Exception.Message)"
    }
}

Export-ModuleMember -Function @(
    "Get-JobHelperRequiredWorkflows",
    "Invoke-JobHelperRetryProbe",
    "Get-JobHelperSourceIdentity",
    "Get-JobHelperWorkspaceSnapshot",
    "Assert-JobHelperWorkspaceSnapshotEqual",
    "Get-JobHelperCandidateImageTag",
    "Assert-JobHelperReceiptChannel",
    "Assert-JobHelperImageIdentity",
    "Assert-JobHelperImmutablePathAvailable",
    "New-JobHelperActivePointer",
    "Enter-JobHelperOperationLock",
    "Exit-JobHelperOperationLock",
    "Invoke-JobHelperCandidateRollback"
)

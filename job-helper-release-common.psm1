Set-StrictMode -Version Latest
$script:HeldOperationLocks = @{}

function Get-JobHelperRequiredWorkflows {
    return @("UI build", "Local runtime maintenance", "Python Agent build", "Python API build", "Chrome extension build")
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
        $gitPath = (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
        # Windows PowerShell decodes native pipelines with the console code page.
        # Git emits UTF-8 paths; read its redirected streams explicitly instead.
        # Arguments here are fixed commands, never interpolated file names.
        $readGitOutput = {
            param([string]$Arguments)
            $process = New-Object Diagnostics.Process
            try {
                $process.StartInfo.FileName = $gitPath
                $process.StartInfo.Arguments = $Arguments
                $process.StartInfo.WorkingDirectory = $RepositoryRoot
                $process.StartInfo.UseShellExecute = $false
                $process.StartInfo.CreateNoWindow = $true
                $process.StartInfo.RedirectStandardOutput = $true
                $process.StartInfo.RedirectStandardError = $true
                $process.StartInfo.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
                $process.StartInfo.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
                if (-not $process.Start()) { throw 'Unable to start Git source inspection.' }
                $stdoutTask = $process.StandardOutput.ReadToEndAsync()
                $stderrTask = $process.StandardError.ReadToEndAsync()
                $process.WaitForExit()
                $stdout = $stdoutTask.GetAwaiter().GetResult()
                $null = $stderrTask.GetAwaiter().GetResult()
                if ($process.ExitCode -ne 0) { throw "Git source inspection failed: $Arguments" }
                return $stdout
            }
            finally { $process.Dispose() }
        }
        $head = (& $readGitOutput 'rev-parse HEAD').Trim().ToLowerInvariant()
        if ($head -notmatch '^[a-f0-9]{40}$') {
            throw "A valid Git HEAD is required."
        }
        $statusLines = @((& $readGitOutput 'status --porcelain=v1 -z --untracked-files=all').Split([char[]]@([char]0), [StringSplitOptions]::RemoveEmptyEntries))
        # Ordinal sorting gives PowerShell 5.1 and 7 the same manifest regardless
        # of their different .NET culture/collation implementations.
        $sourceFiles = New-Object 'Collections.Generic.SortedSet[string]' ([StringComparer]::Ordinal)
        foreach ($path in (& $readGitOutput 'ls-files -z --cached --others --exclude-standard').Split([char[]]@([char]0), [StringSplitOptions]::RemoveEmptyEntries)) {
            $null = $sourceFiles.Add($path)
        }
        $sourceEntries = @($sourceFiles | ForEach-Object {
            $filePath = Join-Path $RepositoryRoot $_
            if (Test-Path -LiteralPath $filePath -PathType Leaf) {
                "$_=$((Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant())"
            }
            # Only the files built into this tree contribute. A deleted tracked
            # path disappears from the index after commit without changing bytes.
        })
        $sourceTreeHash = Get-JobHelperTextSha256 -Text ($sourceEntries -join "`n")
        $dirty = $statusLines.Count -gt 0
        $diffHash = ""
        if ($dirty) {
            $diffText = & $readGitOutput 'diff --binary HEAD -- .'
            # The byte hashes also cover every untracked file, without a second
            # native command round-trip for non-ASCII or space-containing paths.
            $diffHash = Get-JobHelperTextSha256 -Text (($statusLines + @($diffText, $sourceTreeHash)) -join "`n")
        }
        return [pscustomobject]@{
            headSha = $head
            workingTreeDirty = $dirty
            diffHash = $diffHash
            sourceIdentity = Get-JobHelperSourceIdentity -HeadSha $head -WorkingTreeDirty $dirty -DiffHash $diffHash
            sourceTreeHash = $sourceTreeHash
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
    if ($Receipt.channel -eq "local") {
        foreach ($name in @("backend", "agent")) {
            if ($Receipt."${name}Image" -notmatch '^sha256:[a-f0-9]{64}$' -or
                $Receipt."${name}Image" -ne $Receipt."${name}ImageId") {
                throw "Local receipts must reference exact Docker image IDs."
            }
        }
        return
    }
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
        [Parameter(Mandatory)][ValidateSet("local", "release", "emergency")][string]$Channel,
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

function Resolve-JobHelperChildPath {
    param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Path)
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $fullPath = [IO.Path]::GetFullPath((Join-Path $rootPath $Path))
    if (-not $fullPath.StartsWith($rootPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Managed path escapes its allowed root: $Path"
    }
    # Refuse junctions/symlinks at every existing component, including the root.
    $cursor = $fullPath
    while ($cursor.Length -ge $rootPath.Length) {
        $item = Get-Item -LiteralPath $cursor -Force -ErrorAction SilentlyContinue
        if ($null -ne $item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Managed paths must not traverse a junction or symlink: $cursor"
        }
        if ($cursor -eq $rootPath) { break }
        $cursor = Split-Path -Parent $cursor
    }
    return $fullPath
}

function Remove-JobHelperManagedDirectory {
    param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Path)
    $fullPath = Resolve-JobHelperChildPath -Root $Root -Path $Path
    if (Test-Path -LiteralPath $fullPath) {
        # Validate descendants too: recursive deletion must never follow a junction.
        $links = @(Get-ChildItem -LiteralPath $fullPath -Force -Recurse | Where-Object {
            $_.Attributes -band [IO.FileAttributes]::ReparsePoint
        })
        if ($links.Count) { throw "Managed directory contains a junction or symlink." }
        Remove-Item -LiteralPath $fullPath -Recurse -Force
    }
}

function Write-JobHelperJson {
    param([Parameter(Mandatory)][object]$Value, [Parameter(Mandatory)][string]$Path)
    $temporary = "$Path.tmp"
    $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Get-JobHelperTreeDigest {
    param([Parameter(Mandatory)][string]$Directory)
    $rootPath = [IO.Path]::GetFullPath($Directory)
    $files = @(Get-ChildItem -LiteralPath $rootPath -Force -File -Recurse | Sort-Object FullName)
    if (-not $files.Count) { throw "Artifact directory is empty: $Directory" }
    $entries = @($files | ForEach-Object {
        $relative = $_.FullName.Substring($rootPath.Length).TrimStart('\', '/').Replace('\', '/')
        $null = Resolve-JobHelperChildPath -Root $rootPath -Path $relative
        "$relative=$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())"
    })
    return Get-JobHelperTextSha256 -Text ($entries -join "`n")
}

function Copy-JobHelperTree {
    param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Destination)
    $expected = Get-JobHelperTreeDigest -Directory $Source
    if (-not (Test-Path -LiteralPath $Destination)) { New-Item -ItemType Directory -Path $Destination | Out-Null }
    Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
    if ((Get-JobHelperTreeDigest -Directory $Destination) -ne $expected) { throw "Copied artifact tree failed hash verification." }
}

function Get-JobHelperExtensionTarget {
    param([Parameter(Mandatory)][string]$RepositoryRoot)
    # Fixed existing unpacked-extension path preserves Chrome's extension identity.
    return Resolve-JobHelperChildPath -Root (Split-Path -Parent $RepositoryRoot) -Path 'job-helper-wxt-local-extension'
}

function Assert-JobHelperOwnedContainer {
    param([Parameter(Mandatory)][object]$Metadata, [Parameter(Mandatory)][string]$Service)
    if ($Service -notin @("backend", "agent", "frontend", "mysql") -or
        $Metadata.Config.Labels.'com.docker.compose.project' -ne "job-helper" -or
        $Metadata.Config.Labels.'com.docker.compose.service' -ne $Service) {
        throw "Container is not owned by the expected Job Helper Compose service: $Service"
    }
}

function Get-JobHelperContainer {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Service)
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = @(& docker container inspect $Name 2>$null)
        $resultCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousPreference }
    if ($resultCode -ne 0) { return $null }
    $metadata = @($output | ConvertFrom-Json)[0]
    Assert-JobHelperOwnedContainer -Metadata $metadata -Service $Service
    return $metadata
}

function Assert-JobHelperDatabaseBackup {
    param([Parameter(Mandatory)][string]$Path)
    $file = Get-Item -LiteralPath $Path -Force
    if ($file.Length -lt 1024 -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Database backup is empty or unsafe."
    }
    $tailLines = @(Get-Content -LiteralPath $Path -Tail 8)
    if (@($tailLines -match '^-- Dump completed on ').Count -eq 0) {
        throw "Database backup has no successful mysqldump completion marker."
    }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
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
    "Invoke-JobHelperCandidateRollback",
    "Resolve-JobHelperChildPath",
    "Remove-JobHelperManagedDirectory",
    "Write-JobHelperJson",
    "Get-JobHelperTreeDigest",
    "Copy-JobHelperTree",
    "Get-JobHelperExtensionTarget",
    "Assert-JobHelperOwnedContainer",
    "Get-JobHelperContainer",
    "Assert-JobHelperDatabaseBackup"
)

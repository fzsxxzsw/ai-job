[CmdletBinding()]
param(
    [ValidateSet("all", "status", "runtime", "database", "rejections", "logs")]
    [string]$Action = "all",

    [ValidateRange(1, 1440)]
    [int]$SinceMinutes = 30,

    [ValidateRange(1, 500)]
    [int]$Tail = 200
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$composeFile = Join-Path $PSScriptRoot "docker-compose.local.yml"
$runtimeFile = Join-Path $PSScriptRoot "ai-job-hunting-ui\public\ai-job-hunting-runtime.js"
$runtimeUri = "http://127.0.0.1:5173/ai-job-hunting-runtime.js"
$frontendHealthUri = "http://127.0.0.1:5173/healthz"
$backendHealthUri = "http://127.0.0.1:9100/actuator/health"
$backendImageName = "job-helper-backend:latest"
$backendContainer = "job-helper-backend"
$mysqlContainer = "job-helper-mysql"

$containers = @(
    [ordered]@{ Name = "frontend"; Container = "job-helper-frontend" },
    [ordered]@{ Name = "mysql"; Container = $mysqlContainer },
    [ordered]@{ Name = "backend"; Container = $backendContainer }
)

# Keep the executable script ASCII-compatible so Windows PowerShell 5.1 does
# not reinterpret a UTF-8 source file without a BOM. The second value is the
# Unicode marker for the rejection-analysis button text.
$rejectionButtonMarker = -join ([char[]]@(0x5206, 0x6790, 0x8FD9, 0x6B21, 0x62D2, 0x7EDD))
$runtimeMarkers = [ordered]@{
    runtime_status   = "__AI_JOB_HELPER_RUNTIME_STATUS__"
    rejection_button = $rejectionButtonMarker
    rejection_debug = "__AI_JOB_HELPER_REJECTION_DEBUG__"
}

# The script rebuilds diagnostic log records from this list. Anything not on
# the list is counted and discarded without being printed.
$rejectionDiagnosticFields = @(
    "event",
    "outcome",
    "requestId",
    "userHash",
    "jobHash",
    "snapshotId",
    "analysisId",
    "source",
    "status",
    "completeness",
    "messageCount",
    "evidenceCount",
    "totalConfirmed",
    "visible",
    "durationMs",
    "errorCode",
    "action"
)

$backendKeywordPatterns = [ordered]@{
    rejection_diag = "(?i)\bREJECTION_DIAG\b"
    error          = "(?i)\bERROR\b|\bOutOfMemoryError\b|\b[A-Za-z0-9_.]+Exception\b"
    warning        = "(?i)\bWARN(?:ING)?\b"
    timeout        = "(?i)\btimeout\b|timed\s+out"
    connection     = "(?i)connection\s+refused|ConnectException"
}

$script:DiagnosticExitCode = 0

function Set-DiagnosticExitCode {
    param([ValidateRange(0, 2)][int]$Code)

    if ($Code -gt $script:DiagnosticExitCode) {
        $script:DiagnosticExitCode = $Code
    }
}

function Write-Section {
    param([Parameter(Mandatory)][string]$Title)

    Write-Output ""
    Write-Output ("[{0}]" -f $Title)
}

function Test-FixedEnum {
    param(
        [AllowNull()][string]$Value,
        [Parameter(Mandatory)][string[]]$Allowed
    )

    return -not [string]::IsNullOrWhiteSpace($Value) -and $Allowed -contains $Value
}

function Get-Sha256Hex {
    param([Parameter(Mandatory)][byte[]]$Bytes)

    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $algorithm.Dispose()
    }
}

function Get-HttpBytes {
    param([Parameter(Mandatory)][string]$Uri)

    $request = [Net.HttpWebRequest]::Create($Uri)
    $request.Method = "GET"
    $request.Timeout = 5000
    $request.ReadWriteTimeout = 5000
    $request.UserAgent = "job-helper-read-only-diagnostics/1.0"

    $response = $null
    $stream = $null
    $memory = New-Object IO.MemoryStream
    try {
        $response = $request.GetResponse()
        $stream = $response.GetResponseStream()
        $stream.CopyTo($memory)
        return ,$memory.ToArray()
    }
    finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
        if ($null -ne $response) {
            $response.Dispose()
        }
        $memory.Dispose()
    }
}

function Invoke-ReadOnlyMySqlQuery {
    param([Parameter(Mandatory)][string]$Sql)

    # The password is resolved only by the fixed MySQL container. It is never
    # expanded into the host command line, process output, or a temporary file.
    $mysqlCommand = 'export MYSQL_PWD="$MYSQL_PASSWORD"; exec mysql --protocol=socket --user="$MYSQL_USER" "$MYSQL_DATABASE" --batch --skip-column-names --raw --silent'
    $readOnlySql = "SET SESSION TRANSACTION READ ONLY;`n$Sql"
    $output = $readOnlySql | & docker exec -i $mysqlContainer sh -lc $mysqlCommand 2>$null

    if ($LASTEXITCODE -ne 0) {
        throw "Aggregate database query unavailable."
    }

    return @($output)
}

function Get-DatabaseTablePresence {
    $rows = Invoke-ReadOnlyMySqlQuery -Sql @'
SELECT 'job_application_snapshot', COUNT(*)
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'job_application_snapshot'
UNION ALL
SELECT 'rejection_analysis', COUNT(*)
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'rejection_analysis';
'@

    $presence = @{
        job_application_snapshot = 0
        rejection_analysis = 0
    }

    foreach ($row in $rows) {
        $columns = ([string]$row).Split("`t")
        if ($columns.Count -eq 2 -and $presence.ContainsKey($columns[0])) {
            $count = 0
            if ([int]::TryParse($columns[1], [ref]$count)) {
                $presence[$columns[0]] = $count
            }
        }
    }

    return $presence
}

function Show-StatusDiagnostics {
    Write-Section "Service status"

    foreach ($entry in $containers) {
        $inspectFormat = '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}|{{.RestartCount}}'
        $result = & docker inspect --format $inspectFormat $entry.Container 2>$null
        $raw = [string]($result | Select-Object -First 1)

        if ($LASTEXITCODE -ne 0 -or $raw -notmatch '^[a-z-]+\|[a-z-]+\|[0-9]+$') {
            Write-Output ("service={0} state=missing health=unavailable restarts=unavailable" -f $entry.Name)
            Set-DiagnosticExitCode -Code 1
            continue
        }

        $parts = $raw.Split('|')
        Write-Output ("service={0} state={1} health={2} restarts={3}" -f $entry.Name, $parts[0], $parts[1], $parts[2])
        if ($parts[0] -ne "running" -or $parts[1] -notin @("healthy", "not-configured")) {
            Set-DiagnosticExitCode -Code 1
        }
    }

    try {
        $frontend = Invoke-WebRequest -Uri $frontendHealthUri -UseBasicParsing -TimeoutSec 3
        $content = if ($frontend.Content -is [byte[]]) {
            [Text.Encoding]::UTF8.GetString($frontend.Content)
        }
        else {
            [string]$frontend.Content
        }
        $frontendUp = $frontend.StatusCode -eq 200 -and $content.Trim() -eq "ok"
        Write-Output ("frontend_health={0} http={1}" -f $(if ($frontendUp) { "UP" } else { "DOWN" }), $frontend.StatusCode)
        if (-not $frontendUp) {
            Set-DiagnosticExitCode -Code 1
        }
    }
    catch {
        Write-Output "frontend_health=DOWN http=unavailable"
        Set-DiagnosticExitCode -Code 1
    }

    try {
        $backend = Invoke-RestMethod -Uri $backendHealthUri -TimeoutSec 3
        $backendStatus = [string]$backend.status
        if (-not (Test-FixedEnum -Value $backendStatus -Allowed @("UP", "DOWN", "OUT_OF_SERVICE", "UNKNOWN"))) {
            $backendStatus = "UNKNOWN"
        }
        Write-Output ("backend_health={0}" -f $backendStatus)
        if ($backendStatus -ne "UP") {
            Set-DiagnosticExitCode -Code 1
        }
    }
    catch {
        Write-Output "backend_health=DOWN"
        Set-DiagnosticExitCode -Code 1
    }

    $runningImage = & docker inspect --format '{{.Image}}' $backendContainer 2>$null
    $runningImageId = [string]($runningImage | Select-Object -First 1)
    $runningExitCode = $LASTEXITCODE
    $builtImage = & docker image inspect --format '{{.Id}}' $backendImageName 2>$null
    $builtImageId = [string]($builtImage | Select-Object -First 1)
    $builtExitCode = $LASTEXITCODE

    if ($runningExitCode -ne 0 -or $builtExitCode -ne 0 -or
        $runningImageId -notmatch '^sha256:[a-f0-9]{64}$' -or
        $builtImageId -notmatch '^sha256:[a-f0-9]{64}$') {
        Write-Output "backend_image_drift=unavailable"
        Set-DiagnosticExitCode -Code 1
    }
    else {
        $drift = if ($runningImageId -eq $builtImageId) { "no" } else { "yes" }
        Write-Output ("backend_image_drift={0} running={1} built={2}" -f $drift, $runningImageId, $builtImageId)
        if ($drift -eq "yes") {
            Set-DiagnosticExitCode -Code 1
        }
    }
}

function Show-RuntimeDiagnostics {
    Write-Section "Published runtime"

    $localBytes = $null
    if (Test-Path -LiteralPath $runtimeFile -PathType Leaf) {
        try {
            $localBytes = [IO.File]::ReadAllBytes($runtimeFile)
            $localHash = Get-Sha256Hex -Bytes $localBytes
            Write-Output ("runtime_local bytes={0} sha256={1}" -f $localBytes.Length, $localHash)
        }
        catch {
            Write-Output "runtime_local=unavailable"
            Set-DiagnosticExitCode -Code 1
        }
    }
    else {
        Write-Output "runtime_local=missing"
        Set-DiagnosticExitCode -Code 1
    }

    $remoteBytes = $null
    try {
        $remoteBytes = Get-HttpBytes -Uri $runtimeUri
        $remoteHash = Get-Sha256Hex -Bytes $remoteBytes
        Write-Output ("runtime_http bytes={0} sha256={1}" -f $remoteBytes.Length, $remoteHash)
    }
    catch {
        Write-Output "runtime_http=unavailable"
        Set-DiagnosticExitCode -Code 1
    }

    if ($null -ne $localBytes -and $null -ne $remoteBytes) {
        $localHash = Get-Sha256Hex -Bytes $localBytes
        $remoteHash = Get-Sha256Hex -Bytes $remoteBytes
        $matches = $localBytes.Length -eq $remoteBytes.Length -and $localHash -eq $remoteHash
        Write-Output ("runtime_publish_match={0}" -f $(if ($matches) { "yes" } else { "no" }))
        if (-not $matches) {
            Set-DiagnosticExitCode -Code 1
        }
    }
    else {
        Write-Output "runtime_publish_match=unavailable"
    }

    foreach ($markerEntry in $runtimeMarkers.GetEnumerator()) {
        $marker = [string]$markerEntry.Value
        $localPresent = $false
        $remotePresent = $false
        if ($null -ne $localBytes) {
            $localPresent = [Text.Encoding]::UTF8.GetString($localBytes).Contains($marker)
        }
        if ($null -ne $remoteBytes) {
            $remotePresent = [Text.Encoding]::UTF8.GetString($remoteBytes).Contains($marker)
        }

        Write-Output ("runtime_marker name={0} local={1} http={2}" -f `
            $markerEntry.Key,
            $(if ($localPresent) { "present" } else { "missing" }),
            $(if ($remotePresent) { "present" } else { "missing" }))
        if (-not $localPresent -or -not $remotePresent) {
            Set-DiagnosticExitCode -Code 1
        }
    }
}

function Show-DatabaseDiagnostics {
    Write-Section "Database contract"

    try {
        $presence = Get-DatabaseTablePresence
        foreach ($tableName in @("job_application_snapshot", "rejection_analysis")) {
            $present = $presence[$tableName] -eq 1
            Write-Output ("table={0} present={1}" -f $tableName, $(if ($present) { "yes" } else { "no" }))
            if (-not $present) {
                Set-DiagnosticExitCode -Code 1
            }
        }

        if ($presence["job_application_snapshot"] -ne 1 -or $presence["rejection_analysis"] -ne 1) {
            Write-Output "database_contract=degraded reason=required_table_missing"
            return
        }

        $columnRows = Invoke-ReadOnlyMySqlQuery -Sql @'
SELECT 'job_application_snapshot',
       SUM(column_name IN (
           'id', 'user_id', 'encrypt_job_id', 'applied_at', 'job_base_info',
           'job_ext_info', 'jd_hash', 'resume_record_id', 'resume_content',
           'resume_hash', 'preference_snapshot', 'pre_match_result', 'created_at'
       ))
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'job_application_snapshot'
UNION ALL
SELECT 'rejection_analysis',
       SUM(column_name IN (
           'id', 'user_id', 'application_snapshot_id', 'encrypt_job_id',
           'conversation_key', 'conversation_completeness', 'conversation_json',
           'conversation_hash', 'analysis_json', 'status', 'analysis_source',
           'model', 'prompt_version', 'corrected_reason', 'corrected_code',
           'created_at', 'updated_at'
       ))
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'rejection_analysis';
'@

        $requiredColumnCounts = @{
            job_application_snapshot = 13
            rejection_analysis = 17
        }
        $foundColumnCounts = @{
            job_application_snapshot = -1
            rejection_analysis = -1
        }
        foreach ($row in $columnRows) {
            $columns = ([string]$row).Split("`t")
            if ($columns.Count -eq 2 -and $foundColumnCounts.ContainsKey($columns[0])) {
                $count = -1
                if ([int]::TryParse($columns[1], [ref]$count)) {
                    $foundColumnCounts[$columns[0]] = $count
                }
            }
        }

        foreach ($tableName in @("job_application_snapshot", "rejection_analysis")) {
            $required = $requiredColumnCounts[$tableName]
            $found = $foundColumnCounts[$tableName]
            Write-Output ("columns table={0} required={1} found={2}" -f $tableName, $required, $found)
            if ($found -ne $required) {
                Set-DiagnosticExitCode -Code 1
            }
        }

        $indexRows = Invoke-ReadOnlyMySqlQuery -Sql @'
SELECT 'uk_job_application_user_job', COUNT(*)
FROM (
    SELECT index_name, non_unique,
           GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS indexed_columns
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'job_application_snapshot'
      AND index_name = 'uk_job_application_user_job'
    GROUP BY index_name, non_unique
    HAVING non_unique = 0 AND indexed_columns = 'user_id,encrypt_job_id'
) AS snapshot_index
UNION ALL
SELECT 'uk_rejection_user_job_hash', COUNT(*)
FROM (
    SELECT index_name, non_unique,
           GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS indexed_columns
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'rejection_analysis'
      AND index_name = 'uk_rejection_user_job_hash'
    GROUP BY index_name, non_unique
    HAVING non_unique = 0 AND indexed_columns = 'user_id,encrypt_job_id,conversation_hash'
) AS rejection_index;
'@

        $requiredIndexes = @{
            uk_job_application_user_job = 0
            uk_rejection_user_job_hash = 0
        }
        foreach ($row in $indexRows) {
            $columns = ([string]$row).Split("`t")
            if ($columns.Count -eq 2 -and $requiredIndexes.ContainsKey($columns[0])) {
                $count = 0
                if ([int]::TryParse($columns[1], [ref]$count)) {
                    $requiredIndexes[$columns[0]] = $count
                }
            }
        }

        foreach ($indexName in @("uk_job_application_user_job", "uk_rejection_user_job_hash")) {
            $valid = $requiredIndexes[$indexName] -eq 1
            Write-Output ("unique_index name={0} valid={1}" -f $indexName, $(if ($valid) { "yes" } else { "no" }))
            if (-not $valid) {
                Set-DiagnosticExitCode -Code 1
            }
        }

        $aggregateRows = Invoke-ReadOnlyMySqlQuery -Sql @'
SELECT 'snapshot_rows', COUNT(*) FROM job_application_snapshot
UNION ALL
SELECT 'rejection_rows', COUNT(*) FROM rejection_analysis
UNION ALL
SELECT 'orphan_rejections', COUNT(*)
FROM rejection_analysis AS rejection
LEFT JOIN job_application_snapshot AS snapshot
  ON snapshot.id = rejection.application_snapshot_id
 AND snapshot.user_id = rejection.user_id
WHERE snapshot.id IS NULL
UNION ALL
SELECT 'snapshot_duplicate_groups', COUNT(*)
FROM (
    SELECT user_id, encrypt_job_id
    FROM job_application_snapshot
    GROUP BY user_id, encrypt_job_id
    HAVING COUNT(*) > 1
) AS snapshot_duplicates
UNION ALL
SELECT 'rejection_duplicate_groups', COUNT(*)
FROM (
    SELECT user_id, encrypt_job_id, conversation_hash
    FROM rejection_analysis
    GROUP BY user_id, encrypt_job_id, conversation_hash
    HAVING COUNT(*) > 1
) AS rejection_duplicates;
'@

        $aggregateNames = @(
            "snapshot_rows",
            "rejection_rows",
            "orphan_rejections",
            "snapshot_duplicate_groups",
            "rejection_duplicate_groups"
        )
        foreach ($row in $aggregateRows) {
            $columns = ([string]$row).Split("`t")
            if ($columns.Count -eq 2 -and $aggregateNames -contains $columns[0] -and $columns[1] -match '^\d+$') {
                Write-Output ("database_aggregate name={0} count={1}" -f $columns[0], $columns[1])
                if ($columns[0] -in @("orphan_rejections", "snapshot_duplicate_groups", "rejection_duplicate_groups") -and
                    [long]$columns[1] -gt 0) {
                    Set-DiagnosticExitCode -Code 1
                }
            }
        }
    }
    catch {
        Write-Output "database_contract=unavailable"
        Set-DiagnosticExitCode -Code 1
    }
}

function Show-RejectionDiagnostics {
    Write-Section "Rejection analysis aggregates"

    try {
        $presence = Get-DatabaseTablePresence
        if ($presence["rejection_analysis"] -ne 1) {
            Write-Output "rejection_analysis=missing"
            Set-DiagnosticExitCode -Code 1
            return
        }

        $statusRows = Invoke-ReadOnlyMySqlQuery -Sql @'
SELECT CASE
           WHEN status IN ('PENDING', 'CONFIRMED', 'CORRECTED', 'IGNORED') THEN status
           ELSE 'OTHER'
       END AS safe_status,
       COUNT(*)
FROM rejection_analysis
GROUP BY safe_status
ORDER BY safe_status;
'@
        Write-Output "status_counts:"
        if ($statusRows.Count -eq 0) {
            Write-Output "  none"
        }
        foreach ($row in $statusRows) {
            $columns = ([string]$row).Split("`t")
            if ($columns.Count -eq 2 -and
                (Test-FixedEnum -Value $columns[0] -Allowed @("PENDING", "CONFIRMED", "CORRECTED", "IGNORED", "OTHER")) -and
                $columns[1] -match '^\d+$') {
                Write-Output ("  status={0} count={1}" -f $columns[0], $columns[1])
                if ($columns[0] -eq "OTHER" -and [long]$columns[1] -gt 0) {
                    Set-DiagnosticExitCode -Code 1
                }
            }
        }

        $sourceRows = Invoke-ReadOnlyMySqlQuery -Sql @'
SELECT CASE
           WHEN analysis_source IN ('RULES_AI', 'RULES_ONLY') THEN analysis_source
           ELSE 'OTHER'
       END AS safe_source,
       COUNT(*)
FROM rejection_analysis
GROUP BY safe_source
ORDER BY safe_source;
'@
        Write-Output "source_counts:"
        if ($sourceRows.Count -eq 0) {
            Write-Output "  none"
        }
        foreach ($row in $sourceRows) {
            $columns = ([string]$row).Split("`t")
            if ($columns.Count -eq 2 -and
                (Test-FixedEnum -Value $columns[0] -Allowed @("RULES_AI", "RULES_ONLY", "OTHER")) -and
                $columns[1] -match '^\d+$') {
                Write-Output ("  source={0} count={1}" -f $columns[0], $columns[1])
                if ($columns[0] -eq "OTHER" -and [long]$columns[1] -gt 0) {
                    Set-DiagnosticExitCode -Code 1
                }
            }
        }

        $completenessRows = Invoke-ReadOnlyMySqlQuery -Sql @'
SELECT CASE
           WHEN conversation_completeness IN ('COMPLETE', 'POSSIBLY_INCOMPLETE')
               THEN conversation_completeness
           ELSE 'OTHER'
       END AS safe_completeness,
       COUNT(*)
FROM rejection_analysis
GROUP BY safe_completeness
ORDER BY safe_completeness;
'@
        Write-Output "completeness_counts:"
        if ($completenessRows.Count -eq 0) {
            Write-Output "  none"
        }
        foreach ($row in $completenessRows) {
            $columns = ([string]$row).Split("`t")
            if ($columns.Count -eq 2 -and
                (Test-FixedEnum -Value $columns[0] -Allowed @("COMPLETE", "POSSIBLY_INCOMPLETE", "OTHER")) -and
                $columns[1] -match '^\d+$') {
                Write-Output ("  completeness={0} count={1}" -f $columns[0], $columns[1])
                if ($columns[0] -eq "OTHER" -and [long]$columns[1] -gt 0) {
                    Set-DiagnosticExitCode -Code 1
                }
            }
        }

        $trendRows = Invoke-ReadOnlyMySqlQuery -Sql @'
SELECT 'total_cases', COUNT(*) FROM rejection_analysis
UNION ALL
SELECT 'usable_cases', COUNT(*)
FROM rejection_analysis
WHERE status IN ('CONFIRMED', 'CORRECTED')
UNION ALL
SELECT 'eligible_users', COUNT(*)
FROM (
    SELECT user_id
    FROM rejection_analysis
    WHERE status IN ('CONFIRMED', 'CORRECTED')
    GROUP BY user_id
    HAVING COUNT(*) >= 5
) AS trend_eligible;
'@

        $trend = @{
            total_cases = 0L
            usable_cases = 0L
            eligible_users = 0L
        }
        foreach ($row in $trendRows) {
            $columns = ([string]$row).Split("`t")
            if ($columns.Count -eq 2 -and $trend.ContainsKey($columns[0]) -and $columns[1] -match '^\d+$') {
                $trend[$columns[0]] = [long]$columns[1]
            }
        }

        Write-Output ("trend threshold=5 total_cases={0} usable_cases={1} eligible_users={2} visible={3}" -f `
            $trend.total_cases,
            $trend.usable_cases,
            $trend.eligible_users,
            $(if ($trend.eligible_users -gt 0) { "yes" } else { "no" }))
    }
    catch {
        Write-Output "rejection_aggregates=unavailable"
        Set-DiagnosticExitCode -Code 1
    }
}

function Test-RejectionDiagnosticValue {
    param(
        [Parameter(Mandatory)][string]$Field,
        [AllowEmptyString()][string]$Value
    )

    switch ($Field) {
        { $_ -in @("snapshotId", "analysisId", "messageCount", "evidenceCount", "totalConfirmed", "durationMs") } {
            return $Value -match '^\d{1,20}$'
        }
        "visible" {
            return $Value -match '^(?:true|false|0|1|yes|no)$'
        }
        { $_ -in @("requestId", "userHash", "jobHash") } {
            return $Value -match '^[A-Za-z0-9_.:-]{1,80}$'
        }
        default {
            return $Value -match '^[A-Za-z0-9_.:-]{1,64}$'
        }
    }
}

function Show-BackendLogDiagnostics {
    Write-Section "Sanitized backend log summary"

    # Windows PowerShell wraps native stderr as ErrorRecord objects. Docker can
    # legitimately write JVM startup notices there even when `docker logs`
    # succeeds, so collect the stream without letting the script-wide Stop
    # preference turn an informational line into a terminating error.
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $logOutput = @(
            & docker logs --since ("{0}m" -f $SinceMinutes) --tail $Tail $backendContainer 2>&1
        )
        $dockerLogsExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($dockerLogsExitCode -ne 0) {
        Write-Output ("logs=unavailable since_minutes={0} tail={1}" -f $SinceMinutes, $Tail)
        Set-DiagnosticExitCode -Code 1
        return
    }

    $rawLog = ($logOutput | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    $lines = @([regex]::Split($rawLog, "\r?\n") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    Write-Output ("log_window since_minutes={0} tail={1} lines_read={2}" -f $SinceMinutes, $Tail, $lines.Count)
    foreach ($entry in $backendKeywordPatterns.GetEnumerator()) {
        $count = @($lines | Where-Object { $_ -match $entry.Value }).Count
        Write-Output ("keyword name={0} count={1}" -f $entry.Key, $count)
    }

    $parsedRecords = 0
    $malformedRecords = 0
    $unknownFieldsDropped = 0
    foreach ($line in $lines) {
        $prefixIndex = $line.IndexOf("REJECTION_DIAG", [StringComparison]::OrdinalIgnoreCase)
        if ($prefixIndex -lt 0) {
            continue
        }

        $diagnosticText = $line.Substring($prefixIndex + "REJECTION_DIAG".Length)
        $matches = [regex]::Matches($diagnosticText, '(?<key>[A-Za-z][A-Za-z0-9]*)=(?<value>[^\s,]+)')
        $safeRecord = [ordered]@{}
        foreach ($match in $matches) {
            $key = [string]$match.Groups["key"].Value
            $value = ([string]$match.Groups["value"].Value).Trim('"', "'", ']', '}')
            if ($rejectionDiagnosticFields -notcontains $key) {
                $unknownFieldsDropped++
                continue
            }
            if (-not (Test-RejectionDiagnosticValue -Field $key -Value $value)) {
                continue
            }
            $safeRecord[$key] = $value
        }

        if ($safeRecord.Count -eq 0) {
            $malformedRecords++
            continue
        }

        $rebuiltFields = New-Object Collections.Generic.List[string]
        foreach ($field in $rejectionDiagnosticFields) {
            if ($safeRecord.Contains($field)) {
                $rebuiltFields.Add(("{0}={1}" -f $field, $safeRecord[$field]))
            }
        }
        Write-Output ("diag {0}" -f ($rebuiltFields -join " "))
        $parsedRecords++
    }

    Write-Output ("diag_parse parsed={0} malformed={1} unknown_fields_dropped={2}" -f `
        $parsedRecords,
        $malformedRecords,
        $unknownFieldsDropped)
}

$needsDocker = $Action -ne "runtime"
if ($needsDocker) {
    if (-not (Test-Path -LiteralPath $composeFile -PathType Leaf)) {
        Write-Output "prerequisite=missing name=docker-compose.local.yml"
        exit 2
    }
    if ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Output "prerequisite=missing name=docker"
        exit 2
    }

    $null = & docker info --format '{{.ServerVersion}}' 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Output "prerequisite=unavailable name=docker-daemon"
        exit 2
    }
}

Write-Output ("Job Helper read-only diagnostics at {0}" -f [DateTimeOffset]::Now.ToString("yyyy-MM-dd HH:mm:ss zzz"))
Write-Output ("action={0}" -f $Action)

switch ($Action) {
    "status" {
        Show-StatusDiagnostics
    }
    "runtime" {
        Show-RuntimeDiagnostics
    }
    "database" {
        Show-DatabaseDiagnostics
    }
    "rejections" {
        Show-RejectionDiagnostics
    }
    "logs" {
        Show-BackendLogDiagnostics
    }
    "all" {
        Show-StatusDiagnostics
        Show-RuntimeDiagnostics
        Show-DatabaseDiagnostics
        Show-RejectionDiagnostics
        Show-BackendLogDiagnostics
    }
}

Write-Output ""
if ($script:DiagnosticExitCode -eq 0) {
    Write-Output "diagnostic_result=healthy"
}
else {
    Write-Output "diagnostic_result=degraded"
}

exit $script:DiagnosticExitCode

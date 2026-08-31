[CmdletBinding()]
param(
    [switch]$Watch,

    [ValidateRange(15, 3600)]
    [int]$IntervalSeconds = 15,

    [ValidateRange(1, 1440)]
    [int]$LogWindowMinutes = 10
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$composeFile = Join-Path $PSScriptRoot "docker-compose.local.yml"
$envFile = Join-Path $PSScriptRoot ".env"
$frontendHealthUri = "http://127.0.0.1:5173/healthz"
$runtimeUri = "http://127.0.0.1:5173/ai-job-hunting-runtime.js"
$backendHealthUri = "http://127.0.0.1:9100/actuator/health"

$dockerServices = @(
    @{ Service = "frontend"; Container = "job-helper-frontend" },
    @{ Service = "mysql"; Container = "job-helper-mysql" },
    @{ Service = "backend"; Container = "job-helper-backend" }
)

# These expressions are deliberately fixed. Backend log text is kept in memory only;
# the monitor prints counts and never prints matching lines or exception messages.
$knownBackendErrorPatterns = [ordered]@{
    error_or_exception = "(?im)\bERROR\b|\b(?:[A-Za-z0-9_.]+Exception|OutOfMemoryError)\b"
    initialization     = "(?im)BOSS\s*消息服务尚未完成初始化|message\s+service.{0,80}not.{0,30}initiali[sz]ed"
    ack_missing        = "(?im)ACK.{0,80}(?:missing|未取得|缺失)|(?:missing|缺失).{0,80}ACK"
    timeout            = "(?im)^.*\b(?:WARN|ERROR)\b.*(?:\btimeout\b|timed\s+out|超时).*$"
    connection         = "(?im)connection\s+refused|ConnectException|连接拒绝"
    duplicate_queue    = "(?im)重复(?:排队|入队)|duplicate.{0,50}(?:queue|enqueue)"
}

function Write-Section {
    param([Parameter(Mandatory)][string]$Title)

    Write-Host ""
    Write-Host "[$Title]"
}

function Invoke-ReadOnlyMySqlQuery {
    param([Parameter(Mandatory)][string]$Sql)

    # The password remains inside the MySQL container environment and is never
    # interpolated into this script's command line or output.
    $mysqlCommand = 'export MYSQL_PWD="$MYSQL_PASSWORD"; exec mysql --protocol=socket --user="$MYSQL_USER" "$MYSQL_DATABASE" --batch --skip-column-names --raw --silent'
    $output = $Sql | & docker compose `
        --project-directory $PSScriptRoot `
        --env-file $envFile `
        -f $composeFile `
        exec -T mysql sh -lc $mysqlCommand 2>$null

    if ($LASTEXITCODE -ne 0) {
        throw "The aggregate delivery-audit query was unavailable."
    }

    return @($output)
}

function Convert-EpochMillisecondsToLocalTime {
    param([AllowNull()][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return "none"
    }

    try {
        return [DateTimeOffset]::FromUnixTimeMilliseconds([long]$Value).
            ToLocalTime().
            ToString("yyyy-MM-dd HH:mm:ss zzz")
    }
    catch {
        return "unavailable"
    }
}

function Get-DockerSummary {
    Write-Section "Docker services"

    foreach ($entry in $dockerServices) {
        $inspectFormat = '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}|{{.RestartCount}}'
        $result = & docker inspect --format $inspectFormat $entry.Container 2>$null

        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($result -join ""))) {
            Write-Host ("{0,-8} state=missing health=unavailable restarts=unavailable" -f $entry.Service)
            continue
        }

        $parts = ([string]($result | Select-Object -First 1)).Split('|')
        if ($parts.Count -ne 3) {
            Write-Host ("{0,-8} state=unavailable health=unavailable restarts=unavailable" -f $entry.Service)
            continue
        }

        Write-Host ("{0,-8} state={1} health={2} restarts={3}" -f $entry.Service, $parts[0], $parts[1], $parts[2])
    }
}

function Get-HttpSummary {
    Write-Section "Local health endpoints"

    try {
        $frontend = Invoke-WebRequest -Uri $frontendHealthUri -UseBasicParsing -TimeoutSec 3
        $frontendContent = if ($frontend.Content -is [byte[]]) {
            [Text.Encoding]::UTF8.GetString($frontend.Content)
        }
        else {
            [string]$frontend.Content
        }
        $frontendOk = $frontend.StatusCode -eq 200 -and $frontendContent.Trim() -eq "ok"
        Write-Host ("frontend healthz={0} http={1}" -f $(if ($frontendOk) { "UP" } else { "DOWN" }), $frontend.StatusCode)
    }
    catch {
        Write-Host "frontend healthz=DOWN http=unavailable"
    }

    try {
        $runtime = Invoke-WebRequest -Uri $runtimeUri -Method Head -UseBasicParsing -TimeoutSec 3
        $runtimeLength = $runtime.Headers["Content-Length"] | Select-Object -First 1
        if ([string]::IsNullOrWhiteSpace($runtimeLength)) {
            $runtimeLength = "unknown"
        }
        Write-Host ("runtime head=UP http={0} bytes={1}" -f $runtime.StatusCode, $runtimeLength)
    }
    catch {
        Write-Host "runtime head=DOWN http=unavailable bytes=unavailable"
    }

    try {
        $backend = Invoke-RestMethod -Uri $backendHealthUri -TimeoutSec 3
        $backendStatus = if ([string]::IsNullOrWhiteSpace([string]$backend.status)) { "UNKNOWN" } else { [string]$backend.status }
        Write-Host ("backend actuator={0}" -f $backendStatus)
    }
    catch {
        Write-Host "backend actuator=DOWN"
    }
}

function Get-DeliveryAuditSummary {
    Write-Section "Delivery audit (aggregate only)"

    try {
        $tableCheck = Invoke-ReadOnlyMySqlQuery -Sql @'
SELECT COUNT(*)
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'delivery_audit';
'@
        if (($tableCheck | Select-Object -First 1) -ne "1") {
            Write-Host "delivery_audit=missing"
            return
        }

        $stateRows = Invoke-ReadOnlyMySqlQuery -Sql @'
SELECT kind, status, COUNT(*)
FROM delivery_audit
GROUP BY kind, status
ORDER BY kind, status;
'@

        Write-Host "state_counts:"
        if ($stateRows.Count -eq 0) {
            Write-Host "  none"
        }
        else {
            foreach ($row in $stateRows) {
                $columns = ([string]$row).Split("`t")
                if ($columns.Count -eq 3) {
                    Write-Host ("  kind={0} status={1} records={2}" -f $columns[0], $columns[1], $columns[2])
                }
            }
        }

        $stalledRows = Invoke-ReadOnlyMySqlQuery -Sql @'
SELECT kind, status, COUNT(*)
FROM delivery_audit
WHERE status IN ('queued', 'sending')
  AND event_updated_at <= (UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 - 60000)
GROUP BY kind, status
ORDER BY kind, status;
'@

        Write-Host "queue_or_ack_wait_over_60s:"
        if ($stalledRows.Count -eq 0) {
            Write-Host "  none"
        }
        else {
            foreach ($row in $stalledRows) {
                $columns = ([string]$row).Split("`t")
                if ($columns.Count -eq 3) {
                    Write-Host ("  kind={0} status={1} records={2}" -f $columns[0], $columns[1], $columns[2])
                }
            }
        }

        $receiptPendingRows = Invoke-ReadOnlyMySqlQuery -Sql @'
SELECT kind, COUNT(*)
FROM delivery_audit
WHERE status = 'acknowledged'
  AND event_updated_at <= (UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 - 60000)
GROUP BY kind
ORDER BY kind;
'@

        # Acknowledged means BOSS already returned serverMid. It is shown separately
        # as receipt reconciliation information and must never be reported as ACK loss.
        Write-Host "receipt_wait_over_60s:"
        if ($receiptPendingRows.Count -eq 0) {
            Write-Host "  none"
        }
        else {
            foreach ($row in $receiptPendingRows) {
                $columns = ([string]$row).Split("`t")
                if ($columns.Count -eq 2) {
                    Write-Host ("  kind={0} records={1}" -f $columns[0], $columns[1])
                }
            }
        }

        $retryRows = Invoke-ReadOnlyMySqlQuery -Sql @'
SELECT kind,
       status,
       SUM(CASE WHEN duplicate_count > 0 THEN 1 ELSE 0 END),
       SUM(CASE WHEN attempts >= 3 THEN 1 ELSE 0 END),
       MAX(COALESCE(duplicate_count, 0)),
       MAX(COALESCE(attempts, 0))
FROM delivery_audit
WHERE status = 'queued'
  AND (duplicate_count >= 2 OR attempts >= 3)
GROUP BY kind, status
ORDER BY kind, status;
'@

        Write-Host "queued_retry_pressure:"
        if ($retryRows.Count -eq 0) {
            Write-Host "  none"
        }
        else {
            foreach ($row in $retryRows) {
                $columns = ([string]$row).Split("`t")
                if ($columns.Count -eq 6) {
                    Write-Host ("  kind={0} status={1} duplicate_records={2} attempt_ge_3_records={3} max_duplicates={4} max_attempts={5}" -f `
                        $columns[0], $columns[1], $columns[2], $columns[3], $columns[4], $columns[5])
                }
            }
        }

        $recentRows = Invoke-ReadOnlyMySqlQuery -Sql @'
SELECT kind, status, MAX(event_updated_at)
FROM delivery_audit
WHERE status IN ('acknowledged', 'receipt')
GROUP BY kind, status
ORDER BY kind, status;
'@

        Write-Host "latest_ack_or_receipt:"
        if ($recentRows.Count -eq 0) {
            Write-Host "  none"
        }
        else {
            foreach ($row in $recentRows) {
                $columns = ([string]$row).Split("`t")
                if ($columns.Count -eq 3) {
                    $localTime = Convert-EpochMillisecondsToLocalTime -Value $columns[2]
                    Write-Host ("  kind={0} status={1} time={2}" -f $columns[0], $columns[1], $localTime)
                }
            }
        }
    }
    catch {
        # Do not print the underlying database or Docker error because it may
        # include connection details. The next watch cycle will retry safely.
        Write-Host "delivery_audit=unavailable"
    }
}

function Get-BackendLogSummary {
    Write-Section "Backend log keyword counts"

    $logText = & docker logs `
        --since ("{0}m" -f $LogWindowMinutes) `
        --tail 5000 `
        job-helper-backend 2>&1 | Out-String

    if ($LASTEXITCODE -ne 0) {
        Write-Host ("window_minutes={0} logs=unavailable" -f $LogWindowMinutes)
        return
    }

    Write-Host ("window_minutes={0}" -f $LogWindowMinutes)
    foreach ($entry in $knownBackendErrorPatterns.GetEnumerator()) {
        $count = [regex]::Matches($logText, $entry.Value).Count
        Write-Host ("  {0}={1}" -f $entry.Key, $count)
    }
}

function Invoke-MonitorCycle {
    Write-Host ("Job Helper read-only check at {0}" -f [DateTimeOffset]::Now.ToString("yyyy-MM-dd HH:mm:ss zzz"))
    Get-DockerSummary
    Get-HttpSummary
    Get-DeliveryAuditSummary
    Get-BackendLogSummary
}

if ($Watch) {
    while ($true) {
        try {
            Invoke-MonitorCycle
        }
        catch {
            # Keep watch mode alive without exposing exception text that could
            # contain local paths, credentials, or log payloads.
            Write-Host ""
            Write-Host "monitor_cycle=failed"
        }

        Write-Host ""
        Write-Host ("Next read-only check in {0} seconds. Press Ctrl+C to stop." -f $IntervalSeconds)
        Start-Sleep -Seconds $IntervalSeconds
        Write-Host ""
        Write-Host "------------------------------------------------------------"
    }
}
else {
    Invoke-MonitorCycle
}

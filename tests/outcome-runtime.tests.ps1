# Compose interpolation only: no Docker daemon, containers, database, or model.
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$composePath = Join-Path $repositoryRoot 'docker-compose.local.yml'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('job-helper-outcome-config-' + [Guid]::NewGuid().ToString('N'))
$fixtureEnv = Join-Path $fixtureRoot 'fixture.env'
$previousEnvironment = @{}
$names = @(Get-Content -LiteralPath (Join-Path $repositoryRoot '.env.example') | ForEach-Object {
    if ($_ -match '^([A-Z][A-Z0-9_]*)=') { $Matches[1] }
})
foreach ($name in $names) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name)
    Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
}
try {
    New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
    foreach ($scenario in @('disabled', 'explicit-token', 'existing-token')) {
        $existingToken = 'fixture-existing-agent-secret-at-least-32-characters'
        $outcomeToken = 'fixture-dedicated-outcome-secret-at-least-32-characters'
        $lines = @('MYSQL_ROOT_PASSWORD=fixture-root', 'MYSQL_PASSWORD=fixture-database',
            'API_OWNER_USER_ID=3', "AGENT_INTERNAL_TOKEN=$existingToken")
        if ($scenario -ne 'disabled') {
            $lines += @('API_OUTCOME_ENABLED=true', 'API_AUTOMATION_ENABLED=true', 'API_CAREER_ENABLED=true')
        }
        if ($scenario -eq 'explicit-token') {
            $lines += @("API_OUTCOME_INTERNAL_TOKEN=$outcomeToken", 'API_OUTCOME_READ_WAIT_HOURS=25',
                'API_OUTCOME_UNREAD_WAIT_HOURS=73', 'API_OUTCOME_LEASE_SECONDS=120',
                'AGENT_OUTCOME_SCAN_SECONDS=2', 'AGENT_OUTCOME_JOB_TIMEOUT_SECONDS=300',
                'AGENT_AUTOMATION_SCAN_SECONDS=2', 'AGENT_AUTOMATION_JOB_TIMEOUT_SECONDS=200')
        }
        $lines | Set-Content -LiteralPath $fixtureEnv -Encoding ascii
        $raw = @(& docker compose --env-file $fixtureEnv -f $composePath config --format json)
        if ($LASTEXITCODE -ne 0) { throw 'Outcome Compose interpolation failed.' }
        $resolved = ($raw -join "`n") | ConvertFrom-Json
        $backend = $resolved.services.backend
        $agent = $resolved.services.agent
        $enabled = if ($scenario -eq 'disabled') { 'false' } else { 'true' }
        $token = if ($scenario -eq 'explicit-token') { $outcomeToken } else { $existingToken }
        if ($backend.environment.API_OUTCOME_ENABLED -ne $enabled -or
            $agent.environment.AGENT_OUTCOMES_ENABLED -ne $enabled) { throw 'API/Agent outcome feature switches differ.' }
        if ($backend.environment.API_AUTOMATION_ENABLED -ne $enabled -or
            $agent.environment.AGENT_AUTOMATION_ENABLED -ne $enabled -or
            $backend.environment.API_CAREER_ENABLED -ne $enabled) { throw 'Unified automation/career feature switches differ.' }
        if ($backend.environment.API_OUTCOME_INTERNAL_TOKEN -ne $token) { throw "API outcome credential mapping failed: $scenario" }
        if ($agent.environment.AGENT_OUTCOME_INTERNAL_TOKEN -ne $token) { throw "Agent outcome credential mapping failed: $scenario" }
        if ($agent.environment.AGENT_INTERNAL_TOKEN -ne $existingToken) { throw "Existing Agent credential changed: $scenario" }
        if ($agent.environment.AGENT_OUTCOME_API_URL -ne 'http://backend:9100' -or
            $backend.networks.PSObject.Properties.Name -notcontains 'job-helper' -or
            $agent.networks.PSObject.Properties.Name -notcontains 'job-helper') { throw 'Outcome worker has no shared backend service alias.' }
        $readWait = if ($scenario -eq 'explicit-token') { '25' } else { '24' }
        $unreadWait = if ($scenario -eq 'explicit-token') { '73' } else { '72' }
        $lease = if ($scenario -eq 'explicit-token') { '120' } else { '180' }
        $scan = if ($scenario -eq 'explicit-token') { '2' } else { '5' }
        if ($backend.environment.API_OUTCOME_READ_WAIT_HOURS -ne $readWait -or
            $backend.environment.API_OUTCOME_UNREAD_WAIT_HOURS -ne $unreadWait -or
            $backend.environment.API_OUTCOME_LEASE_SECONDS -ne $lease -or
            $agent.environment.AGENT_OUTCOME_SCAN_SECONDS -ne $scan -or
            $agent.environment.AGENT_OUTCOME_JOB_TIMEOUT_SECONDS -ne '300') { throw 'Outcome timing policy configuration drifted.' }
        $automationDeadline = if ($scenario -eq 'explicit-token') { '200' } else { '300' }
        if ($agent.environment.AGENT_AUTOMATION_SCAN_SECONDS -ne $scan -or
            $agent.environment.AGENT_AUTOMATION_JOB_TIMEOUT_SECONDS -ne $automationDeadline) { throw 'Unified automation timing configuration drifted.' }
        if ($backend.ports[0].host_ip -ne '127.0.0.1' -or $backend.ports[0].published -ne '9100' -or
            $agent.ports[0].host_ip -ne '127.0.0.1' -or $agent.ports[0].published -ne '9101') { throw 'Outcome wiring changed the existing loopback entry points.' }
        if ($agent.environment.AGENT_CHECKPOINT_PATH -ne '/app/data/langgraph-checkpoints.sqlite3' -or
            @($agent.volumes | Where-Object { $_.type -eq 'volume' -and $_.source -eq 'agent_data' -and $_.target -eq '/app/data' }).Count -ne 1) { throw 'Outcome checkpoints lack their existing durable volume.' }
        Write-Output "Outcome Compose wiring: $scenario PASS"
    }
}
finally {
    foreach ($name in $names) {
        if ($null -eq $previousEnvironment[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
        else { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name]) }
    }
    # Only the exact file and empty directory created by this test are removed.
    if (Test-Path -LiteralPath $fixtureEnv) { Remove-Item -LiteralPath $fixtureEnv -Force }
    if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Force }
}

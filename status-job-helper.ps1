[CmdletBinding()]
param([switch]$VerboseLogs)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSScriptRoot 'job-helper-release-common.psm1') -Force
$activePath = Join-Path $PSScriptRoot '.job-helper-active.json'
$receipt = $null
if (Test-Path -LiteralPath $activePath) {
    $active = Get-Content -LiteralPath $activePath -Raw | ConvertFrom-Json
    $receiptPath = Resolve-JobHelperChildPath -Root $PSScriptRoot -Path $active.receiptPath
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    Write-Host "Current: channel=$($receipt.channel) version=$($receipt.version) build=$($receipt.buildId)"
}
else { Write-Host 'Current: no selected local receipt' }
foreach ($service in @('mysql', 'frontend', 'backend', 'agent')) {
    $container = Get-JobHelperContainer -Name "job-helper-$service" -Service $service
    if ($null -eq $container) { Write-Host "${service}: missing"; continue }
    Write-Host "${service}: $($container.State.Status), image=$($container.Image)"
}
foreach ($probe in @(
    @{name='Python API';url='http://127.0.0.1:9100/actuator/health'},
    @{name='Python Agent';url='http://127.0.0.1:9101/health/ready'}
)) {
    try {
        $health = Invoke-RestMethod -Uri $probe.url -TimeoutSec 3
        $matches = $null -ne $receipt -and $health.buildId -eq $receipt.buildId -and $health.version -eq $receipt.version
        Write-Host "$($probe.name): $($health.status), version=$($health.version), build=$($health.buildId), receipt_matches=$matches"
    }
    catch { Write-Host "$($probe.name): unavailable" }
}
try {
    $extensionTarget = Get-JobHelperExtensionTarget -RepositoryRoot $PSScriptRoot
    $manifest = Get-Content -LiteralPath (Join-Path $extensionTarget 'manifest.json') -Raw | ConvertFrom-Json
    $matches = $null -ne $receipt -and (Get-JobHelperTreeDigest -Directory $extensionTarget) -eq $receipt.extensionSha256
    Write-Host "Chrome files: $($manifest.version_name), receipt_matches=$matches, path=$extensionTarget"
}
catch { Write-Host 'Chrome files: missing or invalid' }
Write-Host 'Chrome loaded state and visible page badge were not inspected.'
if ($VerboseLogs) {
    foreach ($service in @('backend', 'agent')) {
        $container = Get-JobHelperContainer -Name "job-helper-$service" -Service $service
        if ($null -ne $container) { & docker logs --tail 80 $container.Id }
    }
}

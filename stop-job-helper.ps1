[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'job-helper-release-common.psm1') -Force
$operationLock = Enter-JobHelperOperationLock -WorkspaceRoot $PSScriptRoot
try {
    $containers = @()
    foreach ($service in @('backend', 'agent', 'frontend', 'mysql')) {
        $container = Get-JobHelperContainer -Name "job-helper-$service" -Service $service
        if ($null -ne $container) { $containers += $container }
    }
    foreach ($container in $containers) {
        & docker stop --time 30 $container.Id | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'A current Job Helper service could not stop.' }
    }
    Write-Host 'Current services stopped. Containers, rollback package, volumes, and browser state are preserved.'
}
finally { Exit-JobHelperOperationLock -Mutex $operationLock }

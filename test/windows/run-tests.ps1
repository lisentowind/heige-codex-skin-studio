param(
    [ValidateSet("All", "Resolver", "ScheduledTask", "Entrypoints", "Installer", "NodeCli")]
    [string]$Suite = "All"
)

$ErrorActionPreference = "Stop"
$suites = @()
if ($Suite -eq "All" -or $Suite -eq "Resolver") {
    $suites += (Join-Path $PSScriptRoot "resolver.test.ps1")
}
if ($Suite -eq "All" -or $Suite -eq "ScheduledTask") {
    $suites += (Join-Path $PSScriptRoot "scheduled-task.test.ps1")
}
if ($Suite -eq "All" -or $Suite -eq "Entrypoints") {
    $suites += (Join-Path $PSScriptRoot "entrypoints.test.ps1")
}
if ($Suite -eq "All" -or $Suite -eq "Installer") {
    $suites += (Join-Path $PSScriptRoot "installer.test.ps1")
}
if ($Suite -eq "All" -or $Suite -eq "NodeCli") {
    $suites += (Join-Path $PSScriptRoot "node-cli.test.ps1")
}

try {
    foreach ($path in $suites) {
        & $path
    }
} catch {
    Write-Host "TEST RUN FAILED: $($_.Exception.Message)"
    exit 1
}
exit 0

param(
    [ValidateSet("All", "Resolver")]
    [string]$Suite = "All"
)

$ErrorActionPreference = "Stop"
$suites = @()
if ($Suite -eq "All" -or $Suite -eq "Resolver") {
    $suites += (Join-Path $PSScriptRoot "resolver.test.ps1")
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

param(
    [ValidateRange(1024, 65535)][int]$Port = 9341,
    [Parameter(Mandatory = $true)][ValidateRange(1, [int]::MaxValue)][int]$ExpectedPid,
    [Parameter(Mandatory = $true)][string]$ExpectedExecutablePath,
    [Parameter(Mandatory = $true)][string]$ExpectedStartedAt
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

$token = [System.Environment]::GetEnvironmentVariable(
    "HEIGE_WINDOWS_APP_IDENTITY",
    [System.EnvironmentVariableTarget]::Process
)
if (-not $token) {
    throw "restart-into-cdp 需要进程环境变量 HEIGE_WINDOWS_APP_IDENTITY。"
}
$app = Resolve-HeiGeBoundCodexApp -IdentityToken $token
Invoke-HeiGeRestartCodexIntoCdp `
    -Port $Port `
    -ExpectedPid $ExpectedPid `
    -ExpectedExecutablePath $ExpectedExecutablePath `
    -ExpectedStartedAt $ExpectedStartedAt `
    -AppInfo $app | Out-Null
param(
    [ValidateNotNullOrEmpty()][string]$Theme = "miku-488137",
    [ValidateRange(1024, 65535)][int]$Port = 9341
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\entrypoints.ps1")
[Console]::OutputEncoding = [Text.Encoding]::UTF8

if (-not $PSBoundParameters.ContainsKey("Port") -and $env:HEIGE_CODEX_SKIN_PORT) {
    $Port = [int]$env:HEIGE_CODEX_SKIN_PORT
}
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$result = Invoke-HeiGeEnableSkinFlow -Root $root -Theme $Theme -Port $Port
Write-Host "皮肤已应用并开启常驻：$($result.Theme)。下次启动 Codex 会继续使用。"

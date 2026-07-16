param([string]$Theme = "miku-488137")
. (Join-Path $PSScriptRoot "lib\common.ps1")
[Console]::OutputEncoding = [Text.Encoding]::UTF8   # node 输出是 UTF-8，否则中文按 GBK 解码成乱码

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$port = if ($env:HEIGE_CODEX_SKIN_PORT) { [int]$env:HEIGE_CODEX_SKIN_PORT } else { 9341 }

Start-CodexWithCdp -Port $port
$node = Get-NodeRuntime -AppPath (Get-CodexApp)
Invoke-SkinCli -Node $node -CliArgs @((Join-Path $root "src\cli.mjs"), "apply", "--theme", $Theme, "--port", "$port") | Out-Null
Write-Host "皮肤已应用：$Theme"

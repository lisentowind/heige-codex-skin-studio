. (Join-Path $PSScriptRoot "lib\common.ps1")
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$source = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$target = Join-Path $env:USERPROFILE ".codex\heige-codex-skin-studio"
$app = Resolve-CodexApp
$node = Get-NodeRuntime -App $app
$transaction = Join-Path $source "src\install-transaction.mjs"
$result = Invoke-SkinCli -Node $node.Path -CliArgs @(
    $transaction,
    "install",
    "--source", $source,
    "--target", $target
)
if ($result) { Write-Host $result }

Write-Host "HeiGe Codex Skin Studio 已安装到：$target"
if ($env:HEIGE_SKIP_APPLY -ne "1") {
    & (Join-Path $target "scripts\windows\apply.ps1")
}

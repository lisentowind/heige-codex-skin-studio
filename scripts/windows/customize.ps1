param([ValidateRange(1024, 65535)][int]$Port = 9341)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\entrypoints.ps1")
[Console]::OutputEncoding = [Text.Encoding]::UTF8

if (-not $PSBoundParameters.ContainsKey("Port") -and $env:HEIGE_CODEX_SKIN_PORT) {
    $Port = [int]$env:HEIGE_CODEX_SKIN_PORT
}
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$context = Get-HeiGeFlowContext -Root $root

Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = "选择一张皮肤主图"
$dialog.Filter = "图片|*.png;*.jpg;*.jpeg;*.webp"
if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }

Add-Type -AssemblyName Microsoft.VisualBasic
$name = [Microsoft.VisualBasic.Interaction]::InputBox(
    "给皮肤起个名字",
    "HeiGe Codex Skin Studio",
    "我的 Codex 皮肤"
)
if (-not $name) { exit 0 }

$created = Invoke-HeiGeContextCli -Context $context -Arguments @(
    "create", "--image", $dialog.FileName, "--name", $name
)
if ($created.PSObject.Properties.Name -notcontains "id" -or
    [string]::IsNullOrWhiteSpace([string]$created.id)) {
    throw "创建主题失败：未拿到主题 ID。"
}
Start-HeiGeEntrypointCdp -Context $context -Port $Port
$applied = Invoke-HeiGeContextCli -Context $context -Arguments @(
    "apply", "--theme", [string]$created.id, "--port", [string]$Port
)
Assert-HeiGeModeResult -Result $applied -Expected "active"
Write-Host "新皮肤已创建并应用：$($created.id)。当前操作不改变常驻开关。"

. (Join-Path $PSScriptRoot "lib\common.ps1")
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$port = if ($env:HEIGE_CODEX_SKIN_PORT) { [int]$env:HEIGE_CODEX_SKIN_PORT } else { 9341 }

Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = "选择一张皮肤主图"
$dialog.Filter = "图片|*.png;*.jpg;*.jpeg;*.webp"
if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }

Add-Type -AssemblyName Microsoft.VisualBasic
$name = [Microsoft.VisualBasic.Interaction]::InputBox("给皮肤起个名字", "HeiGe Codex Skin Studio", "我的 Codex 皮肤")
if (-not $name) { exit 0 }

$node = Get-NodeRuntime -AppPath (Get-CodexApp)
# create 输出的是多行美化 JSON；PS 5.1 的 ConvertFrom-Json 逐行解析会炸，必须先 -join 合并。
# Invoke-SkinCli 同时把非零退出码转成异常，不再让空结果一路静默假成功
$json = Invoke-SkinCli -Node $node -CliArgs @((Join-Path $root "src\cli.mjs"), "create", "--image", $dialog.FileName, "--name", $name)
$result = $json | ConvertFrom-Json
if (-not $result.id) { throw "创建主题失败：未拿到主题 ID。原始输出：`n$json" }
Start-CodexWithCdp -Port $port
Invoke-SkinCli -Node $node -CliArgs @((Join-Path $root "src\cli.mjs"), "apply", "--theme", $result.id, "--port", "$port") | Out-Null
Write-Host "新皮肤已创建并应用：$($result.id)"

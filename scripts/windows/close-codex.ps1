param()
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\entrypoints.ps1")
. (Join-Path $PSScriptRoot "lib\bat-exit.ps1")
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

Invoke-HeiGeBatEntrypoint {
    $result = Invoke-HeiGeCloseCodexFlow -Root $root
    if ($result.AlreadyStopped) {
        Write-Host "Codex 本来就未运行。"
    } else {
        Write-Host "已完整退出 Codex（保持关闭）。"
        if ($result.Escalated) {
            Write-Host "说明：商店版若只缩到托盘，窗口关闭可能无效，已改为结束已归属主进程。"
        }
    }
    if ($result.PersistenceEnabled -eq $true) {
        Write-Host "提示：常驻开启时控制器可能再次拉起 Codex；要彻底停住请先关顶部常驻或运行 restore。"
    }
}
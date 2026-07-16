# HeiGe Codex Skin Studio 公共函数（Windows）
$ErrorActionPreference = "Stop"

function Resolve-CodexLaunchTarget {
    param([string]$AppPath)
    # 微软商店（MSIX）版的包内 exe 禁止按原始路径启动，Start-Process 会报「拒绝访问」，
    # 必须改用系统生成的应用执行别名启动，别名会原样转发命令行参数
    $windowsApps = Join-Path $env:ProgramFiles "WindowsApps"
    if (-not $AppPath.StartsWith($windowsApps, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $AppPath
    }
    $aliasDir = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"
    $names = @((Split-Path $AppPath -Leaf), "ChatGPT.exe", "Codex.exe") | Select-Object -Unique
    foreach ($name in $names) {
        $alias = Join-Path $aliasDir $name
        if (Test-Path $alias) { return $alias }
    }
    throw @"
检测到微软商店版 Codex：$AppPath
商店版不能按文件路径直接启动，需要先开启「应用执行别名」：
设置 -> 应用 -> 高级应用设置 -> 应用执行别名，打开 ChatGPT / Codex 的开关，然后重新运行本脚本。
"@
}

function Get-CodexApp {
    # 用户显式指定的路径优先，装在非默认位置时用这个兜底
    if ($env:HEIGE_CODEX_APP) {
        if (Test-Path $env:HEIGE_CODEX_APP) { return $env:HEIGE_CODEX_APP }
        throw "环境变量 HEIGE_CODEX_APP 指向的文件不存在：$($env:HEIGE_CODEX_APP)"
    }

    $exeNames = @("ChatGPT.exe", "Codex.exe")

    # 正在运行的客户端进程路径最可信；商店版进程路径在 WindowsApps 下，须翻译成可启动的别名
    foreach ($proc in (Get-Process -Name "ChatGPT", "Codex" -ErrorAction SilentlyContinue)) {
        if ($proc.Path -and (Test-Path $proc.Path)) { return Resolve-CodexLaunchTarget -AppPath $proc.Path }
    }

    # 常见安装根目录，含 Squirrel 风格的 app-x.y.z 子目录
    $roots = @(
        (Join-Path $env:LOCALAPPDATA "Programs\ChatGPT"),
        (Join-Path $env:LOCALAPPDATA "Programs\Codex"),
        (Join-Path $env:LOCALAPPDATA "ChatGPT"),
        (Join-Path $env:LOCALAPPDATA "Codex"),
        (Join-Path $env:ProgramFiles "ChatGPT"),
        (Join-Path $env:ProgramFiles "Codex")
    )
    if (${env:ProgramFiles(x86)}) {
        $roots += (Join-Path ${env:ProgramFiles(x86)} "ChatGPT")
        $roots += (Join-Path ${env:ProgramFiles(x86)} "Codex")
    }
    foreach ($root in $roots) {
        foreach ($name in $exeNames) {
            $direct = Join-Path $root $name
            if (Test-Path $direct) { return $direct }
        }
        if (Test-Path $root) {
            $appDirs = Get-ChildItem $root -Directory -Filter "app-*" -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending
            foreach ($dir in $appDirs) {
                foreach ($name in $exeNames) {
                    $nested = Join-Path $dir.FullName $name
                    if (Test-Path $nested) { return $nested }
                }
            }
        }
    }

    # 注册表卸载信息里找安装位置
    $uninstallKeys = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    foreach ($entry in (Get-ItemProperty $uninstallKeys -ErrorAction SilentlyContinue)) {
        if ($entry.DisplayName -notmatch "ChatGPT|Codex") { continue }
        $found = @()
        if ($entry.DisplayIcon) { $found += ($entry.DisplayIcon -split ",")[0].Trim('"') }
        if ($entry.InstallLocation) {
            foreach ($name in $exeNames) { $found += (Join-Path $entry.InstallLocation $name) }
        }
        foreach ($path in $found) {
            if ($path -and $path -like "*.exe" -and $path -notmatch "unins|setup|update" -and (Test-Path $path)) {
                return $path
            }
        }
    }

    # 开始菜单快捷方式兜底
    $shell = New-Object -ComObject WScript.Shell
    $menus = @(
        (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"),
        (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs")
    )
    foreach ($menu in $menus) {
        if (-not (Test-Path $menu)) { continue }
        $links = Get-ChildItem $menu -Recurse -Filter "*.lnk" -ErrorAction SilentlyContinue |
            Where-Object { $_.BaseName -match "ChatGPT|Codex" }
        foreach ($lnk in $links) {
            $target = $shell.CreateShortcut($lnk.FullName).TargetPath
            if ($target -and $target -like "*.exe" -and $target -notmatch "unins|setup|update" -and (Test-Path $target)) {
                return Resolve-CodexLaunchTarget -AppPath $target
            }
        }
    }

    # 微软商店（MSIX）安装没有常规安装目录，也不写卸载注册表项，认应用执行别名
    $aliasDir = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"
    foreach ($name in $exeNames) {
        $alias = Join-Path $aliasDir $name
        if (Test-Path $alias) { return $alias }
    }

    throw @"
未找到 Codex Desktop。分两种情况处理：
1. 还没装：先去官网下载安装官方客户端，装完重新运行本脚本。
2. 已经装了但位置特殊：找到客户端 exe 的完整路径（右键开始菜单图标 -> 打开文件位置），
   然后在命令行执行（路径换成你的）：
     setx HEIGE_CODEX_APP "D:\Apps\Codex\Codex.exe"
   关掉本窗口，重新打开再运行一次。
"@
}

function Get-NodeRuntime {
    param([string]$AppPath)
    $appDir = Split-Path $AppPath -Parent
    $candidates = @(
        (Join-Path $appDir "resources\cua_node\node.exe"),
        (Join-Path $appDir "resources\cua_node\bin\node.exe")
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }
    $systemNode = Get-Command node -ErrorAction SilentlyContinue
    if ($systemNode) { return $systemNode.Source }
    throw "未找到 Node.js 运行时：Codex 自带 Node 不在预期位置，系统 PATH 里也没有 node。请安装 Node.js 后重试。"
}

function Test-Cdp {
    param([int]$Port)
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 1 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Get-RunningCodex {
    param([string]$AppPath)
    # 按进程名 + 精确路径双路匹配：商店版走别名启动时，进程真身路径和别名路径不相等，只靠路径会漏
    $byName = @(Get-Process -Name "ChatGPT", "Codex" -ErrorAction SilentlyContinue)
    $byPath = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $AppPath })
    return @($byName + $byPath | Sort-Object Id -Unique)
}

function Start-CodexWithCdp {
    param([int]$Port = 9341)
    if (Test-Cdp -Port $Port) { return }

    $app = Get-CodexApp
    $running = Get-RunningCodex -AppPath $app
    if ($running) {
        Write-Host "正在正常退出 Codex，以调试端口重新打开……"
        $running | ForEach-Object { $_.CloseMainWindow() | Out-Null }
        for ($i = 0; $i -lt 60; $i++) {
            if (-not (Get-RunningCodex -AppPath $app)) { break }
            Start-Sleep -Milliseconds 250
        }
    }

    try {
        Start-Process -FilePath $app -ArgumentList @(
            "--remote-debugging-address=127.0.0.1",
            "--remote-debugging-port=$Port"
        )
    } catch {
        throw @"
启动 Codex 失败：$app
系统报错：$($_.Exception.Message)
常见原因与解法：
1. 微软商店版：开启「应用执行别名」（设置 -> 应用 -> 高级应用设置 -> 应用执行别名，
   打开 ChatGPT / Codex 的开关），然后重新运行本脚本。
2. 安装位置特殊：命令行执行 setx HEIGE_CODEX_APP "完整exe路径"，关掉窗口重开再试。
3. 正在用内置 Administrator 账户：系统默认禁止该账户启动商店版应用，请换普通用户账户运行。
本脚本不需要管理员权限，用普通权限的命令行运行即可。
"@
    }
    for ($i = 0; $i -lt 80; $i++) {
        if (Test-Cdp -Port $Port) { return }
        Start-Sleep -Milliseconds 250
    }
    throw "Codex 未在 $Port 端口就绪。请彻底退出 Codex 后重试。"
}

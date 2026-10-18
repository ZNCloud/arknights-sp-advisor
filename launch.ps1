# advisor-dev/launch.ps1 — 启动/重启「抓取顾问」的唯一入口（start-advisor.cmd 只是它的包装）
#
# 为什么需要它：
#   1) 桌面小框是 WinForms 窗体，用 -WindowStyle Hidden 启动会让窗体根本不出现（踩过）；
#   2) 用「命令行匹配 box.ps1」判断是否已在运行会误判自己（踩过），所以改成 box.pid；
#   3) overlay 只需要一个实例，热更新不需要重启它，但 overlay.mjs 本身改了就必须重启。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File launch.ps1            # 缺什么起什么
#   powershell -NoProfile -ExecutionPolicy Bypass -File launch.ps1 -Restart   # 全杀再起
param([switch]$Restart)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$overlay = Join-Path $here 'overlay.mjs'
$box = Join-Path $here 'box.ps1'
$pidFile = Join-Path $here 'box.pid'
$log = Join-Path $here 'overlay.log'

function Test-Overlay {
  $p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'overlay\.mjs' }
  return [bool]$p
}
function Test-Box {
  if (-not (Test-Path $pidFile)) { return $false }
  $id = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if (-not $id) { return $false }
  return [bool](Get-Process -Id $id -ErrorAction SilentlyContinue)
}
function Stop-Box {
  if (Test-Path $pidFile) {
    $id = (Get-Content $pidFile | Select-Object -First 1)
    if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
  }
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'box\.ps1' -and $_.ProcessId -ne $PID } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
function Stop-Overlay {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'overlay\.mjs' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Restart) { Stop-Box; Stop-Overlay; Start-Sleep -Milliseconds 400 }

# --- 客户端调试端口 ---
$listen = (netstat -ano | Select-String -Pattern ':9222\s' | Select-String -Pattern 'LISTENING')
if (-not $listen) {
  Write-Host '[warn] 9222 没在监听 —— 客户端不是用带顾问的启动器起的，小框会显示「未连上客户端」' -ForegroundColor Yellow
}

# --- overlay（后台，日志进 overlay.log） ---
if (-not (Test-Overlay)) {
  Start-Process -FilePath 'node' -ArgumentList @('overlay.mjs', '--watch', '--port', '9222') `
    -WorkingDirectory $here -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError (Join-Path $here 'overlay.err.log')
  Write-Host '[start] overlay'
  Start-Sleep -Seconds 2
} else {
  Write-Host '[skip] overlay 已在跑（改了 overlay.mjs 就用 -Restart）'
}

# --- 小框（必须可见） ---
if (-not (Test-Box)) {
  Start-Process -FilePath 'powershell' `
    -ArgumentList @('-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $box) `
    -WindowStyle Normal
  Write-Host '[start] 小框'
} else {
  Write-Host '[skip] 小框已在跑'
}

Start-Sleep -Seconds 2
$stateFile = Join-Path $here 'state.json'
if (Test-Path $stateFile) {
  $st = Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $age = [Math]::Round(((Get-Date) - (Get-Item $stateFile).LastWriteTime).TotalSeconds)
  Write-Host ("[state] phase=$($st.phase) round=$($st.round) online=$($st.online)  ({0}s 前写入)" -f $age)
} else {
  Write-Host '[state] 还没有 state.json（等 overlay 连上客户端）' -ForegroundColor Yellow
}
Write-Host "overlay 日志: $log"

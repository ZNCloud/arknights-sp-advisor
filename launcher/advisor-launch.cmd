@echo off
rem ============================================================
rem  Launcher: game client (+ debug port) + advisor overlay + box
rem  Records EVERYTHING by default (private view, all seats, result).
rem  Pure ASCII on purpose: cmd.exe parses this file in the OEM
rem  codepage, so any non-ASCII literal here breaks the script.
rem ============================================================
setlocal enabledelayedexpansion
set "ADV=D:\CodeProject\advisor-dev"
set "PORT=9222"
set "EXE="

rem --- the lineup check (plus the engine board search, axis weight, badges and board diagram) is on by default now;
rem --- --lineup here is a legacy no-op, kept so old shortcuts still work. This script does not forward other flags
rem --- to overlay.mjs — to narrow or fully revert (--no-board/--no-axis/--no-badges/--g06, see README.md's "默认开关
rem --- 一览") either run "node overlay.mjs --watch --log <flag>" directly in %ADV%, or add the flag to the
rem --- "node overlay.mjs" line below.
set "LINEUP="
for %%A in (%*) do if /i "%%~A"=="--lineup" set "LINEUP=--lineup"

for %%F in ("%~dp0*.exe") do if not defined EXE set "EXE=%%~fF"
if not defined EXE (
  echo [x] No .exe next to this script.
  pause
  exit /b 1
)
if not exist "%ADV%\overlay.mjs" (
  echo [x] Missing %ADV%\overlay.mjs
  pause
  exit /b 1
)

rem --- ensure the recordings folder exists ---
if not exist "%ADV%\records" mkdir "%ADV%\records"

rem --- 0) kill a stale overlay so the newest code and flags are used ---
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'overlay\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul

rem --- 1) client with the debug port (needed to read the private view) ---
powershell -NoProfile -Command "try { $c=New-Object Net.Sockets.TcpClient('127.0.0.1',%PORT%); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo [1/4] starting client with --remote-debugging-port=%PORT%
  start "" "%EXE%" --remote-debugging-port=%PORT%
  ping -n 4 127.0.0.1 >nul
) else (
  echo [1/4] client already listening on %PORT%
)

rem --- 2) overlay: recording is ON by default (--no-record to disable) ---
echo [2/4] starting advisor overlay - recording ON - %ADV%\records
if defined LINEUP echo       lineup check ON
start "advisor-overlay" /min cmd /c "cd /d %ADV% && node overlay.mjs --watch --port %PORT% --log %LINEUP% > overlay.log 2>&1"

rem --- 3) the box (must be a visible window) ---
rem --- 4/4) match data sync to GitHub (uploads on round change) ---
echo [4/4] starting match sync to GitHub
start "advisor-sync" /min cmd /c "cd /d %ADV% && node sync-match.mjs --interval 120 > sync.log 2>&1"

echo [3/4] opening the box
start "advisor-box" powershell -STA -NoProfile -ExecutionPolicy Bypass -File "%ADV%\box.ps1"

echo.
echo advisor up. Everything is recorded to %ADV%\records
echo   ^<date^>.jsonl          per-round private view + all seats
echo   ^<date^>-results.jsonl  final result + client match-history entry
echo Box window title: pick-advisor

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
  echo [1/3] starting client with --remote-debugging-port=%PORT%
  start "" "%EXE%" --remote-debugging-port=%PORT%
  ping -n 4 127.0.0.1 >nul
) else (
  echo [1/3] client already listening on %PORT%
)

rem --- 2) overlay: recording is ON by default (--no-record to disable) ---
echo [2/3] starting advisor overlay - recording ON - %ADV%\records
start "advisor-overlay" /min cmd /c "cd /d %ADV% && node overlay.mjs --watch --port %PORT% --log > overlay.log 2>&1"

rem --- 3) the box (must be a visible window) ---
echo [3/3] opening the box
start "advisor-box" powershell -STA -NoProfile -ExecutionPolicy Bypass -File "%ADV%\box.ps1"

echo.
echo advisor up. Everything is recorded to %ADV%\records
echo   ^<date^>.jsonl          per-round private view + all seats
echo   ^<date^>-results.jsonl  final result + client match-history entry
echo Box window title: pick-advisor

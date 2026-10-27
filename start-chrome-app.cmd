@echo off
rem ============================================================
rem  start-chrome-app.cmd - the advisor launcher, 0.3.2-r2 era.
rem
rem  The official client is now a WebView2 (.NET) shell: it overrides its
rem  own browser arguments, ignores WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
rem  forwards no CLI flags and keeps no config file for them, so there is no
rem  debugger to attach to. The old Electron client does expose CDP, but the
rem  server refuses it ("install the 0.3.2-r2 client").
rem
rem  So the game runs in a Chrome app window on the SAME page the client
rem  loads (https://weishuxieyiwangye.cn:8443/game.html - the server redirects
rem  to its /_build/<generation>/ path by itself): same rules, same account,
rem  and globalThis.__SP__ = {store, net, data} stays readable over CDP.
rem
rem  What starts: the game window (debug port 9222), overlay.mjs (badges +
rem  board diagram + engine board search are ON by default; see overlay.mjs's
rem  header for --no-badges / --no-board / --no-axis / --g06), the match sync,
rem  and the box. Pure ASCII on purpose: cmd.exe parses this file in the OEM
rem  codepage, so a non-ASCII literal here breaks the script.
rem ============================================================
setlocal enabledelayedexpansion
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "PORT=9222"
set "GAME=https://weishuxieyiwangye.cn:8443/game.html"
set "PROFILE=%HERE%\_chrome-profile"

rem --- Chrome: the usual per-machine location, else the 32-bit one ---
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo [x] Chrome not found.
  echo     Install Chrome, or edit CHROME= at the top of this file.
  pause
  exit /b 1
)
if not exist "%HERE%\overlay.mjs" (
  echo [x] Missing %HERE%\overlay.mjs
  pause
  exit /b 1
)
if not exist "%HERE%\records" mkdir "%HERE%\records"

rem --- 0) a stale overlay would keep the old flags and code: kill it ---
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'overlay\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul

rem --- 1) the game window, with the debugger on ---
powershell -NoProfile -Command "try { $c=New-Object Net.Sockets.TcpClient('127.0.0.1',%PORT%); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo [1/4] starting the game window on --remote-debugging-port=%PORT%
  start "" "%CHROME%" --app=%GAME% --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --window-size=1600,900 --autoplay-policy=no-user-gesture-required
  ping -n 6 127.0.0.1 >nul
) else (
  echo [1/4] debugger already listening on %PORT%
)

rem A Chrome already open on this profile WITHOUT the port only hands the URL
rem over, so recycle THIS profile's processes once and try again.
powershell -NoProfile -Command "try { $c=New-Object Net.Sockets.TcpClient('127.0.0.1',%PORT%); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo [1/4] no debugger yet - recycling the advisor Chrome profile
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match '_chrome-profile' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul
  ping -n 3 127.0.0.1 >nul
  start "" "%CHROME%" --app=%GAME% --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --window-size=1600,900 --autoplay-policy=no-user-gesture-required
  ping -n 6 127.0.0.1 >nul
)

rem --- 2) overlay (default-on advice; recording ON unless --no-record) ---
echo [2/4] starting overlay - recording ON - %HERE%\records
start "advisor-overlay" /min cmd /c "cd /d "%HERE%" && node overlay.mjs --watch --port %PORT% --log > overlay.log 2>&1"

rem --- 3) match sync (uploads on round change) ---
if exist "%HERE%\sync-match.mjs" (
  echo [3/4] starting match sync
  start "advisor-sync" /min cmd /c "cd /d "%HERE%" && node sync-match.mjs --interval 120 > sync.log 2>&1"
) else (
  echo [3/4] no sync-match.mjs - skipped
)

rem --- 4) the box (separate window; the badges/board diagram are in-page) ---
echo [4/4] opening the box
start "advisor-box" powershell -STA -NoProfile -ExecutionPolicy Bypass -File "%HERE%\box.ps1"

echo.
echo advisor up.
echo   game    : Chrome app window, debug port %PORT%
echo   records : %HERE%\records
echo   state   : %HERE%\state.json
echo Box window title: pick-advisor

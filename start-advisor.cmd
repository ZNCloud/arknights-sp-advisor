@echo off
rem start-advisor.cmd - wrapper for launch.ps1 (pure ASCII, CRLF)
setlocal
set HERE=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%launch.ps1" %*
endlocal

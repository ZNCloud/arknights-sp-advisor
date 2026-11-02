@echo off
rem keep the demo (spdemo) sync running: node sync-demos.mjs >> demos-sync.log 2>&1
cd /d "%~dp0"
node sync-demos.mjs >> demos-sync.log 2>&1

@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
node scripts\dev-server.mjs public
pause

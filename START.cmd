@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or later is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)
start "" http://127.0.0.1:4317
node scripts\server.cjs
pause

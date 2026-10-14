@echo off
title Pujiverse IPTV backend
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Download the LTS version from https://nodejs.org, install it, then run this file again.
  start https://nodejs.org/en/download
  pause
  exit /b 1
)
echo Starting Pujiverse IPTV on http://localhost:8080
echo Keep this window open while you watch. Close it to stop.
start "" http://localhost:8080
node server.js
pause

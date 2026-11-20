@echo off
setlocal
title LiveLyric Debug (port 17321)
set "ROOT=%~dp0"
set "PROFILE=%LOCALAPPDATA%\LiveLyricDebug\profile"
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

if not exist "%PROFILE%" mkdir "%PROFILE%"

netstat -ano | findstr ":17321" | findstr "LISTENING" >nul
if not errorlevel 1 goto open

pushd "%ROOT%"
start "LiveLyric Server 17321" /MIN node LiveLyricServer.js --port 17321 --no-open
popd
ping -n 3 127.0.0.1 >nul

:open
start "" "%EDGE%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check "http://127.0.0.1:17321/"
exit /b 0

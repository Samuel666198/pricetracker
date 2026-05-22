@echo off
chcp 65001 >nul
title Price Tracker

echo Starting Price Tracker...
echo.

echo Checking port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| find ":3000" ^| find "LISTENING"') do (
    echo Port 3000 occupied, killing process...
    taskkill /f /pid %%a
    timeout /t 1 /nobreak >nul
)

if not exist "node_modules" (
    echo Installing dependencies...
    npm install
)

echo.
echo Starting server...
echo URL: http://localhost:3000
echo.

node server.js

pause

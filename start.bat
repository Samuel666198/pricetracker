@echo off
chcp 65001 >nul
title Price Tracker System - Control Panel

:MENU
cls
echo.
echo ========================================
echo      Price Tracker System
echo ========================================
echo.
echo [1] Start Server
echo [2] Stop Server
echo [3] Restart Server
echo [4] Check Status
echo [5] Clean Port
echo [6] Install Dependencies
echo [h] Help
echo [0] Exit
echo.
echo ========================================
echo.
set choice=
set /p choice="Select option: "

if /i "%choice%"=="1" goto START
if /i "%choice%"=="2" goto STOP
if /i "%choice%"=="3" goto RESTART
if /i "%choice%"=="4" goto STATUS
if /i "%choice%"=="5" goto CLEAN
if /i "%choice%"=="6" goto INSTALL
if /i "%choice%"=="h" goto HELP
if /i "%choice%"=="help" goto HELP
if /i "%choice%"=="0" goto EXIT
goto MENU

:START
echo.
echo ========================================
echo        Starting Server...
echo ========================================
echo.

echo [1/3] Checking port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| find ":3000" ^| find "LISTENING"') do (
    echo [Info] Port 3000 occupied, killing...
    taskkill /f /pid %%a >nul 2>&1
    timeout /t 1 /nobreak >nul
    echo [Success] Process killed
    echo.
)

echo [2/3] Checking dependencies...
if not exist "node_modules" (
    echo [Init] Installing dependencies...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [Error] Failed to install dependencies
        pause
        goto MENU
    )
    echo.
    echo [Success] Dependencies installed
    echo.
) else (
    echo [Info] Dependencies installed
    echo.
)

echo [3/3] Starting server in new window...
echo.
start "Price Tracker Server" cmd /k "node server.js"

timeout /t 2 /nobreak >nul

echo ========================================
echo   Server Started!
echo   URL: http://localhost:3000
echo   Close the server window to stop
echo ========================================
echo.
pause
goto MENU

:STOP
echo.
echo ========================================
echo        Stopping Server...
echo ========================================
echo.

echo [Check] Checking port 3000...
set found=0
for /f "tokens=5" %%a in ('netstat -ano ^| find ":3000" ^| find "LISTENING"') do (
    set found=1
    echo [Info] Found process ID: %%a
    echo [Action] Killing process...
    taskkill /f /pid %%a >nul 2>&1
    if errorlevel 1 (
        echo [Warning] Process might already be stopped
    ) else (
        echo [Success] Process killed
    )
    timeout /t 1 /nobreak >nul
)

if %found%==0 (
    echo [Info] No running server found
)

echo.
echo ========================================
echo        Server Stopped
echo ========================================
echo.
pause
goto MENU

:RESTART
echo.
echo ========================================
echo        Restarting Server...
echo ========================================
echo.

echo [1/2] Stopping existing server...
call :STOP_SILENT

echo [2/2] Starting new server in new window...
echo.

echo [Check] Checking dependencies...
if not exist "node_modules" (
    echo [Init] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo [Error] Failed to install dependencies
        pause
        goto MENU
    )
)

start "Price Tracker Server" cmd /k "node server.js"

timeout /t 2 /nobreak >nul

echo ========================================
echo   Server Restarted!
echo   URL: http://localhost:3000
echo ========================================
echo.
pause
goto MENU

:STATUS
echo.
echo ========================================
echo        Server Status
echo ========================================
echo.

echo [Check] Checking port 3000...
set running=0
set pid=
for /f "tokens=5" %%a in ('netstat -ano ^| find ":3000" ^| find "LISTENING"') do (
    set running=1
    set pid=%%a
    echo [Status] Server is running
    echo [Process] ID: %%a
)

if %running%==0 (
    echo [Status] Server not running
)

echo.
echo [Check] Checking node_modules...
if exist "node_modules" (
    echo [Status] Dependencies installed
) else (
    echo [Status] Dependencies not installed
)

echo.
echo [Info] URL: http://localhost:3000
echo.
echo ========================================
echo.
pause
goto MENU

:CLEAN
echo.
echo ========================================
echo        Cleaning Port
echo ========================================
echo.

echo [Check] Checking port 3000...
set found=0
for /f "tokens=5" %%a in ('netstat -ano ^| find ":3000" ^| find "LISTENING"') do (
    set found=1
    echo [Info] Found process ID: %%a
    echo [Action] Killing process...
    taskkill /f /pid %%a >nul 2>&1
    timeout /t 1 /nobreak >nul
    echo [Success] Process killed
)

if %found%==0 (
    echo [Info] Port 3000 is free
)

echo.
echo ========================================
echo        Cleanup Complete
echo ========================================
echo.
pause
goto MENU

:INSTALL
echo.
echo ========================================
echo        Installing Dependencies
echo ========================================
echo.

echo [Info] Installing npm packages...
echo.
call npm install

if errorlevel 1 (
    echo.
    echo [Error] Failed to install dependencies
    pause
    goto MENU
)

echo.
echo [Success] Dependencies installed
echo.
echo ========================================
echo.
pause
goto MENU

:HELP
cls
echo.
echo ========================================
echo              Help Guide
echo ========================================
echo.
echo Commands:
echo.
echo [1] Start Server
echo     Starts the price tracker server in a new window.
echo     The server runs at http://localhost:3000
echo.
echo [2] Stop Server
echo     Stops any running server on port 3000.
echo.
echo [3] Restart Server
echo     Stops the current server and starts a new one.
echo.
echo [4] Check Status
echo     Shows if the server is running and dependency status.
echo.
echo [5] Clean Port
echo     Forces cleanup of port 3000.
echo.
echo [6] Install Dependencies
echo     Installs npm packages (node_modules).
echo.
echo [h] Help
echo     Shows this help screen.
echo.
echo [0] Exit
echo     Closes this control panel.
echo.
echo ========================================
echo.
pause
goto MENU

:STOP_SILENT
for /f "tokens=5" %%a in ('netstat -ano ^| find ":3000" ^| find "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
    timeout /t 1 /nobreak >nul
)
goto :eof

:EXIT
echo.
echo ========================================
echo        Goodbye!
echo ========================================
echo.
timeout /t 1 /nobreak >nul
exit /b 0

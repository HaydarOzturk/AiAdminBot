@echo off
title AdminBot
echo.
echo   ========================================
echo     AdminBot - Discord Administration Bot
echo   ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js is not installed!
    echo   Download it from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Check if node_modules exists
if not exist "node_modules" (
    echo   Installing dependencies...
    npm install
    echo.
)

:: Check if .env exists
if not exist ".env" (
    echo   No .env found — starting setup wizard...
    echo.
    node src/setup-wizard.js
    echo.
    echo   Deploying slash commands...
    node src/deploy-commands.js
    echo.
)

:: Start the bot
echo   Starting AdminBot...
echo   Press Ctrl+C to stop.
echo   Logs are saved in the /logs folder.
echo.
node src/index.js

:: If the bot exits, pause so the user can see any error
echo.
echo   Bot has stopped. Check logs/ folder for details.
pause

@echo off
title Japanese Shorts Studio
cd /d "%~dp0"

echo.
echo   ==================================
echo    Japanese Shorts Studio
echo   ==================================
echo.

if not exist ".env" (
    echo   [ERROR] .env file not found.
    echo   Copy .env.example to .env and put your API key in it.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo   First run - installing packages. This takes 1-2 minutes...
    echo.
    call npm install
    echo.
)

start "" /min cmd /c "ping -n 5 127.0.0.1 > nul & start "" http://localhost:3000"

echo   URL: http://localhost:3000
echo   Your browser will open automatically.
echo.
echo   * Close this window to stop the program.
echo.

call npm start

echo.
echo   Server stopped.
pause
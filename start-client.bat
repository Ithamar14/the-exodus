@echo off
cd /d "%~dp0src\Client"
start "Dev Server" cmd /k npm run dev
timeout /t 3 /nobreak >nul
start http://localhost:5173

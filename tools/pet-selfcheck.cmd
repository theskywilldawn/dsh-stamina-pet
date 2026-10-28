@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pet-selfcheck.ps1"
echo.
pause

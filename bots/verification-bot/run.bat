@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m verification_bot
) else (
  python -m verification_bot
)
if errorlevel 1 pause

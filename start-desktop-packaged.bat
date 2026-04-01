@echo off
cd /d "%~dp0"
set "EXE_PATH=%~dp0release\RoyCode Studio 0.1.0.exe"
if not exist "%EXE_PATH%" (
  echo Packaged desktop build not found at "%EXE_PATH%". Run npm run desktop:dist first.
  exit /b 1
)

start "" "%EXE_PATH%"

@echo off
rem Start the backend and frontend together (Windows). See dev.ps1.
rem Runs dev.ps1 for this one command only, without changing your execution policy.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*

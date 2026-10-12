@echo off
title Foxxy FM installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-foxxy.ps1"
pause

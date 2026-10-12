@echo off
title Foxxy FM editor
cd /d "%~dp0"
if not exist build\foxxy-site\webapp\editor\index.html (
  echo The editor is not built yet: run INSTALL-FOXXY.bat first.
  pause
  exit /b 1
)
start "" http://localhost:8766/webapp/editor/
echo Foxxy FM editor: http://localhost:8766/webapp/editor/  (keep this window open while you use it)
python -m http.server 8766 --bind 127.0.0.1 --directory build/foxxy-site
pause

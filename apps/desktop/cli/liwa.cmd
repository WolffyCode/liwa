@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\..\..\Liwa.exe" --expose-internals "%~dp0..\..\..\app.asar\liwa\node_modules\@liwa\desktop-host\lib\cli.js" %*
exit /b %errorlevel%

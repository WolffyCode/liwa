@echo off
setlocal DisableDelayedExpansion
set "signTool=%LIWA_DESKTOP_WINDOWS_SIGNTOOL%"
set "certificateFile=%LIWA_DESKTOP_WINDOWS_CER_FILE%"
set "tokenPin=%LIWA_DESKTOP_WINDOWS_TOKEN_PIN%"
set "keyContainer=%LIWA_DESKTOP_WINDOWS_KEY_CONTAINER%"
set "targetFile=%LIWA_DESKTOP_WINDOWS_SIGN_TARGET%"
set "appendSignature="
if "%LIWA_DESKTOP_WINDOWS_SIGN_APPEND%"=="1" set "appendSignature=/as"
set "LIWA_DESKTOP_WINDOWS_SIGNTOOL="
set "LIWA_DESKTOP_WINDOWS_CER_FILE="
set "LIWA_DESKTOP_WINDOWS_TOKEN_PIN="
set "LIWA_DESKTOP_WINDOWS_KEY_CONTAINER="
set "LIWA_DESKTOP_WINDOWS_SIGN_TARGET="
set "LIWA_DESKTOP_WINDOWS_SIGN_APPEND="
set "signTool=" & set "certificateFile=" & set "tokenPin=" & set "keyContainer=" & set "targetFile=" & set "appendSignature=" & "%signTool%" sign /v /fd sha256 /f "%certificateFile%" /kc "[{{%tokenPin%}}]=%keyContainer%" /csp "eToken Base Cryptographic Provider" %appendSignature% "%targetFile%"
exit /b %errorlevel%

@echo off
chcp 949 >nul
title SAP 배차 진행정보 자동 다운로드
cd /d "%~dp0"
cscript //NoLogo "%~dp0download-sap.vbs" > "%USERPROFILE%\Desktop\sap-debug.log" 2>&1
exit /b %ERRORLEVEL%

@echo off
chcp 65001 >nul
title DB 백업

echo ========================================
echo  배차 DB → USB 백업
echo ========================================

rem 로컬 DB 경로
set SRC=%~dp0prisma\dispatch.db

rem USB D: 드라이브 확인
if not exist "D:\" (
    echo [오류] USB(D:)가 연결되지 않았습니다.
    pause
    exit /b 1
)

rem DB 파일 존재 확인
if not exist "%SRC%" (
    echo [오류] DB 파일이 없습니다: %SRC%
    pause
    exit /b 1
)

rem 날짜/시간 태그
for /f "tokens=1-3 delims=-" %%a in ('powershell -command "Get-Date -Format 'yyyy-MM-dd'"') do set DT=%%a%%b%%c
set DEST=D:\dispatch_%DT%.db

copy /Y "%SRC%" "%DEST%"
echo.
echo [완료] D:\dispatch_%DT%.db 로 저장됐습니다.
echo.
pause

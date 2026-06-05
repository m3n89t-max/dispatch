@echo off
chcp 65001 >nul
title 제주 배차 자동화 시스템

echo ========================================
echo  제주 배차 자동화 시스템
echo ========================================
echo.

rem ── Z: 드라이브 매핑 ──────────────────────
echo [1/3] 서버 연결 중... (\\23.20.121.23\common)

net use Z: \\23.20.121.23\common /persistent:yes >nul 2>&1
if errorlevel 1 (
    net use Z: \\23.20.121.23\common >nul 2>&1
)

if not exist "Z:\" (
    echo.
    echo [오류] 서버에 연결할 수 없습니다.
    echo   ■ 네트워크 연결 상태를 확인하세요
    echo   ■ VPN 또는 사내 네트워크 필요
    echo.
    echo 서버 없이 로컬 DB로 시작하시겠습니까? (Y/N)
    set /p CHOICE=
    if /i "%CHOICE%"=="Y" (
        set DATABASE_URL=file:./db/dispatch.db
        echo [경고] 로컬 DB 사용 중 — 데이터가 서버에 저장되지 않습니다
        goto START
    ) else (
        echo 종료합니다.
        pause
        exit /b 1
    )
)

rem ── 서버 DB 폴더 생성 ─────────────────────
echo [2/3] 서버 DB 폴더 확인 중...

if not exist "Z:\제주물류센터자동화" mkdir "Z:\제주물류센터자동화"

echo      경로: Z:\제주물류센터자동화\dispatch.db
set DATABASE_URL=file:Z:/제주물류센터자동화/dispatch.db

:START
rem ── 앱 시작 ───────────────────────────────
echo [3/3] 앱 시작 중...
echo.
echo  접속 주소: http://localhost:3000
echo  종료: Ctrl+C
echo ========================================
echo.

cd /d "%~dp0.."
set NEXTAUTH_SECRET=dispatch-secret-key-change-in-production
set PORT=3000
set HOSTNAME=0.0.0.0

node node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3000

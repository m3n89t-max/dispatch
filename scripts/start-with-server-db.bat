@echo off
chcp 65001 >nul
title 제주 배차 자동화 시스템

echo ========================================
echo  배차 시스템 시작 중...
echo ========================================

rem 네트워크 드라이브 Z: 매핑 (이미 연결돼 있으면 무시)
net use Z: \\23.20.121.23\common /persistent:yes >nul 2>&1
if errorlevel 1 (
    net use Z: \\23.20.121.23\common >nul 2>&1
)

rem Z: 드라이브 확인
if not exist "Z:\" (
    echo [오류] 서버 연결 실패: \\23.20.121.23\common
    echo  - 네트워크 연결 상태를 확인하세요
    pause
    exit /b 1
)

rem DB 폴더 생성
if not exist "Z:\제주물류센터자동화" mkdir "Z:\제주물류센터자동화"

echo [OK] 서버 DB 폴더: Z:\제주물류센터자동화\dispatch.db

rem 환경변수 설정
set DATABASE_URL=file:Z:/제주물류센터자동화/dispatch.db
set NEXTAUTH_SECRET=dispatch-secret-key-change-in-production

rem 앱 디렉토리로 이동
cd /d "%~dp0.."

echo [OK] 앱 시작 중... (http://localhost:3000)
echo.

node node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3000

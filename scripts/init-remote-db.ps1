# 서버에 DB 초기화 및 데이터 복사
# 사용법: .\scripts\init-remote-db.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " 서버 DB 초기화" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Z: 드라이브 매핑
Write-Host "[1/4] 서버 연결 중..." -ForegroundColor Yellow
net use Z: \\23.20.121.23\common /persistent:yes 2>$null
if (-not (Test-Path "Z:\")) {
    Write-Error "서버 연결 실패: \\23.20.121.23\common 에 접근할 수 없습니다"
    exit 1
}
Write-Host "     연결 성공" -ForegroundColor Green

# 폴더 생성
Write-Host "[2/4] 폴더 생성 중..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force "Z:\제주물류센터자동화" | Out-Null
Write-Host "     Z:\제주물류센터자동화" -ForegroundColor Green

# 로컬 DB → 서버 복사 (기존 DB가 없을 때만)
Write-Host "[3/4] DB 복사 중..." -ForegroundColor Yellow
$serverDb = "Z:\제주물류센터자동화\dispatch.db"
$localDb  = "$PSScriptRoot\..\prisma\dispatch.db"

if (-not (Test-Path $serverDb)) {
    if (Test-Path $localDb) {
        Copy-Item $localDb $serverDb
        Write-Host "     로컬 DB → 서버 복사 완료" -ForegroundColor Green
    } else {
        # DB가 없으면 스키마로 새로 생성
        $env:DATABASE_URL = "file:Z:/제주물류센터자동화/dispatch.db"
        Write-Host "     새 DB 생성 중 (prisma db push)..." -ForegroundColor Yellow
        node node_modules/prisma/build/index.js db push --schema ./prisma/schema.prisma
    }
} else {
    Write-Host "     서버에 이미 DB 존재 — 건너뜀" -ForegroundColor Gray
}

# Prisma 클라이언트 재생성
Write-Host "[4/4] Prisma 클라이언트 재생성..." -ForegroundColor Yellow
$env:DATABASE_URL = "file:Z:/제주물류센터자동화/dispatch.db"
node node_modules/prisma/build/index.js generate

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " 완료!" -ForegroundColor Green
Write-Host " DB 위치: \\23.20.121.23\common\제주물류센터자동화\dispatch.db" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

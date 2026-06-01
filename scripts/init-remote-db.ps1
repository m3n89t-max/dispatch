# 서버 공유 폴더(\\23.20.121.23\common)에 DB 초기화
# 사용법: .\scripts\init-remote-db.ps1

# 네트워크 드라이브 Z: 매핑
net use Z: \\23.20.121.23\common /persistent:yes 2>$null
if (-not (Test-Path "Z:\")) {
    Write-Error "서버 연결 실패: \\23.20.121.23\common 에 접근할 수 없습니다"
    exit 1
}

# DB 폴더 생성
New-Item -ItemType Directory -Force "Z:\dispatch" | Out-Null

Write-Host "서버 DB 경로: Z:\dispatch\dispatch.db" -ForegroundColor Cyan

$env:DATABASE_URL = "file:Z:/dispatch/dispatch.db"

Write-Host "스키마 push 중..." -ForegroundColor Cyan
node node_modules/prisma/build/index.js db push --schema ./prisma/schema.prisma

Write-Host "Prisma 클라이언트 재생성..." -ForegroundColor Cyan
node node_modules/prisma/build/index.js generate

Write-Host ""
Write-Host "완료! 배차 DB가 서버에 초기화됐습니다." -ForegroundColor Green
Write-Host "DB 위치: \\23.20.121.23\common\dispatch\dispatch.db" -ForegroundColor Green

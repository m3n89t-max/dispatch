# 원격 서버(23.20.121.23)의 sqld에 스키마 초기화
# 사용법: .\scripts\init-remote-db.ps1

$env:DATABASE_URL = "http://23.20.121.23:8080"

Write-Host "원격 DB에 스키마 push 중..." -ForegroundColor Cyan
node node_modules/prisma/build/index.js db push --schema ./prisma/schema.prisma

Write-Host "Prisma 클라이언트 재생성..." -ForegroundColor Cyan
node node_modules/prisma/build/index.js generate

Write-Host "완료: 배차 DB가 23.20.121.23:8080에 초기화됐습니다" -ForegroundColor Green

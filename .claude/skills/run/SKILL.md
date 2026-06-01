---
name: run
description: 제주 배차 자동화 시스템 개발서버를 실행하고 동작을 확인하는 스킬
---

# 개발서버 실행 스킬

## 환경 요구사항

- Node.js (node_modules 설치 필요)
- `.env` 파일 존재 여부 확인: `c:\Users\m3n89\Desktop\Dispatch\dispatch\.env`
- SQLite DB: `prisma/dispatch.db`

## 실행 전 체크리스트

```powershell
# 1. node_modules 존재 확인
Test-Path "c:\Users\m3n89\Desktop\Dispatch\dispatch\node_modules"

# 2. .env 존재 확인
Test-Path "c:\Users\m3n89\Desktop\Dispatch\dispatch\.env"

# 3. DB 파일 존재 확인
Test-Path "c:\Users\m3n89\Desktop\Dispatch\dispatch\prisma\dispatch.db"
```

node_modules 없으면:
```powershell
cd "c:\Users\m3n89\Desktop\Dispatch\dispatch"
npm install
```

DB 없으면:
```powershell
cd "c:\Users\m3n89\Desktop\Dispatch\dispatch"
$env:DATABASE_URL = "file:./prisma/dispatch.db"
node node_modules/prisma/build/index.js db push --schema ./prisma/schema.prisma
node node_modules/prisma/build/index.js generate
```

## 개발서버 실행

```powershell
cd "c:\Users\m3n89\Desktop\Dispatch\dispatch"
$env:DATABASE_URL = "file:./prisma/dispatch.db"
npm run dev
```

서버는 **http://localhost:3000** 에서 실행됩니다.

## 주요 URL

| 경로 | 설명 |
|------|------|
| `/` | 메인 대시보드 |
| `/upload` | 엑셀 업로드 (전일배차 / 납기) |
| `/drivers` | 기사 관리 |
| `/performance` | 실적 분석 |

## API 엔드포인트 스모크 테스트

서버 실행 후 별도 터미널에서:

```powershell
# 기사 목록
Invoke-RestMethod "http://localhost:3000/api/drivers"

# 납기 날짜 목록 (이번 달)
$year = (Get-Date).Year; $month = (Get-Date).Month
Invoke-RestMethod "http://localhost:3000/api/delivery/dates?year=$year&month=$month"
```

## 백그라운드 실행 후 확인 방법

Bash tool의 `run_in_background: true`로 실행 후, `curl http://localhost:3000` 로 응답 확인.
응답이 HTML이면 서버 정상 동작.

## 흔한 문제

| 증상 | 원인 | 해결 |
|------|------|------|
| `DATABASE_URL not found` | `.env` 없음 | `.env` 생성 (`DATABASE_URL="file:./prisma/dispatch.db"`) |
| `prisma client not generated` | generate 안 함 | `node node_modules/prisma/build/index.js generate` |
| 포트 3000 사용중 | 기존 서버 실행중 | `Get-Process node \| Stop-Process -Force` |
| `adapter` 오류 | Prisma 7.x libsql 어댑터 필요 | `npm install @prisma/adapter-libsql @libsql/client` |
